import { MigrationInterface, QueryRunner } from 'typeorm';

export class DocumentSession1717632000003 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE document_sessions (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        transaction_id uuid NOT NULL,
        session_token text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`ALTER TABLE document_sessions ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE document_sessions FORCE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY document_sessions_isolation ON document_sessions
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE document_sessions`);
  }
}
