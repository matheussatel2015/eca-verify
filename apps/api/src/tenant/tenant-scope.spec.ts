import { withTenantScope } from './tenant-scope';

test('sets app.tenant_id via set_config before running the callback', async () => {
  const calls: Array<{ sql: string; params?: any[] }> = [];
  const qr = { query: async (sql: string, params?: any[]) => { calls.push({ sql, params }); return []; } };
  let ranAfterScope = false;

  await withTenantScope(qr, 'tenant-123', async () => { ranAfterScope = true; });

  expect(calls[0].sql).toContain("set_config('app.tenant_id'");
  expect(calls[0].params).toEqual(['tenant-123']);
  expect(ranAfterScope).toBe(true);
});
