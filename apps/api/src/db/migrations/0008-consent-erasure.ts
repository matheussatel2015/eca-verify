import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConsentErasure1717632000008 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE consent_records (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        user_hash text NOT NULL,
        policy_version text NOT NULL,
        scope text NOT NULL DEFAULT 'age_verification',
        masked_ip text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_consent_tenant_user ON consent_records (tenant_id, user_hash, created_at DESC)`);

    await q.query(`
      CREATE TABLE discard_log (
        id uuid PRIMARY KEY,
        transaction_id uuid NOT NULL,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        what text NOT NULL,
        discarded_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_discard_tenant_tx ON discard_log (tenant_id, transaction_id)`);

    // Row-Level Security FORCE on both tables — same pattern as 0001.
    for (const t of ['consent_records', 'discard_log']) {
      await q.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
      await q.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`);
      await q.query(`
        CREATE POLICY ${t}_isolation ON ${t}
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)`);
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS discard_log`);
    await q.query(`DROP TABLE IF EXISTS consent_records`);
  }
}
