# Tenant core smoke (requires Postgres + the API running)

1. Run migrations 0001 + 0002, then start the API (`npx ts-node apps/api/src/main.ts`).
2. Register a tenant:
   ```bash
   curl -s -X POST http://localhost:3000/tenants/register -H "Content-Type: application/json" \
     -d '{"name":"Acme","webhook_url":"https://acme.test/hook"}'
   ```
   Expect 201 JSON with `tenant_id`, `api_key` (sk_...), `webhook_secret`.
3. Use the returned key to create a session (proves the api_keys lookup works):
   ```bash
   curl -s -X POST http://localhost:3000/sessions -H "Authorization: Bearer <api_key>" \
     -H "Content-Type: application/json" -d '{"user_hash":"u1"}'
   ```
   Expect 200 with a `session_token`.
4. Rotate: `POST /tenants/me/api-keys` with the current key → returns a new key. Both keys work.
5. Revoke the first key: `DELETE /tenants/me/api-keys/<id>` (authenticating with the second key) → the first key now returns 401 on `/sessions`.
6. Confirm the tenant row stores an ENCRYPTED secret:
   ```bash
   docker compose exec -T postgres psql -U eca -d eca_verify -c "SELECT webhook_secret FROM tenants LIMIT 1;"
   ```
   Expect a `base64.base64.base64` token, not a readable `whsec_...` value.
