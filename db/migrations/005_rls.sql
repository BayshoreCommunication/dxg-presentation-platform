-- 005_rls.sql
-- Row-level security: client isolation on every tenant table (SECURITY_MODEL §1, NFR-SEC-06).
-- The application role (pmp_app) has no BYPASSRLS. DXG platform staff sessions set
-- app.all_clients='on'; client-scoped sessions set app.client_id. Event-level and
-- role-level authorization (event_roles, comment lanes, release permissions) is enforced
-- in the application authorization layer on top of this hard client boundary.
SET search_path TO pmp, public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pmp_app') THEN
    CREATE ROLE pmp_app NOLOGIN;
  END IF;
END $$;

GRANT USAGE ON SCHEMA pmp TO pmp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pmp TO pmp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pmp TO pmp_app;
-- Append-only for the app role regardless of RLS:
REVOKE UPDATE, DELETE ON audit_records, workflow_transitions, launch_logs,
  communication_events, archive_downloads FROM pmp_app;
-- launch_logs/communication_events receive inserts only; corrections are new rows.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'events','rooms','tracks','event_days','sessions','slots','speakers','speaker_assignments',
    'speaker_tokens','files','file_versions','inspection_findings','workflow_transitions','comments',
    'room_agents','room_files','sync_manifests','launch_logs','srr_checkins','usb_ingestions',
    'sign_offs','receipts','room_media_assignments','communication_templates','communications',
    'communication_events','schedule_imports','legal_holds','archive_packages','archive_downloads',
    'derived_objects','report_exports'
  ] LOOP
    EXECUTE format('ALTER TABLE pmp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE pmp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON pmp.%I
        FOR ALL TO pmp_app
        USING (pmp.is_platform_context() OR client_id = pmp.current_client_id())
        WITH CHECK (pmp.is_platform_context() OR client_id = pmp.current_client_id())
    $p$, t);
  END LOOP;
END $$;

-- clients table: platform context sees all; client context sees itself.
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients FORCE ROW LEVEL SECURITY;
CREATE POLICY client_self ON clients FOR ALL TO pmp_app
  USING (pmp.is_platform_context() OR id = pmp.current_client_id())
  WITH CHECK (pmp.is_platform_context());

-- audit_records: readable within client scope (or platform); insert-only via app.
ALTER TABLE audit_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_records FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_records FOR SELECT TO pmp_app
  USING (pmp.is_platform_context() OR client_id = pmp.current_client_id());
CREATE POLICY audit_insert ON audit_records FOR INSERT TO pmp_app
  WITH CHECK (pmp.is_platform_context() OR client_id = pmp.current_client_id());

-- users / client_grants / retention_policies / venues / idempotency_keys / outbox:
-- platform-scoped tables; RLS restricting to platform context, app layer mediates exposure.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','client_grants','venues','retention_policies','event_roles'] LOOP
    EXECUTE format('ALTER TABLE pmp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE pmp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY platform_only ON pmp.%I FOR ALL TO pmp_app USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
-- NOTE: users/event_roles/venues stay app-mediated (no client_id column); the true-policy rows
-- make the RLS posture explicit and reviewable — tightening them is a later migration once the
-- permission matrix (P0-E8) is signed off. idempotency_keys/outbox are internal (no app-role grant needed
-- beyond inserts/selects already granted).
