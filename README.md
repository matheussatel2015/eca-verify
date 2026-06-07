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

Pré-requisitos: Node 22 e Docker.

```bash
# 1. dependências
npm install

# 2. infraestrutura (Postgres + Redis + MinIO)
docker compose up -d

# 3. variáveis de ambiente
cp .env.example .env   # ajuste APP_ENCRYPTION_KEY (64 hex) e demais valores

# 4. banco
npx typeorm-ts-node-commonjs migration:run -d apps/api/src/db/data-source.ts
npx ts-node apps/api/scripts/seed-tenant.ts   # imprime tenant id + API key (guarde)

# 5. API + worker (em shells separados)
npx ts-node apps/api/src/main.ts
npx ts-node apps/api/src/worker.ts

# 6. plugin (bundle)
cd packages/plugin && node build.mjs
```

## Testes
```bash
npm test       # 62 testes unitários
```
Smokes manuais (exigem infra rodando): `apps/api/test/smoke.http`, `apps/api/test/scale-smoke.md`, `apps/api/test/tenant-smoke.md`.

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
- [x] **#4 Billing** — planos (free/pro/scale), quota mensal metered em Redis + bloqueio `402`, fatura computada (sem gateway de pagamento ainda)

## Documentação
Specs e planos de implementação em `docs/superpowers/`.

## Licença
Proprietária — **todos os direitos reservados** (código source-available, sem concessão de uso). Veja [`LICENSE`](LICENSE).
