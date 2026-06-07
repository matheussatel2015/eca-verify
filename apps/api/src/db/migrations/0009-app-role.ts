import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Introduce a dedicated, NON-superuser login role (`eca_app`) for the application
 * runtime so Row-Level Security actually enforces tenant isolation.
 *
 * Runs as `eca` (the DB owner/superuser) during migrations. The runtime
 * (api/worker) connects as `eca_app`, which has NOSUPERUSER + NOBYPASSRLS,
 * so RLS policies are no longer bypassed.
 *
 * The password ('eca_app') is DEV ONLY — never reuse it anywhere shared/remote.
 */
export class AppRole1717632000009 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // Idempotently create / enforce a constrained login role.
    await q.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eca_app') THEN
          CREATE ROLE eca_app LOGIN PASSWORD 'eca_app'
            NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        ELSE
          ALTER ROLE eca_app LOGIN PASSWORD 'eca_app'
            NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        END IF;
      END
      $$;
    `);

    // Connect + schema usage.
    await q.query(`GRANT CONNECT ON DATABASE eca_verify TO eca_app`);
    await q.query(`GRANT USAGE ON SCHEMA public TO eca_app`);

    // Least-privilege DML on everything that already exists.
    await q.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eca_app`);
    await q.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eca_app`);

    // Auto-grant the same DML to objects future migrations (as `eca`) create.
    await q.query(`
      ALTER DEFAULT PRIVILEGES FOR ROLE eca IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eca_app
    `);
    await q.query(`
      ALTER DEFAULT PRIVILEGES FOR ROLE eca IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO eca_app
    `);

    // --- Make RLS robust now that eca_app no longer bypasses it ---------------
    //
    // Defense in depth: an UNSET/empty `app.tenant_id` GUC must mean "no tenant"
    // (NULL → matches no rows), NOT a hard `''::uuid` cast error. Under the old
    // superuser role the policy expression was never evaluated; under eca_app it
    // is, so harden every isolation policy to use NULLIF(...,'').
    const scopedTables = ['sessions', 'audit_logs', 'document_sessions', 'consent_records', 'discard_log'];
    for (const t of scopedTables) {
      await q.query(`DROP POLICY IF EXISTS ${t}_isolation ON ${t}`);
      await q.query(`
        CREATE POLICY ${t}_isolation ON ${t}
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      `);
    }

    // The ephemeral session tokens (sessions / document_sessions) are consumed by
    // the END-USER plugin, which holds ONLY the random secret token, not the tenant
    // id — so the consume step is inherently cross-tenant and cannot be tenant-scoped.
    // Under the superuser app role this "just worked" by bypassing RLS. Now we expose
    // it as a narrow, token-gated SECURITY DEFINER function owned by `eca`: the body
    // runs with eca's privileges (RLS-bypassing) but ONLY to atomically consume one
    // row matched by its unique secret token. Everything else stays under RLS.
    await q.query(`
      CREATE OR REPLACE FUNCTION consume_session(p_token text)
      RETURNS TABLE (id uuid, tenant_id uuid, user_hash text, session_token text, created_at timestamptz)
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public
      AS $$
        DELETE FROM sessions WHERE session_token = p_token
        RETURNING id, tenant_id, user_hash, session_token, created_at;
      $$;
    `);
    await q.query(`
      CREATE OR REPLACE FUNCTION consume_document_session(p_token text)
      RETURNS TABLE (id uuid, tenant_id uuid, transaction_id uuid, session_token text, created_at timestamptz)
      LANGUAGE sql
      SECURITY DEFINER
      SET search_path = public
      AS $$
        DELETE FROM document_sessions WHERE session_token = p_token
        RETURNING id, tenant_id, transaction_id, session_token, created_at;
      $$;
    `);
    // Functions are owned by eca (the migration runner) → SECURITY DEFINER runs as eca.
    await q.query(`REVOKE ALL ON FUNCTION consume_session(text) FROM PUBLIC`);
    await q.query(`REVOKE ALL ON FUNCTION consume_document_session(text) FROM PUBLIC`);
    await q.query(`GRANT EXECUTE ON FUNCTION consume_session(text) TO eca_app`);
    await q.query(`GRANT EXECUTE ON FUNCTION consume_document_session(text) TO eca_app`);
  }

  async down(q: QueryRunner): Promise<void> {
    // Drop the consume functions and restore the original (non-NULLIF) policies.
    await q.query(`DROP FUNCTION IF EXISTS consume_session(text)`);
    await q.query(`DROP FUNCTION IF EXISTS consume_document_session(text)`);
    const scopedTables = ['sessions', 'audit_logs', 'document_sessions', 'consent_records', 'discard_log'];
    for (const t of scopedTables) {
      await q.query(`DROP POLICY IF EXISTS ${t}_isolation ON ${t}`);
      await q.query(`
        CREATE POLICY ${t}_isolation ON ${t}
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
      `);
    }

    // Best-effort teardown. Order matters: drop default privileges + grants,
    // reassign/clean owned objects, then drop the role.
    await q.query(`
      ALTER DEFAULT PRIVILEGES FOR ROLE eca IN SCHEMA public
        REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM eca_app
    `);
    await q.query(`
      ALTER DEFAULT PRIVILEGES FOR ROLE eca IN SCHEMA public
        REVOKE USAGE, SELECT ON SEQUENCES FROM eca_app
    `);
    await q.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM eca_app`);
    await q.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM eca_app`);
    await q.query(`REVOKE USAGE ON SCHEMA public FROM eca_app`);
    await q.query(`REVOKE CONNECT ON DATABASE eca_verify FROM eca_app`);

    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eca_app') THEN
          -- eca_app owns nothing (only eca creates objects), but keep this safe.
          EXECUTE 'REASSIGN OWNED BY eca_app TO eca';
          EXECUTE 'DROP OWNED BY eca_app';
          DROP ROLE IF EXISTS eca_app;
        END IF;
      END
      $$;
    `);
  }
}
