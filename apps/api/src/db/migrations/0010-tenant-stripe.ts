import { MigrationInterface, QueryRunner } from 'typeorm';

export class TenantStripe1717632000010 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE tenants ADD COLUMN stripe_customer_id text`);
    await q.query(`ALTER TABLE tenants ADD COLUMN stripe_subscription_id text`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE tenants DROP COLUMN stripe_subscription_id`);
    await q.query(`ALTER TABLE tenants DROP COLUMN stripe_customer_id`);
  }
}
