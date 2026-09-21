-- 011_app_role_login.sql
-- Let the application actually be `pmp_app` (I-4, NFR-SEC-06, D-035).
--
-- Migration 005 built the whole isolation story — RLS enabled and FORCEd on every
-- tenant table, policies granted `TO pmp_app`, append-only tables revoked — and then
-- the application connected as `pmp`, the schema owner and a superuser. A superuser
-- bypasses row security entirely, so every policy in 005 has been dead since the day
-- it was written: a session scoped to a client that does not exist still read every
-- event, speaker and file version in the database.
--
-- `pmp_app` could not log in, which is why it was never used. It can now.
--
-- The owner keeps DDL: migrations and the seed continue to connect as `pmp`. The
-- application, the worker and the dispatcher connect as `pmp_app`, which owns nothing
-- and cannot create, drop or alter anything.
SET search_path TO pmp, public;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pmp_app') THEN
    CREATE ROLE pmp_app NOLOGIN;
  END IF;
END $$;

-- LOGIN, but no password here.
--
-- A role is cluster-wide and a migration is per-database, so setting the password here
-- means migrating a *second* database silently rotates the credential the first one is
-- using — which is exactly what happened while this was being written, twice, and cost
-- an hour to see. It is also the wrong place for a secret: this file is in the
-- repository and a deployed installation must not take its application password from
-- it.
--
-- `scripts/ensureAppRole.ts` sets it, from PGPASSWORD, and `npm run db:reset` calls it.
ALTER ROLE pmp_app WITH LOGIN;

-- CONNECT is granted to PUBLIC by default; naming it makes the intent explicit and
-- survives an installation that has revoked the default.
DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO pmp_app', current_database());
END $$;
GRANT USAGE ON SCHEMA pmp TO pmp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pmp TO pmp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pmp TO pmp_app;

-- Tables added by migrations 006–010 were never granted by 005's one-time statement,
-- and the next migration to add one would have the same problem. Default privileges
-- close that gap for anything the owner creates from here.
ALTER DEFAULT PRIVILEGES FOR ROLE pmp GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pmp_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pmp GRANT USAGE, SELECT ON SEQUENCES TO pmp_app;

-- After the blanket grant above, not before: append-only means append-only, and the
-- grant would otherwise hand back exactly what 005 took away.
REVOKE UPDATE, DELETE ON audit_records, workflow_transitions, launch_logs,
  communication_events, archive_downloads FROM pmp_app;

-- The migration ledger is the owner's business. The application never reads or writes
-- it, and granting it would let a compromised app rewrite its own schema history.
REVOKE ALL ON schema_migrations FROM pmp_app;
