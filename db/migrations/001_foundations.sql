-- 001_foundations.sql
-- Extensions, roles, tenant-context helpers, RLS scaffolding.
-- Conventions (all migrations):
--   * uuid PKs via gen_random_uuid(); timestamptz everywhere; created_at/updated_at on mutable tables
--   * every stateful row carries lock_version int for optimistic locking (WORKFLOW_STATES common rules)
--   * lifecycle state columns are text + CHECK constraints (not PG enums) so events can configure subsets
--   * tenant tables carry client_id (and event_id where scoped) with RLS; app role has no BYPASSRLS

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS pmp;
SET search_path TO pmp, public;

-- Tenant context: API sets these per transaction (SECURITY_MODEL §1).
CREATE OR REPLACE FUNCTION pmp.current_client_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.client_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION pmp.current_event_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.event_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION pmp.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
-- Platform staff sessions may set app.all_clients='on' (DXG staff see all clients; RLS policy honors it).
CREATE OR REPLACE FUNCTION pmp.is_platform_context() RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT current_setting('app.all_clients', true) = 'on' $$;

CREATE OR REPLACE FUNCTION pmp.touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- Idempotency keys for transition/mutation requests (WORKFLOW_STATES common rules).
CREATE TABLE idempotency_keys (
  key           uuid PRIMARY KEY,
  request_hash  text NOT NULL,
  response_body jsonb,
  status_code   int,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '48 hours'
);

-- Transactional outbox (dispatcher re-drives Redis from here; DATA_TIER §2).
CREATE TABLE outbox (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic        text NOT NULL,
  payload      jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz
);
CREATE INDEX outbox_undispatched_idx ON outbox (id) WHERE dispatched_at IS NULL;
