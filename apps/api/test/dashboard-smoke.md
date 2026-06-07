# Dashboard smoke (requires infra + API running + a seeded tenant with some audit rows)

1. Run migrations, start the API. Generate a few verifications so `audit_logs` has rows (run the verify/document smokes).
2. Open `http://localhost:3000/dashboard` in a browser — the page loads (HTML shell).
3. Paste the tenant API key, click "Carregar":
   - The cards show Total / Aprovado / Reprovado / Documento counts.
   - The SVG bar chart renders one bar per status.
   - The audit table lists recent events (tx id, status, masked IP, date).
4. Tenant isolation: with tenant A's key you must NOT see tenant B's rows (RLS). Verify by seeding two tenants and confirming each only sees its own counts.
5. Auth: calling `GET /dashboard/stats` without a Bearer key returns 401; `GET /dashboard` (the page) is public.
6. API checks:
   ```bash
   curl -s "http://localhost:3000/dashboard/stats" -H "Authorization: Bearer <key>"
   curl -s "http://localhost:3000/dashboard/audit?limit=10&status=aprovado" -H "Authorization: Bearer <key>"
   ```
