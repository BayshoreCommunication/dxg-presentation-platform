-- 004_comms_archive_audit.sql
-- Communications, imports, archive/retention, derived objects, report exports,
-- hash-chained audit. SRS M02, M05, M13–M15.
SET search_path TO pmp, public;

CREATE TABLE communication_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid NOT NULL REFERENCES clients(id),
  event_id   uuid REFERENCES events(id),             -- NULL = client-level template
  name       text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,                          -- merge fields as {{placeholders}} (FR-COM-001)
  lock_version int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE communications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES events(id),
  client_id    uuid NOT NULL REFERENCES clients(id),
  speaker_id   uuid REFERENCES speakers(id),
  template_id  uuid REFERENCES communication_templates(id),
  kind         text NOT NULL DEFAULT 'email' CHECK (kind IN ('email')),
  to_address   citext NOT NULL,
  subject      text NOT NULL,
  provider_message_id text UNIQUE,                   -- SES message id for webhook joins (FR-COM-003)
  status       text NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued','sent','delivered','opened','clicked','bounced','complained','failed')),
  status_detail jsonb NOT NULL DEFAULT '{}',
  sent_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX communications_speaker_idx ON communications (speaker_id, created_at DESC);

-- Delivery webhook events appended raw (idempotent by provider event id).
CREATE TABLE communication_events (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  communication_id   uuid NOT NULL REFERENCES communications(id),
  event_id           uuid NOT NULL REFERENCES events(id),
  client_id          uuid NOT NULL REFERENCES clients(id),
  provider_event_id  text UNIQUE,
  event_type         text NOT NULL,
  payload            jsonb NOT NULL,
  occurred_at        timestamptz NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now()
);

-- Schedule imports (M02): committed transactionally; diff stored for re-import preview.
CREATE TABLE schedule_imports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES events(id),
  client_id    uuid NOT NULL REFERENCES clients(id),
  uploaded_by  uuid NOT NULL REFERENCES users(id),
  filename     text NOT NULL,
  s3_key       text NOT NULL,
  column_mapping jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'validating'
               CHECK (status IN ('validating','validated','failed','committed','discarded')),
  row_errors   jsonb NOT NULL DEFAULT '[]',
  diff         jsonb,                                -- add/update/remove preview (FR-IMP-002)
  committed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE retention_policies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    uuid REFERENCES clients(id),          -- NULL = platform default (FR-ADMIN-003)
  event_id     uuid REFERENCES events(id),           -- per-event override
  name         text NOT NULL,
  retain_days  int NOT NULL CHECK (retain_days > 0),
  notice_days  int NOT NULL DEFAULT 30,
  lock_version int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE legal_holds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES clients(id),
  event_id    uuid REFERENCES events(id),
  file_id     uuid REFERENCES files(id),
  reason      text NOT NULL,                         -- SECURITY_MODEL §6
  placed_by   uuid NOT NULL REFERENCES users(id),
  placed_at   timestamptz NOT NULL DEFAULT now(),
  lifted_by   uuid REFERENCES users(id),
  lifted_at   timestamptz
);

CREATE TABLE archive_packages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events(id),
  client_id     uuid NOT NULL REFERENCES clients(id),
  scope         jsonb NOT NULL DEFAULT '{}',         -- filters (FR-ARCH-001)
  archive_state text NOT NULL DEFAULT 'draft'        -- WORKFLOW_STATES §6
                CHECK (archive_state IN ('draft','building','ready','delivered','expired','deleted')),
  manifest      jsonb,
  s3_key        text,
  link_expires_at timestamptz,                       -- ≤7 days (NFR-SEC-05)
  built_by      uuid REFERENCES users(id),
  deletion_certificate jsonb,                        -- SECURITY_MODEL §6 certificate
  lock_version  int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE archive_downloads (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  package_id  uuid NOT NULL REFERENCES archive_packages(id),
  event_id    uuid NOT NULL REFERENCES events(id),
  client_id   uuid NOT NULL REFERENCES clients(id),
  downloaded_by uuid REFERENCES users(id),
  ip          inet,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- Every derivative tracked at creation so certified deletion is enumerable (SECURITY_MODEL §6.3).
CREATE TABLE derived_objects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_version_id uuid NOT NULL REFERENCES file_versions(id),
  event_id        uuid NOT NULL REFERENCES events(id),
  client_id       uuid NOT NULL REFERENCES clients(id),
  kind            text NOT NULL CHECK (kind IN ('preview','pdf','inspection_artifact','thumbnail')),
  bucket          text NOT NULL,
  s3_key          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX derived_objects_version_idx ON derived_objects (file_version_id);

-- Report exports (M13): generated CSVs, role-scoped.
CREATE TABLE report_exports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES events(id),
  client_id    uuid NOT NULL REFERENCES clients(id),
  report_code  text NOT NULL,                        -- collection|missing|pending|warnings|approvals|revisions|checkins|sync|launch|comms|archive
  requested_by uuid NOT NULL REFERENCES users(id),
  s3_key       text,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','building','ready','failed')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Append-only hash-chained audit (FR-ADMIN-002, SECURITY_MODEL §5).
-- Chain is per event partition (event_id, or zero-uuid partition for platform-level actions);
-- appends serialize on pg_advisory_xact_lock(hashtext(partition)) in the app write path.
CREATE TABLE audit_records (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  partition_id uuid NOT NULL,                        -- event id or 00000000-0000-0000-0000-000000000000
  client_id    uuid,
  seq          bigint NOT NULL,                      -- dense per partition
  actor_user_id uuid,
  actor_agent_id uuid,
  action       text NOT NULL,
  subject_type text NOT NULL,
  subject_id   text NOT NULL,
  detail       jsonb NOT NULL DEFAULT '{}',          -- references only, never file content/PII bodies
  reason       text,
  prev_hash    bytea NOT NULL,
  record_hash  bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partition_id, seq)
);
CREATE INDEX audit_partition_idx ON audit_records (partition_id, seq);

-- Block UPDATE/DELETE at the database layer (append-only).
CREATE OR REPLACE FUNCTION pmp.reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit_records is append-only'; END $$;
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_records
  FOR EACH ROW EXECUTE FUNCTION pmp.reject_mutation();
