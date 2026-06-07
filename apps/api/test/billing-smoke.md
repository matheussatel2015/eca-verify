# Billing smoke (requires infra + API running + a seeded tenant)

1. Run migrations 0001–0004, start the API + Redis.
2. Plan catalog: `curl -s http://localhost:3000/billing/plans` → lists free/pro/scale.
3. Current plan/usage: `curl -s http://localhost:3000/billing/plan -H "Authorization: Bearer <key>"` → plan_id `free`, used `0`, quota `100`.
4. Consume quota: create sessions (`POST /sessions`) and watch `used` climb on `/billing/plan`.
5. Quota block: lower the `free` quota temporarily (or loop sessions past 100) → `POST /sessions` returns **402** once `used >= quota`.
6. Upgrade: `curl -s -X PUT http://localhost:3000/billing/plan -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d '{"plan_id":"pro"}'` → now quota is 10000 and sessions succeed again.
7. Invoice: `curl -s http://localhost:3000/billing/invoice -H "Authorization: Bearer <key>"` → period (YYYY-MM), plan, monthly_price_cents, quota, used, remaining.
8. Tenant isolation: tenant A's usage counter is independent of tenant B's (different Redis keys).
