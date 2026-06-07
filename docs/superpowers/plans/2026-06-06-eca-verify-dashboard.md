# ECA Verify — #3 Dashboard + Auditoria Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each tenant a self-service dashboard to see their verification volume, approval/rejection breakdown, and a paginated audit log — served as a lightweight static page by the API, with all data behind the existing API-key auth and tenant-isolated by RLS.

**Architecture:** A `DashboardService` runs read queries against `audit_logs` inside a tenant-scoped connection (`set_config('app.tenant_id', …)`) — required because `audit_logs` has `FORCE ROW LEVEL SECURITY`, so unscoped reads return nothing. Pure helpers shape the aggregate stats and clamp pagination. A `DashboardController` exposes `GET /dashboard/stats` and `GET /dashboard/audit` (both `ApiKeyGuard`-protected) plus `GET /dashboard` which serves a single self-contained HTML page (inline CSS+JS, dependency-free SVG bar chart) that calls those JSON endpoints with the tenant's API key.

**Tech Stack:** Builds on the merged codebase (NestJS, TypeORM/Postgres, Jest). Reuses `ApiKeyGuard`/`TenantModule`, the `audit_logs` entity, and the RLS-scoping pattern used by the worker processors. No new runtime dependencies; the dashboard page is vanilla HTML/JS.

> **Auth decision:** the dashboard authenticates with the tenant's **API key (Bearer)** — the static page asks the user to paste it and sends it as `Authorization: Bearer`. A proper email/password login is out of scope (future #3b).
> **Reads need RLS scope:** every dashboard query MUST run through the scoped connection or it returns zero rows under `FORCE RLS`.

---

## File Structure

```
apps/api/src/dashboard/
├── dashboard-stats.ts        # shapeStats (pure, TDD)
├── pagination.ts             # parsePagination (pure, TDD)
├── dashboard.service.ts      # RLS-scoped getStats / getAudit (TDD w/ mocked DataSource)
├── dashboard.page.ts         # DASHBOARD_HTML (self-contained static page)
├── dashboard.controller.ts   # GET /dashboard, /dashboard/stats, /dashboard/audit
└── dashboard.module.ts       # wiring
apps/api/src/app.module.ts    # MODIFIED: import DashboardModule
apps/api/test/dashboard-smoke.md  # manual smoke
```

---

## Task 1: Pure helpers — stats shaping + pagination

**Files:**
- Create: `apps/api/src/dashboard/dashboard-stats.ts`, `apps/api/src/dashboard/pagination.ts`
- Test: `apps/api/src/dashboard/dashboard-stats.spec.ts`, `apps/api/src/dashboard/pagination.spec.ts`

- [ ] **Step 1: Write the failing tests**

`apps/api/src/dashboard/dashboard-stats.spec.ts`
```ts
import { shapeStats } from './dashboard-stats';

test('aggregates rows into total + per-status counts with zero-filled defaults', () => {
  const s = shapeStats([{ status: 'aprovado', count: 5 }, { status: 'reprovado', count: 2 }]);
  expect(s.total).toBe(7);
  expect(s.byStatus).toEqual({ aprovado: 5, reprovado: 2, documento_requerido: 0 });
});

test('returns all-zero summary for no rows', () => {
  expect(shapeStats([])).toEqual({ total: 0, byStatus: { aprovado: 0, reprovado: 0, documento_requerido: 0 } });
});

test('counts an unexpected status without crashing', () => {
  const s = shapeStats([{ status: 'processando', count: 3 }]);
  expect(s.total).toBe(3);
  expect(s.byStatus.processando).toBe(3);
});
```

