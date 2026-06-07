# Dashboard login smoke

1. Provision a dashboard user (tenant admin, API key):
   `curl -s -X POST http://localhost:3000/auth/users -H "Authorization: Bearer <api_key>" -H "Content-Type: application/json" -d '{"email":"op@acme.com","password":"segredo123"}'` → `{id,email}`.
2. Log in: `curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"op@acme.com","password":"segredo123"}'` → `{token, token_type:"Bearer"}`.
3. Use the token on the dashboard data API: `curl -s http://localhost:3000/dashboard/stats -H "Authorization: Bearer <token>"` → the tenant's stats (RLS-scoped).
4. `GET /auth/me` with the token → `{tenant_id, user:{id,email}}`.
5. Wrong password → `POST /auth/login` returns 401. Unknown/short password to `/auth/users` → 400.
6. In the browser, open `http://localhost:3000/dashboard`, type email+senha, click "Entrar" — cards/chart/table load without pasting an API key. (The API-key field still works for programmatic access.)
