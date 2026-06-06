# PRD — ECA Verify · Plataforma SaaS de Verificação Etária

**Versão:** 0.2 · **Data:** 2026-06-06 · **Lei base:** 15.211/2025 (ECA Digital)

> A v0.2 integra o adendo de Segurança Avançada e Escalabilidade. O documento descreve a **arquitetura-alvo** (escalável, assíncrona) e marca, em cada ponto, o que entra no **MVP (#0)** versus as fases posteriores.

## 1. Visão
SaaS B2B *plug & play* que fornece a plataformas terceiras (jogos, e-commerce, redes sociais) verificação de maioridade por análise facial com *liveness*, em conformidade com a Lei 15.211/2025 e **Privacy by Design** sob a LGPD. A biometria bruta **nunca** é armazenada de forma persistente nem entregue ao cliente — só o resultado da checagem.

## 2. Atores
- **Plataforma** — motor de validação + administração (nós).
- **Tenant** — empresa-cliente que integra o serviço.
- **Usuário final** — pessoa que comprova a idade no site do tenant.

## 3. Decisões de arquitetura (travadas)
| Tema | Decisão |
|------|---------|
| Método de verificação | **Híbrido**: estimativa de idade por IA; documento exigido só na zona cinzenta perto do corte |
| Stack core | **Node.js / NestJS** (confirmado; autoscaling stateless, filas e rate limiting são plenamente suportados) |
| Plugin | **JS Vanilla** empacotado, *drop-in*, sem dependências de runtime |
| Motor de IA | **Adapter (`AgeProviderPort`)** com `MockAgeProvider` no MVP; provedor real trocável depois sem refatorar |
| Isolamento multi-tenant | **PostgreSQL + Row-Level Security** por `tenant_id`, com `FORCE ROW LEVEL SECURITY` |
| Modelo de execução | **MVP síncrono, pronto-para-fila**; arquitetura-alvo **assíncrona** (fila + workers) |
| Qualidade | **TDD** desde o MVP |

## 4. Roadmap (decomposição)
| # | Sub-projeto | Escopo |
|---|-------------|--------|
| **0** | **MVP vertical** *(esta spec / plano atual)* | Fatia fina ponta-a-ponta, **síncrona**, pronta-para-fila |
| 1 | Core multi-tenant | Cadastro self-service, rotação/revogação de API Keys, **cifragem AES-256 dos segredos em repouso** |
| 2 | Motor de IA real | Troca do mock pelo provedor via adapter; calibração da margem etária |
| **2.5** | **Escala & Hardening** | Fila + workers, bucket temporário TTL, Redis (cache + rate limiting), autoscaling, contrato assíncrono "processando" |
| 3 | Dashboard + auditoria | Consumo, aprovações/reprovações, relatórios |
| 4 | Billing | Planos, faturamento, limites de uso |

## 5. Escopo do MVP (#0)
**Inclui:** 1 tenant *seedado* via script, 1 API Key, plugin mínimo (consentimento + captura + liveness), backend **síncrono** com IA *mock*, regra de decisão híbrida, webhook assinado, log de auditoria sem biometria, isolamento RLS.

**Pronto-para-fila:** o processamento fica isolado em `VerificationService.verify()`. Migrar para o modelo assíncrono (#2.5) é trocar a chamada in-process por *enqueue* + *worker* — **sem mudar a lógica de domínio nem o contrato do webhook**.

**NÃO inclui:** cadastro self-service, dashboard, billing, provedor de IA real, etapa de documento completa (*stub*), fila/workers, bucket temporário, rate limiting, autoscaling.

## 6. Estrutura (monorepo)
- `apps/api` — NestJS (Tenant, Session, Verification, Webhook, Audit)
- `packages/plugin` — JS Vanilla empacotado
- `packages/sdk-types` — contratos/tipos compartilhados

## 7. Requisitos funcionais
**RF1 — Autenticação de tenant.** Guarda por `Authorization: Bearer <api-key>`; a API Key é guardada apenas como **hash SHA-256** (não reversível). *(MVP)*

**RF2 — Sessão de verificação.** Tenant faz `POST /sessions` com **apenas** `user_hash` anônimo → recebe `session_token` efêmero + URL que o plugin abre. Endpoint rejeita payload com PII direta (nome/CPF/e-mail). *(MVP)*

**RF3 — Plugin.** Exibe política e colhe **consentimento explícito** antes de ativar a câmera; captura com *liveness*; cifra e envia o frame + `session_token`. *(MVP)*

**RF4 — Verificação.** Backend decifra o frame em memória → `AgeProviderPort` retorna `{estimatedAge, livenessScore}` → aplica regra híbrida. *(MVP síncrono; #2.5 move para worker)*

**RF5 — Regra híbrida.** *(MVP)*
```
liveness < limiar           → reprovado (falha de prova de vida)
estimativa >= corte + margem → aprovado
estimativa <  corte - margem → reprovado
zona cinzenta               → status "documento_requerido" (stub)
```

**RF6 — Webhook.** `POST` assinado HMAC-SHA256 ao callback do tenant: `{transaction_id, status, is_over_18}`, com *retry* e idempotência por `transaction_id`. *(MVP)*

**RF7 — Auditoria.** Grava só metadados: tx id, tenant, timestamp, IP mascarado, status. *(MVP)*

**RF8 — Processamento assíncrono.** A API enfileira o job e retorna `202 { transaction_id, status: "processando" }` imediatamente; workers processam em paralelo e notificam via webhook (RF6). *(Fase #2.5)*

**RF9 — Rate limiting.** Limite de requisições por minuto por API Key via Redis; excedente recebe `429`. *(Fase #2.5)*

## 8. Requisitos não-funcionais — Segurança & Privacy by Design

### 8.1 Isolamento de dados (multi-tenant)
- **RLS rígido:** toda tabela *tenant-scoped* tem `tenant_id`; `ENABLE` + `FORCE ROW LEVEL SECURITY`; policy `USING/WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid)`. A camada de persistência define `app.tenant_id` por requisição. Um tenant **jamais** lê ou grava dados de outro. *(MVP)*

### 8.2 Política efêmera da biometria (Zero-Storage)
- **MVP (síncrono):** o frame é decifrado **só em memória**, processado e **zerado no `finally`**. Nenhum caminho de código o escreve em disco/DB. *(mais estrito que o adendo)*
- **Alvo (assíncrono, #2.5):** upload cifrado para **bucket temporário com TTL de 5 min**; o worker dispara **deleção física imediata** da mídia ao concluir. O banco persiste apenas o **hash criptográfico do resultado** + metadados.
- **Schema sem biometria:** as tabelas **não possuem coluna** para imagem/biometria — impossível por design, não por disciplina. *(MVP)*

### 8.3 Criptografia
- **Em trânsito:** TLS 1.3 obrigatório em toda a API (terminado no proxy/ALB à frente do app stateless). *(MVP)*
- **Frame em trânsito plugin→API:** AES-256-GCM com chave de sessão efêmera. *(MVP)*
- **Em repouso:** API Keys como hash SHA-256; **segredos de webhook e tokens dos tenants cifrados com AES-256-GCM** (chave gerida por KMS/secret manager). *(Fase #1)*

### 8.4 Minimização
- Só `user_hash` entra na abertura de sessão; PII direta é barrada na borda (RF2). *(MVP)*

## 9. Requisitos não-funcionais — Escalabilidade & Alta Disponibilidade *(Fase #2.5)*
- **Camada stateless:** API e workers sem estado local → **autoscaling horizontal** por CPU/memória/RPS. Sessão e estado vivem em Postgres/Redis, nunca na instância.
- **Mensageria:** requisições pesadas de validação não bloqueiam a thread da API — vão para uma **fila de alta velocidade (Redis Streams ou RabbitMQ)**; **workers** consomem em paralelo.
- **Cache & Rate limiting:** **Redis** para limite por API Key e cache de dados quentes (ex.: lookup de tenant), protegendo contra abuso/DDoS originado nos sites dos clientes.
- **Resiliência:** webhook com *retry* e *backoff*; idempotência por `transaction_id`; *dead-letter queue* para jobs falhos.

## 10. Arquitetura-alvo (fluxo assíncrono)
```
Plugin (consentimento → captura → cifra frame)
  │  POST /verify (frame cifrado + session_token)      [TLS 1.3]
  ▼
API Gateway / proxy ── Rate limiting (Redis, por API Key)
  ▼
API stateless ── valida sessão ── cifra frame → BUCKET TEMP (TTL 5min)
  │             └─ enfileira job ─────────────────────────────┐
  └─ responde 202 { status: "processando" }                   │
                                                               ▼
                                                       FILA (Redis Streams / RabbitMQ)
                                                               │ (workers paralelos)
                                                               ▼
                              Worker: AgeProviderPort → decisão híbrida (RF5)
                                      → grava auditoria (metadados) + hash do resultado
                                      → DELETA mídia do bucket (física, imediata)
                                      → Webhook assinado HMAC ao tenant (RF6)
```
**No MVP (#0)**, o trecho "bucket + fila + worker" colapsa numa chamada **in-process síncrona** dentro de `VerificationService.verify()`, com o frame só em memória e zerado ao fim. A fronteira do serviço é a mesma, então a evolução para #2.5 não reescreve a lógica.

## 11. Contrato do webhook (exemplo)
```json
{ "transaction_id": "98765", "status": "aprovado", "is_over_18": true }
```
`status` ∈ `aprovado | reprovado | documento_requerido`. Cabeçalho `X-Signature: <hmac-sha256-hex>`.

## 12. Fora de escopo / riscos conhecidos
- Margem de erro da estimativa etária exige corte conservador (calibrado no #2 com provedor real).
- Aderência jurídica fina (qual evidência a fiscalização aceita) a validar com jurídico antes do #2.
- O modelo assíncrono (#2.5) introduz **armazenamento temporário cifrado** da biometria (bucket TTL) — suavização consciente da pureza zero-storage do MVP, mitigada por cifragem + TTL curto + deleção física imediata.
- **Simulador interativo de carga/infra:** mencionado no adendo, porém **não fornecido**. Pode ser construído como artefato visual separado (frontend), fora deste plano de implementação.