`apps/api/src/dashboard/pagination.spec.ts`
```ts
import { parsePagination } from './pagination';

test('defaults to limit 20 offset 0', () => {
  expect(parsePagination({})).toEqual({ limit: 20, offset: 0 });
});

test('clamps limit to 1..100 and offset to >= 0', () => {
  expect(parsePagination({ limit: '500', offset: '-3' })).toEqual({ limit: 100, offset: 0 });
  expect(parsePagination({ limit: '0' })).toEqual({ limit: 1, offset: 0 });
});

test('falls back to defaults on non-numeric input', () => {
  expect(parsePagination({ limit: 'abc', offset: 'xyz' })).toEqual({ limit: 20, offset: 0 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest dashboard-stats pagination`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

`apps/api/src/dashboard/dashboard-stats.ts`
```ts
export interface StatsRow { status: string; count: number }
export interface StatsSummary { total: number; byStatus: Record<string, number> }

export function shapeStats(rows: StatsRow[]): StatsSummary {
  const byStatus: Record<string, number> = { aprovado: 0, reprovado: 0, documento_requerido: 0 };
  let total = 0;
  for (const r of rows) {
    const c = Number(r.count) || 0;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + c;
    total += c;
  }
  return { total, byStatus };
}
```

`apps/api/src/dashboard/pagination.ts`
```ts
export interface Pagination { limit: number; offset: number }

export function parsePagination(q: { limit?: unknown; offset?: unknown }): Pagination {
  const rawLimit = Number(q.limit ?? 20);
  const rawOffset = Number(q.offset ?? 0);
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.floor(rawLimit))) : 20;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, Math.floor(rawOffset)) : 0;
  return { limit, offset };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest dashboard-stats pagination`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/dashboard/dashboard-stats.ts apps/api/src/dashboard/dashboard-stats.spec.ts apps/api/src/dashboard/pagination.ts apps/api/src/dashboard/pagination.spec.ts
git commit -m "feat(dashboard): pure stats shaping + pagination helpers"
```

---

## Task 2: DashboardService (RLS-scoped reads)

**Files:**
- Create: `apps/api/src/dashboard/dashboard.service.ts`
- Test: `apps/api/src/dashboard/dashboard.service.spec.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/dashboard/dashboard.service.spec.ts`
```ts
import { DashboardService } from './dashboard.service';

function fakeDataSource(queryImpl: (sql: string, params?: any[]) => Promise<any>) {
  const manager = { query: jest.fn(queryImpl) };
  const qr = { connect: jest.fn(async () => {}), query: jest.fn(async () => {}), manager, release: jest.fn(async () => {}) };
  return { createQueryRunner: () => qr, qr, manager };
}

test('getStats sets the tenant scope then aggregates', async () => {
  const ds = fakeDataSource(async (sql: string) => {
    if (sql.includes('GROUP BY status')) return [{ status: 'aprovado', count: 4 }];
    return [];
  });
  const svc = new DashboardService(ds as any);
  const out = await svc.getStats('ten1', new Date('2026-01-01'), new Date('2026-12-31'));
  expect(ds.qr.query).toHaveBeenCalledWith(expect.stringContaining("set_config('app.tenant_id'"), ['ten1']);
  expect(out.total).toBe(4);
  expect(out.byStatus.aprovado).toBe(4);
  expect(ds.qr.release).toHaveBeenCalledTimes(1);
});

test('getAudit returns items + total with pagination echoed', async () => {
  const ds = fakeDataSource(async (sql: string) => {
    if (sql.includes('SELECT id')) return [{ id: 'tx1', masked_ip: '1.2.3.0', status: 'aprovado', created_at: new Date() }];
    if (sql.includes('COUNT(*)')) return [{ count: 1 }];
    return [];
  });
  const svc = new DashboardService(ds as any);
  const out = await svc.getAudit('ten1', { limit: 20, offset: 0 });
  expect(out.items).toHaveLength(1);
  expect(out.total).toBe(1);
  expect(out).toMatchObject({ limit: 20, offset: 0 });
  expect(ds.qr.query).toHaveBeenCalledWith(expect.stringContaining("set_config('app.tenant_id'"), ['ten1']);
});

