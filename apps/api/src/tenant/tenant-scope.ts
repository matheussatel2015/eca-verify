import { DataSource, EntityManager } from 'typeorm';

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

/** Runs fn on a connection scoped to tenantId via session-level set_config (for non-transactional readers/processors). */
export async function runScoped<T>(dataSource: DataSource, tenantId: string, fn: (mgr: EntityManager) => Promise<T>): Promise<T> {
  const qr = dataSource.createQueryRunner();
  await qr.connect();
  try {
    await qr.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
    return await fn(qr.manager);
  } finally {
    await qr.release();
  }
}
