# ECA Verify

Plataforma SaaS B2B *plug & play* de **verificação de maioridade** por análise facial com *liveness*, em conformidade com a **Lei 15.211/2025 (ECA Digital)** e com **Privacy by Design** sob a LGPD.

A biometria bruta **nunca** é armazenada de forma persistente nem entregue ao cliente — só o resultado da checagem (`aprovado | reprovado | documento_requerido`).

> ⚠️ **Implementação de referência.** Este repositório demonstra a arquitetura e as garantias de privacidade. Antes de produção, exige auditoria de segurança, integração com um provedor de IA real e validação jurídica da evidência exigida pela fiscalização.

---

## Como funciona

```
Plugin (consentimento → captura → cifra o frame)
   │  POST /verify (frame cifrado + session_token)        [TLS 1.3]
   ▼
API stateless  ── rate limiting (Redis, por API Key)
   │  guarda o frame cifrado num bucket temporário (TTL 5 min)
   │  enfileira o job  ──────────────────────────────────┐
   └─ responde 202 { status: "processando" }              │
                                                          ▼
                                                  Fila (BullMQ/Redis)
                                                          │ (workers paralelos)
                                                          ▼
            Worker: decifra em memória → estimativa de idade + liveness (adapter)
                    → regra híbrida → grava auditoria (só metadados, sob RLS)
                    → DELETA a mídia (física, imediata) → webhook assinado (HMAC)
```

### Regra híbrida de decisão
```
liveness < limiar             → reprovado (falha de prova de vida)
idade estimada ≥ corte+margem → aprovado
idade estimada < corte−margem → reprovado
zona cinzenta                 → documento_requerido
```

## Garantias de Privacy by Design
- **Efemeridade:** o frame só existe em memória no worker, é zerado no `finally`, e a mídia temporária é deletada fisicamente logo após o processamento. Nenhuma tabela tem coluna para biometria — **impossível por design**.
- **Minimização:** a abertura de sessão aceita apenas um `user_hash` anônimo; PII direta (nome/CPF/e-mail/telefone…) é barrada na borda.
- **Isolamento multi-tenant:** PostgreSQL com Row-Level Security (`FORCE`) por `tenant_id`, aplicado por conexão via `set_config('app.tenant_id', …)`.
- **Criptografia:** TLS 1.3 em trânsito; frame cifrado com AES-256-GCM; segredos de webhook cifrados em repouso (AES-256-GCM); API Keys guardadas apenas como hash SHA-256.

## Arquitetura (monorepo)
- `apps/api` — API NestJS (tenant, sessão, verificação, webhook, auditoria) + worker BullMQ
- `packages/plugin` — plugin JS Vanilla *drop-in* (consentimento + captura + liveness)
- `packages/sdk-types` — contratos/tipos compartilhados

## Stack
Node.js 22 · TypeScript · NestJS · TypeORM + PostgreSQL · Redis (BullMQ + rate limit) · S3-compatível (bucket temporário) · Jest.

## Rodando localmente

Pré-requisitos: Docker (e Node 22 para o modo dev).

### Tudo no Docker (recomendado)
```bash
docker compose up -d --build
```
Sobe Postgres + Redis + MinIO + **API** + **worker**, roda as migrações (serviço `migrate`) e cria o bucket. Depois:
- Dashboard: http://localhost:3000/dashboard (cole uma API key — gere via `POST /tenants/register`)
- Health: http://localhost:3000/health · JWKS: http://localhost:3000/.well-known/jwks.json
- MinIO: http://localhost:9001 (`minioadmin`/`minioadmin`)

Para habilitar a **prova assinada** (JWT ES256): `cp .env.docker.example .env.docker` e preencha `PROOF_PRIVATE_KEY_B64` (veja o comando no arquivo). Sem isso, o app roda normal e os endpoints de prova retornam 503.

### Modo CAF (provedor real / stub)

Por padrão a app usa os provedores `mock` (idade/liveness e documento), e o
`docker-compose.yml` **não muda**. Para exercitar o **caminho real do adapter CAF**
sem credenciais de fornecedor, há um *stub* CAF sem dependências
(`tools/caf-stub`) e um override de compose **opt-in**:

```bash
docker compose -f docker-compose.yml -f docker-compose.caf.yml up -d --build
```

