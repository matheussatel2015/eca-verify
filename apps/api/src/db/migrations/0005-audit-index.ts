import { MigrationInterface, QueryRunner } from 'typeorm';

export class AuditIndex1717632000005 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE INDEX idx_audit_tenant_created ON audit_logs (tenant_id, created_at DESC)`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX idx_audit_tenant_created`);
  }
}
