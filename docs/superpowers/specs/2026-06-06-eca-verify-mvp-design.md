# PRD — ECA Verify · Plataforma SaaS de Verificação Etária

**Versão:** 0.1 (MVP) · **Data:** 2026-06-06 · **Lei base:** 15.211/2025 (ECA Digital)

## 1. Visão
SaaS B2B *plug & play* que dá a plataformas terceiras (jogos, e-commerce, redes sociais) verificação de maioridade por análise facial com *liveness*, em conformidade com a Lei 15.211/2025 e **Privacy by Design** sob a LGPD. A biometria bruta **nunca** é armazenada nem entregue ao cliente — só o resultado da checagem.

## 2. Atores
- **Plataforma** — o motor de validação + admin (nós).
- **Tenant** — empresa-cliente que integra o serviço.
- **Usuário final** — pessoa que comprova a idade no site do tenant.

## 3. Decisões de arquitetura (travadas)
| Tema | Decisão |
|------|---------|
| Método de verificação | **Híbrido**: estimativa de idade por IA; documento exigido só na zona cinzenta perto do corte |
| Stack core | **Node.js / NestJS** |
| Plugin | **JS Vanilla** empacotado, *drop-in*, sem dependências de runtime |
| Motor de IA | **Adapter (`AgeProviderPort`)** com `MockAgeProvider` no MVP; provedor real trocável depois sem refatorar |
| Isolamento multi-tenant | **PostgreSQL + Row-Level Security** por `tenant_id` (isolamento lógico forte; migra para schema/DB dedicado se um tenant exigir) |
| Qualidade | **TDD** desde o MVP (regra híbrida e descarte efêmero testados antes do código) |

## 4. Roadmap (decomposição)
| # | Sub-projeto | Escopo |
|---|-------------|--------|
| **0** | **MVP vertical** *(esta spec)* | Fatia fina ponta-a-ponta |
| 1 | Core multi-tenant | Cadastro self-service, rotação/revogação de API Keys |
| 2 | Motor de IA real | Troca do mock pelo provedor via adapter |
| 3 | Dashboard + auditoria | Consumo, aprovações, relatórios |
| 4 | Billing | Planos, faturamento, limites |

## 5. Escopo do MVP (#0)
**Inclui:** 1 tenant *seedado* via script, 1 API Key, plugin mínimo (consentimento + captura + liveness), backend com IA *mock*, regra de decisão híbrida, webhook assinado, log de auditoria sem biometria.

**NÃO inclui:** cadastro self-service, dashboard, billing, provedor de IA real, etapa de documento completa (fica como *stub*).

## 6. Estrutura (monorepo)
- `apps/api` — NestJS (Tenant, Session, Verification, Webhook, Audit)
- `packages/plugin` — JS Vanilla empacotado
- `packages/sdk-types` — contratos/tipos compartilhados

## 7. Requisitos funcionais
**RF1 — Autenticação de tenant.** Guarda por `Authorization: Bearer <api-key>`; API key *seedada*.

**RF2 — Sessão de verificação.** Tenant faz `POST /sessions` com **apenas** `user_hash` anônimo → recebe `session_token` efêmero + URL que o plugin abre. Endpoint rejeita payload com PII direta (nome/CPF/e-mail).

**RF3 — Plugin.** Exibe política e colhe **consentimento explícito** antes de ativar a câmera; captura com *liveness*; envia frame cifrado + `session_token`.

**RF4 — Verificação.** Backend decifra em memória → `AgeProviderPort` retorna `{estimatedAge, livenessScore}` → aplica regra híbrida.

**RF5 — Regra híbrida.**
```
liveness < limiar           → reprovado (falha de prova de vida)
estimativa >= corte + margem → aprovado
estimativa <  corte - margem → reprovado
zona cinzenta               → status "documento_requerido" (stub)
```

**RF6 — Webhook.** `POST` assinado HMAC-SHA256 ao callback do tenant: `{transaction_id, status, is_over_18}`, com *retry*.

**RF7 — Auditoria.** Grava só metadados: tx id, tenant, timestamp, IP mascarado, status.

## 8. Requisitos não-funcionais — Privacy by Design
- **Efemeridade:** frame só em memória; descarte explícito no `finally`. **Nenhum** caminho de código escreve a imagem em disco/DB.
- **Schema sem biometria:** a tabela de auditoria **não possui coluna** para dado biométrico — impossível por design.
- **Minimização:** só `user_hash` entra; PII direta é barrada na borda.
- **Cripto:** TLS 1.3 em trânsito; AES-256 para segredos/logs sensíveis em repouso.

## 9. Contrato do webhook (exemplo)
```json
{ "transaction_id": "98765", "status": "aprovado", "is_over_18": true }
```
`status` ∈ `aprovado | reprovado | documento_requerido`.

## 10. Fora de escopo / riscos conhecidos
- Margem de erro da estimativa etária exige corte conservador (calibrado no #2 com provedor real).
- Aderência jurídica fina (qual evidência a fiscalização aceita) a validar com jurídico antes do #2.