Isso mantém Postgres/Redis/MinIO + migrações da base, sobe um serviço `caf-stub`
em `:8090` e troca `api`+`worker` para `AGE_PROVIDER_KIND=caf` /
`DOC_VERIFIER_KIND=caf` apontando para `CAF_BASE_URL=http://caf-stub:8090`. O
worker passa a chamar de verdade `POST /token` → `POST /transactions` → *polling*
em `GET /transactions/:id`, e mapeia o resultado (ver `tools/caf-stub/README.md`).

A idade devolvida pelo stub é configurável via `STUB_AGE_LOW` (padrão `25` →
`aprovado`; valor na zona cinzenta, ex. `17` → `documento_requerido`).

Para apontar para o **CAF real** (sandbox), nenhuma alteração de código é
necessária: basta definir `CAF_BASE_URL` para o host real e
`CAF_CLIENT_ID`/`CAF_CLIENT_SECRET` reais (e remover/ignorar o serviço `caf-stub`).

### Modo dev (sem containerizar a app)
```bash
npm install
docker compose up -d postgres redis minio
cp .env.example .env   # ajuste APP_ENCRYPTION_KEY (64 hex)
npx typeorm-ts-node-commonjs migration:run -d apps/api/src/db/data-source.ts
npx ts-node apps/api/scripts/seed-tenant.ts   # imprime tenant id + API key
npx ts-node apps/api/src/main.ts              # API   (shell 1)
npx ts-node apps/api/src/worker.ts            # worker (shell 2)
cd packages/plugin && node build.mjs          # bundle do plugin
```

## Testes
```bash
npm test       # 189 testes (unitários + integração CAF via HTTP real)
```
Smokes manuais em `apps/api/test/*.md` (+ `smoke.http`).

## API (resumo)
| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/tenants/register` | — | Cadastro self-service; retorna `api_key` (uma vez) |
| POST | `/tenants/me/api-keys` | Bearer | Rotaciona (emite nova chave) |
| DELETE | `/tenants/me/api-keys/:id` | Bearer | Revoga uma chave |
| POST | `/sessions` | Bearer | Abre sessão de verificação (só `user_hash`) |
| POST | `/verify` | session_token | Recebe o frame cifrado → `202 processando` |

Webhook de retorno (assinado `X-Signature: HMAC-SHA256`):
```json
{ "transaction_id": "98765", "status": "aprovado", "is_over_18": true }
```

## Roadmap
- [x] **#0 MVP vertical** — fatia ponta-a-ponta (síncrona, pronta-para-fila)
- [x] **#2.5 Escala & Hardening** — fila + workers, bucket TTL, rate limiting, async `202`
- [x] **#1 Core multi-tenant** — registro self-service, rotação/revogação de API Keys, segredos cifrados
- [x] **#2 Motor de IA real (CAF)** — adapter CAF (idade/liveness) + etapa de documento (OCR + facematch) atrás dos ports, seleção `mock|caf`. *Chamadas reais ao CAF pendentes de credenciais de sandbox.*
- [x] **#3 Dashboard + auditoria** — painel estático (volume, aprovações/reprovações, log de auditoria) servido pela API, dados RLS-scoped por API Key
- [x] **#4 Billing** — planos (free/pro/scale), quota mensal metered em Redis + bloqueio `402`, fatura computada
- [x] **#4b Pagamento (Stripe)** — assinatura via Stripe Checkout hospedado + sincronização de plano por webhook assinado. Adapter `mock|stripe` (default `mock`); opt-in real Stripe via `PAYMENT_PROVIDER_KIND=stripe` + `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_PRICE_PRO`/`STRIPE_PRICE_SCALE`. Endpoints `POST /billing/checkout` (cria a sessão de Checkout, requer API Key) e `POST /billing/stripe/webhook` (público, raw-body, assinatura verificada → atualiza `plan_id` e guarda `stripe_customer_id`/`stripe_subscription_id`). Chamadas reais ao Stripe pendentes de credenciais de sandbox.

## Documentação
Specs e planos de implementação em `docs/superpowers/`.

## Licença
Proprietária — **todos os direitos reservados** (código source-available, sem concessão de uso). Veja [`LICENSE`](LICENSE).
