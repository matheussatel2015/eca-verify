export interface Queryable {
  query(sql: string, params?: any[]): Promise<any>;
}

/**
 * Sets the per-transaction tenant id so Postgres RLS policies isolate rows.
 * Must run inside the same transaction/connection as the queries in `fn`.
 */
export async function withTenantScope<T>(qr: Queryable, tenantId: string, fn: () => Promise<T>): Promise<T> {
  await qr.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
  return fn();
}
