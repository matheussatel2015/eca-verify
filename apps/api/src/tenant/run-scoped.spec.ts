import { runScoped } from './tenant-scope';

interface RecordedCall {
  sql: string;
  params?: any[];
}

function fakeDataSource() {
  const order: string[] = [];
  const queries: RecordedCall[] = [];
  const manager = { __tag: 'manager' };
  const qr = {
    connect: jest.fn(async () => {
      order.push('connect');
    }),
    query: jest.fn(async (sql: string, params?: any[]) => {
      order.push('query');
      queries.push({ sql, params });
    }),
    manager,
    release: jest.fn(async () => {
      order.push('release');
    }),
  };
  return { createQueryRunner: () => qr, qr, manager, order, queries };
}

test('scopes via set_config with [tenantId] before invoking fn, passes qr.manager, then releases', async () => {
  const ds = fakeDataSource();
  let seenManager: unknown;
  const result = await runScoped(ds as any, 'ten1', async (mgr) => {
    ds.order.push('fn');
    seenManager = mgr;
    return 'value';
  });

  expect(result).toBe('value');
  expect(seenManager).toBe(ds.manager);
  expect(ds.qr.query).toHaveBeenCalledWith(expect.stringContaining("set_config('app.tenant_id'"), ['ten1']);
  // set_config must run before fn
  expect(ds.order).toEqual(['connect', 'query', 'fn', 'release']);
});

test('releases the query runner even when fn throws', async () => {
  const ds = fakeDataSource();
  await expect(
    runScoped(ds as any, 'ten1', async () => {
      throw new Error('boom');
    }),
  ).rejects.toThrow('boom');

  expect(ds.qr.release).toHaveBeenCalledTimes(1);
});
