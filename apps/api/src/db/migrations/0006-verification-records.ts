import { MigrationInterface, QueryRunner } from 'typeorm';

export class VerificationRecords1717632000006 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE verification_records (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        status text NOT NULL,
        is_over_18 boolean NOT NULL,
        method text NOT NULL,
        estimated_age int,
        liveness_score double precision,
        cutoff_age int NOT NULL,
        margin int NOT NULL,
        liveness_threshold double precision NOT NULL,
        provider text NOT NULL,
        model_version text NOT NULL,
        decision_reason text NOT NULL,
        proof_jwt text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_vrec_tenant_created ON verification_records (tenant_id, created_at DESC)`);
    await q.query(`ALTER TABLE verification_records ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE verification_records FORCE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY verification_records_isolation ON verification_records
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE verification_records`);
  }
}