test('getAudit applies a status filter when provided', async () => {
  const calls: string[] = [];
  const ds = fakeDataSource(async (sql: string) => {
    calls.push(sql);
    if (sql.includes('SELECT id')) return [];
    if (sql.includes('COUNT(*)')) return [{ count: 0 }];
    return [];
  });
  const svc = new DashboardService(ds as any);
  await svc.getAudit('ten1', { limit: 10, offset: 0 }, 'reprovado');
  expect(calls.some((s) => s.includes('WHERE status ='))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest dashboard.service`
Expected: FAIL — cannot find './dashboard.service'.

- [ ] **Step 3: Write `apps/api/src/dashboard/dashboard.service.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { shapeStats, StatsSummary } from './dashboard-stats';
import { Pagination } from './pagination';

export interface AuditPage {
  items: Array<{ id: string; masked_ip: string; status: string; created_at: Date }>;
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class DashboardService {
  constructor(private readonly dataSource: DataSource) {}

  // audit_logs has FORCE RLS — reads must run on a connection with app.tenant_id set.
  private async scoped<T>(tenantId: string, fn: (mgr: EntityManager) => Promise<T>): Promise<T> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    try {
      await qr.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
      return await fn(qr.manager);
    } finally {
      await qr.release();
    }
  }

  async getStats(tenantId: string, from: Date, to: Date): Promise<StatsSummary> {
    return this.scoped(tenantId, async (mgr) => {
      const rows = await mgr.query(
        `SELECT status, COUNT(*)::int AS count FROM audit_logs WHERE created_at BETWEEN $1 AND $2 GROUP BY status`,
        [from, to],
      );
      return shapeStats(rows);
    });
  }

  async getAudit(tenantId: string, page: Pagination, status?: string): Promise<AuditPage> {
    return this.scoped(tenantId, async (mgr) => {
      const where = status ? `WHERE status = $3` : ``;
      const items = await mgr.query(
        `SELECT id, masked_ip, status, created_at FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        status ? [page.limit, page.offset, status] : [page.limit, page.offset],
      );
      const countRows = await mgr.query(
        `SELECT COUNT(*)::int AS count FROM audit_logs ${status ? 'WHERE status = $1' : ''}`,
        status ? [status] : [],
      );
      return { items, total: countRows[0]?.count ?? 0, limit: page.limit, offset: page.offset };
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest dashboard.service`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/dashboard/dashboard.service.ts apps/api/src/dashboard/dashboard.service.spec.ts
git commit -m "feat(dashboard): RLS-scoped stats + audit queries"
```

---

## Task 3: Static dashboard page

**Files:**
- Create: `apps/api/src/dashboard/dashboard.page.ts`

> A single self-contained HTML page (inline CSS + JS, dependency-free SVG bars). Not unit-tested; validated by the smoke checklist.

- [ ] **Step 1: Write `apps/api/src/dashboard/dashboard.page.ts`**

```ts
export const DASHBOARD_HTML = `<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>ECA Verify — Dashboard</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 0; background: #0b1020; color: #e6e9f0; }
  header { padding: 16px 24px; background: #131a33; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  header h1 { font-size: 18px; margin: 0; margin-right: auto; }
  input, button { padding: 8px 10px; border-radius: 8px; border: 1px solid #2a3357; background: #0f1530; color: inherit; }
  button { cursor: pointer; background: #3b5bdb; border-color: #3b5bdb; }
  main { padding: 24px; max-width: 1000px; margin: 0 auto; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: #131a33; border: 1px solid #2a3357; border-radius: 12px; padding: 16px; }
  .card .n { font-size: 28px; font-weight: 700; }
  .card .l { opacity: .7; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #2a3357; font-size: 14px; }
  .bar { height: 14px; border-radius: 6px; }
  .err { color: #ff8787; margin: 8px 0; }
  .muted { opacity: .6; }
</style>
</head>
<body>
<header>
  <h1>ECA Verify · Dashboard</h1>
  <input id="key" type="password" placeholder="API Key (sk_...)" size="28"/>
  <input id="from" type="date"/>
  <input id="to" type="date"/>
  <button id="load">Carregar</button>
</header>
<main>
  <p id="err" class="err"></p>
  <div class="cards" id="cards"></div>
  <h3>Distribuição</h3>
  <svg id="chart" width="100%" height="120" role="img" aria-label="Distribuição por status"></svg>
  <h3>Auditoria (últimos eventos)</h3>
  <table><thead><tr><th>Transação</th><th>Status</th><th>IP (mascarado)</th><th>Data</th></tr></thead>
  <tbody id="rows"><tr><td colspan="4" class="muted">Informe a API Key e clique em Carregar.</td></tr></tbody></table>
</main>
<script>
const COLORS = { aprovado: '#2f9e44', reprovado: '#e03131', documento_requerido: '#f08c00' };
function headers() { return { Authorization: 'Bearer ' + document.getElementById('key').value.trim() }; }
function qs(o) { return Object.entries(o).filter(([,v]) => v).map(([k,v]) => k+'='+encodeURIComponent(v)).join('&'); }
async function load() {
  const err = document.getElementById('err'); err.textContent = '';
  const from = document.getElementById('from').value, to = document.getElementById('to').value;
  try {
    const sres = await fetch('/dashboard/stats?' + qs({ from, to }), { headers: headers() });
    if (!sres.ok) throw new Error('stats ' + sres.status);
    const stats = await sres.json();
    renderCards(stats); renderChart(stats.byStatus);
    const ares = await fetch('/dashboard/audit?' + qs({ limit: 50 }), { headers: headers() });
    if (!ares.ok) throw new Error('audit ' + ares.status);
    renderRows((await ares.json()).items);
  } catch (e) { err.textContent = 'Falha ao carregar: ' + e.message + ' (verifique a API Key).'; }
}
function renderCards(s) {
  const c = document.getElementById('cards');
  const card = (l, n) => '<div class="card"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>';
  c.innerHTML = card('Total', s.total) + card('Aprovado', s.byStatus.aprovado||0)
    + card('Reprovado', s.byStatus.reprovado||0) + card('Documento', s.byStatus.documento_requerido||0);
}
function renderChart(by) {
  const entries = Object.entries(by); const max = Math.max(1, ...entries.map(([,v]) => v));
  const svg = document.getElementById('chart'); const bw = 100 / entries.length;
  svg.innerHTML = entries.map(([k,v], i) => {
    const h = Math.round((v / max) * 90); const x = i * bw;
    return '<rect class="bar" x="' + (x+1) + '%" y="' + (100-h) + '" width="' + (bw-2) + '%" height="' + h
      + '" fill="' + (COLORS[k]||'#868e96') + '"></rect>'
      + '<text x="' + (x+bw/2) + '%" y="115" fill="#e6e9f0" font-size="11" text-anchor="middle">' + k + ' (' + v + ')</text>';
  }).join('');
}
function renderRows(items) {
  const tb = document.getElementById('rows');
  if (!items || !items.length) { tb.innerHTML = '<tr><td colspan="4" class="muted">Sem eventos no período.</td></tr>'; return; }
  tb.innerHTML = items.map(r => '<tr><td>' + r.id + '</td><td>' + r.status + '</td><td>' + r.masked_ip
    + '</td><td>' + new Date(r.created_at).toLocaleString('pt-BR') + '</td></tr>').join('');
}
document.getElementById('load').addEventListener('click', load);
</script>
</body>
</html>`;
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/dashboard/dashboard.page.ts
git commit -m "feat(dashboard): self-contained static dashboard page"
```

---

## Task 4: Controller + module wiring

**Files:**
- Create: `apps/api/src/dashboard/dashboard.controller.ts`, `apps/api/src/dashboard/dashboard.module.ts`
- Modify: `apps/api/src/app.module.ts`

- [ ] **Step 1: Write `apps/api/src/dashboard/dashboard.controller.ts`**

```ts
import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../tenant/api-key.guard';
import { DashboardService } from './dashboard.service';
import { parsePagination } from './pagination';
import { DASHBOARD_HTML } from './dashboard.page';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  // Public HTML shell; the data endpoints below require the API key.
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  page(): string {
    return DASHBOARD_HTML;
  }

  @Get('stats')
  @UseGuards(ApiKeyGuard)
  async stats(@Req() req: any, @Query('from') from?: string, @Query('to') to?: string) {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from ? new Date(from) : new Date(toDate.getTime() - THIRTY_DAYS_MS);
    const summary = await this.service.getStats(req.tenant.id, fromDate, toDate);
    return { from: fromDate.toISOString(), to: toDate.toISOString(), ...summary };
  }

  @Get('audit')
  @UseGuards(ApiKeyGuard)
  async audit(@Req() req: any, @Query() q: Record<string, unknown>) {
    const status = typeof q.status === 'string' && q.status ? q.status : undefined;
    return this.service.getAudit(req.tenant.id, parsePagination(q), status);
  }
}
```

- [ ] **Step 2: Write `apps/api/src/dashboard/dashboard.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [TenantModule], // provides ApiKeyGuard + ApiKeyService
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
```

- [ ] **Step 3: Register in `apps/api/src/app.module.ts`**

Add `import { DashboardModule } from './dashboard/dashboard.module';` and add `DashboardModule` to the `imports` array of `@Module`.

- [ ] **Step 4: Verify build + full suite**

Run: `npx tsc -b apps/api && npx jest`
Expected: tsc clean; all suites green (no regressions).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/dashboard/dashboard.controller.ts apps/api/src/dashboard/dashboard.module.ts apps/api/src/app.module.ts
git commit -m "feat(dashboard): controller + module (GET /dashboard, /stats, /audit)"
```

---

## Task 5: Dashboard smoke (manual)

**Files:**
- Create: `apps/api/test/dashboard-smoke.md`

- [ ] **Step 1: Write `apps/api/test/dashboard-smoke.md`**

````markdown
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
````

- [ ] **Step 2: Run the full unit suite**

Run: `npx jest`
Expected: all suites green, including the new dashboard-stats, pagination, dashboard.service suites.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/dashboard-smoke.md
git commit -m "test(dashboard): dashboard smoke checklist"
```

---

## Self-Review Notes

- **Spec coverage (PRD §3 Épico 1 "Dashboard de Consumo"):** request volume + approval/rejection breakdown → `GET /dashboard/stats` (Tasks 1-2, shapeStats); audit report → `GET /dashboard/audit` paginated (Tasks 1-2, parsePagination + getAudit); the visual panel → static page (Task 3) served by the controller (Task 4). Faturamento (billing) is explicitly out of scope here — it is sub-project #4.
- **Tenant isolation:** every data query runs through `DashboardService.scoped(...)` which sets `app.tenant_id` on the connection, so `FORCE RLS` on `audit_logs` enforces per-tenant data — a tenant can never read another's rows even though they share the table. The `set_config(...,$1)` call is asserted in the service tests.
- **Auth:** `/dashboard/stats` and `/dashboard/audit` use `ApiKeyGuard` (reused from `TenantModule`); `/dashboard` (HTML) is intentionally public (it carries no data; the browser supplies the key at call time).
- **Type consistency:** `StatsSummary`/`StatsRow` (Task 1) consumed by `DashboardService.getStats` and the controller; `Pagination` (Task 1) consumed by `parsePagination` + `getAudit`; `AuditPage` returned by `getAudit`. `req.tenant.id` is set by `ApiKeyGuard` (existing).
- **No placeholders:** every code step is complete, including the full static page. No new runtime dependencies.
- **DB-dependent steps:** the smoke (Task 5) needs infra; all logic is unit-tested with a mocked `DataSource`/queryRunner.
```
