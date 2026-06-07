import { MigrationInterface, QueryRunner } from 'typeorm';

export class TenantRequiredAge1717632000007 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // Per-tenant cutoff age; defaults to 18 so existing tenants keep current behaviour.
    await q.query(`ALTER TABLE tenants ADD COLUMN required_age int NOT NULL DEFAULT 18`);
    // Defensive guard so a bad UPDATE can never store an impossible cutoff.
    await q.query(`ALTER TABLE tenants ADD CONSTRAINT tenants_required_age_range CHECK (required_age BETWEEN 1 AND 120)`);
    // Derived age band on the audit trail (string metadata, never biometrics).
    await q.query(`ALTER TABLE verification_records ADD COLUMN age_band text`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE verification_records DROP COLUMN age_band`);
    await q.query(`ALTER TABLE tenants DROP CONSTRAINT tenants_required_age_range`);
    await q.query(`ALTER TABLE tenants DROP COLUMN required_age`);
  }
}
