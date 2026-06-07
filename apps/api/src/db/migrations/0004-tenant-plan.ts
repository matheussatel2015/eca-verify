import { MigrationInterface, QueryRunner } from 'typeorm';

export class TenantPlan1717632000004 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE tenants ADD COLUMN plan_id text NOT NULL DEFAULT 'free'`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE tenants DROP COLUMN plan_id`);
  }
}
