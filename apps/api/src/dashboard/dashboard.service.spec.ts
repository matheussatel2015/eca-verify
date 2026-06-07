import { DashboardService } from './dashboard.service';

function fakeDataSource(queryImpl: (sql: string, params?: any[]) => Promise<any>) {
  const manager = { query: jest.fn(queryImpl) };
  const qr = { connect: jest.fn(async () => {}), query: jest.fn(async (_sql: string, _params?: any[]) => {}), manager, release: jest.fn(async () => {}) };
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
  // Defense-in-depth: the aggregation query must filter by tenant_id explicitly
  // with the tenantId bound as the first parameter (RLS is bypassed by the app role).
  expect(ds.manager.query).toHaveBeenCalledWith(
    expect.stringContaining('GROUP BY status'),
    expect.arrayContaining(['ten1']),
  );
  const statsCall = ds.manager.query.mock.calls.find((c: any[]) => String(c[0]).includes('GROUP BY status'));
  expect(statsCall?.[1]?.[0]).toBe('ten1');
});

test('getStats query filters by tenant_id explicitly (regression: RLS bypass leak)', async () => {
  const ds = fakeDataSource(async (sql: string) => {
    if (sql.includes('GROUP BY status')) return [{ status: 'aprovado', count: 1 }];
    return [];
  });
  const svc = new DashboardService(ds as any);
  await svc.getStats('ten1', new Date('2026-01-01'), new Date('2026-12-31'));
  const statsCall = ds.manager.query.mock.calls.find((c: any[]) => String(c[0]).includes('GROUP BY status'));
  expect(statsCall?.[0]).toContain('tenant_id =');
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
  // Defense-in-depth: both the items and count queries must bind tenantId as $1.
  const itemsCall = ds.manager.query.mock.calls.find((c: any[]) => String(c[0]).includes('SELECT id'));
  const countCall = ds.manager.query.mock.calls.find((c: any[]) => String(c[0]).includes('COUNT(*)'));
  expect(itemsCall?.[1]?.[0]).toBe('ten1');
  expect(countCall?.[1]?.[0]).toBe('ten1');
});

test('getAudit queries filter by tenant_id explicitly (regression: RLS bypass leak)', async () => {
  const ds = fakeDataSource(async (sql: string) => {
    if (sql.includes('SELECT id')) return [];
    if (sql.includes('COUNT(*)')) return [{ count: 0 }];
    return [];
  });
  const svc = new DashboardService(ds as any);
  await svc.getAudit('ten1', { limit: 20, offset: 0 });
  const itemsCall = ds.manager.query.mock.calls.find((c: any[]) => String(c[0]).includes('SELECT id'));
  const countCall = ds.manager.query.mock.calls.find((c: any[]) => String(c[0]).includes('COUNT(*)'));
  expect(itemsCall?.[0]).toContain('tenant_id =');
  expect(countCall?.[0]).toContain('tenant_id =');
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
  // Status filter is now ANDed onto the mandatory tenant_id predicate.
  expect(calls.some((s) => s.includes('status ='))).toBe(true);
  expect(calls.some((s) => s.includes('tenant_id =') && s.includes('status ='))).toBe(true);
});
