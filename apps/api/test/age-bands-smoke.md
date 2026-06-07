# Age bands + per-tenant cutoff smoke (requires infra)

1. Run migrations (0001–0007), start API + workers, seed a tenant.
2. Read the cutoff: `curl -H "Authorization: Bearer <api-key>" http://localhost:3000/tenants/me/settings` → `{ "required_age": 18 }`.
3. Raise it: `curl -X PUT -H "Authorization: Bearer <api-key>" -H "Content-Type: application/json" -d '{"required_age":21}' http://localhost:3000/tenants/me/settings` → `{ "required_age": 21 }`.
4. Bad value: `-d '{"required_age":0}'` → 400; `-d '{"required_age":"x"}'` → 400.
5. Run a verification for a 19-year-old face with cutoff=21 → now lands in the grey zone / `documento_requerido` (cutoff is the tenant's, not the global env).
6. Inspect the trail: `psql ... -c "SELECT method, estimated_age, cutoff_age, age_band, decision_reason FROM verification_records ORDER BY created_at DESC LIMIT 5;"` → `cutoff_age` reflects the tenant's 21, `age_band` populated (e.g. `adulto` for 19? NO — 19 is `adulto` by band but below the tenant cutoff; band and verdict are independent — verify both columns make sense).
7. The final webhook payload now carries `age_band` (optional).
8. Cross-tenant isolation: a second tenant's key reading `/tenants/me/settings` returns ITS own cutoff (RLS), never the first tenant's.

> LEGAL: the tool reports the band. Parental linkage/consent for <16 is the TENANT's responsibility — out of scope here.
