import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApiKeys0002 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE api_keys (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL REFERENCES tenants(id),
        key_hash text NOT NULL UNIQUE,
        label text,
        created_at timestamptz NOT NULL DEFAULT now(),
        revoked_at timestamptz
      )`);
    // Move any existing tenant API key hash into the new table.
    await q.query(`
      INSERT INTO api_keys (id, tenant_id, key_hash, label, created_at)
      SELECT gen_random_uuid(), id, api_key_hash, 'migrated', now()
      FROM tenants
      WHERE api_key_hash IS NOT NULL`);
    await q.query(`ALTER TABLE tenants DROP COLUMN api_key_hash`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE tenants ADD COLUMN api_key_hash text`);
    await q.query(`
      UPDATE tenants t SET api_key_hash = k.key_hash
      FROM api_keys k WHERE k.tenant_id = t.id AND k.revoked_at IS NULL`);
    await q.query(`DROP TABLE api_keys`);
  }
}
