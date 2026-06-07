import { MigrationInterface, QueryRunner } from 'typeorm';

export class DashboardUsers1717632000011 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE dashboard_users (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        email text NOT NULL UNIQUE,
        password_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_dashboard_users_tenant ON dashboard_users (tenant_id)`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE dashboard_users`);
  }
}
