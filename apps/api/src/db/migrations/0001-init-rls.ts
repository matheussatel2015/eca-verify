import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitRls0001 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    await q.query(`
      CREATE TABLE tenants (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        api_key_hash text NOT NULL,
        webhook_url text NOT NULL,
        webhook_secret text NOT NULL
      )`);
    await q.query(`
      CREATE TABLE sessions (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        user_hash text NOT NULL,
        session_token text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`
      CREATE TABLE audit_logs (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        masked_ip text NOT NULL,
        status text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    // Row-Level Security: every row scoped to the current tenant.
    for (const t of ['sessions', 'audit_logs']) {
      await q.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`);
      await q.query(`
        CREATE POLICY ${t}_isolation ON ${t}
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)`);
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS audit_logs`);
    await q.query(`DROP TABLE IF EXISTS sessions`);
    await q.query(`DROP TABLE IF EXISTS tenants`);
  }
}
