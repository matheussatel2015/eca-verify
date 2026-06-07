# Consent + erasure-proof smoke (requires infra)

1. Run migrations (0001–0008), start API + workers, seed a tenant.
2. Open a session WITH consent:
   `curl -X POST -H "Authorization: Bearer <api-key>" -H "Content-Type: application/json" \
     -d '{"user_hash":"uh_abc","policy_version":"2026-06-01","consent":true}' http://localhost:3000/sessions`
   → 200 with `session_token` + `plugin_url`.
3. Missing consent: `-d '{"user_hash":"uh","policy_version":"v1"}'` → 400; `consent:false` → 400; missing `policy_version` → 400.
4. PII still barred: a body with `cpf`/`email` → 400 (assertNoPii unchanged).
5. Run a verification through to completion (frame or document path). The processor deletes the media in `finally`.
6. Erasure proof: `psql ... -c "SELECT transaction_id, what, discarded_at FROM discard_log ORDER BY discarded_at DESC LIMIT 5;"`
   → one row per completed tx (`what` = `frame` or `document`), NO media columns.
7. Consent retrieval: `curl -H "Authorization: Bearer <api-key>" http://localhost:3000/consent/uh_abc`
   → JSON with `consents[]` (policy_version, scope, masked_ip, created_at) + the erasure_proof_note.
8. Cross-tenant isolation: a second tenant's key on `/consent/uh_abc` → empty `consents[]` (RLS), never the first tenant's rows.
9. No biometrics: inspect both tables — only metadata columns, never an image.

> LEGAL: the platform records the TECHNICAL consent (camera/verification) + the deletion proof.
> Parental consent in the legal sense (responsável legal de menor de 16) is the TENANT's responsibility — out of scope here.
