-- 003_files_workflow_sync.sql
-- Files/versions with lifecycle states, inspection, review, comments,
-- room agents, per-room sync, SRR, launch logs. SRS M06–M12; WORKFLOW_STATES §1–§4.
SET search_path TO pmp, public;

-- Logical file per slot (a talk's presentation, or event-level shared/holding media).
CREATE TABLE files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events(id),
  client_id   uuid NOT NULL REFERENCES clients(id),
  slot_id     uuid REFERENCES slots(id),             -- NULL for holding slides / shared media
  kind        text NOT NULL DEFAULT 'presentation'
              CHECK (kind IN ('presentation','holding_slide','shared_media')),
  display_name text NOT NULL,
  retention_flag text,                                -- per-file retention override marker
  lock_version int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_slot_idx ON files (slot_id);
CREATE INDEX files_event_idx ON files (event_id);

CREATE TABLE file_versions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id          uuid NOT NULL REFERENCES files(id),
  event_id         uuid NOT NULL REFERENCES events(id),
  client_id        uuid NOT NULL REFERENCES clients(id),
  version_number   int NOT NULL,
  original_filename text NOT NULL,
  content_type     text NOT NULL,                    -- allowlist enforced in app (FR-FILE-001)
  size_bytes       bigint NOT NULL CHECK (size_bytes >= 0),
  sha256           bytea,                             -- set at checksum verification (NFR-INT-01)
  s3_key           text NOT NULL,                     -- content-addressed under library bucket
  source           text NOT NULL DEFAULT 'portal' CHECK (source IN ('portal','srr_usb','srr_manual','system')),
  uploaded_by_speaker uuid REFERENCES speakers(id),
  uploaded_by_user    uuid REFERENCES users(id),
  upload_session   jsonb,                             -- resumable multipart bookkeeping (FR-FILE-003)
  processing_state text NOT NULL DEFAULT 'uploading'  -- WORKFLOW_STATES §1
                   CHECK (processing_state IN
                     ('uploading','uploaded','checksum_failed','scanning','quarantined','stored')),
  inspection_state text NOT NULL DEFAULT 'pending'    -- WORKFLOW_STATES §2
                   CHECK (inspection_state IN
                     ('pending','inspecting','passed','passed_with_warnings','technician_review','failed')),
  review_state     text NOT NULL DEFAULT 'awaiting_review' -- WORKFLOW_STATES §3
                   CHECK (review_state IN
                     ('awaiting_review','in_review','changes_requested','approved',
                      'superseded','rejected','rolled_back')),
  approved_at      timestamptz,
  approved_by      uuid REFERENCES users(id),
  lock_version     int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_id, version_number)
);
CREATE INDEX file_versions_file_idx ON file_versions (file_id);
CREATE INDEX file_versions_review_queue_idx ON file_versions (event_id, review_state)
  WHERE review_state IN ('awaiting_review','in_review');
CREATE INDEX file_versions_sha_idx ON file_versions (event_id, sha256); -- duplicate detection (FR-FILE-004)

CREATE TABLE inspection_findings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_version_id uuid NOT NULL REFERENCES file_versions(id),
  event_id        uuid NOT NULL REFERENCES events(id),
  client_id       uuid NOT NULL REFERENCES clients(id),
  check_code      text NOT NULL,                     -- corruption|password|size_type|aspect|fonts|linked_media|codec|macros|external_links|malware|metadata|dup_filename
  severity        text NOT NULL CHECK (severity IN ('info','warning','blocking')),
  detail          jsonb NOT NULL DEFAULT '{}',       -- incl. slide references (SRS §18.5)
  waived_by       uuid REFERENCES users(id),         -- waiver stays visible (FR-INSP-003)
  waived_reason   text,
  waived_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (waived_by IS NULL OR waived_reason IS NOT NULL)
);
CREATE INDEX findings_version_idx ON inspection_findings (file_version_id);

-- All lifecycle transitions in one journal (audit detail; WORKFLOW_STATES common rules).
CREATE TABLE workflow_transitions (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        uuid NOT NULL REFERENCES events(id),
  client_id       uuid NOT NULL REFERENCES clients(id),
  subject_type    text NOT NULL CHECK (subject_type IN
                    ('file_version.processing','file_version.inspection','file_version.review',
                     'room_file.sync','session','archive_package')),
  subject_id      uuid NOT NULL,
  room_id         uuid REFERENCES rooms(id),         -- for room_file.sync subjects
  from_state      text NOT NULL,
  to_state        text NOT NULL,
  action          text NOT NULL,
  actor_user_id   uuid REFERENCES users(id),
  actor_agent_id  uuid,                              -- FK added in this file after room_agents
  reason          text,                              -- mandatory for overrides (enforced in app + audit)
  is_override     boolean NOT NULL DEFAULT false,
  idempotency_key uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_override OR reason IS NOT NULL)
);
CREATE INDEX transitions_subject_idx ON workflow_transitions (subject_type, subject_id);

-- Three comment lanes (FR-REV-003); lane visibility enforced by RLS + app checks.
CREATE TABLE comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES events(id),
  client_id       uuid NOT NULL REFERENCES clients(id),
  file_version_id uuid NOT NULL REFERENCES file_versions(id),
  lane            text NOT NULL CHECK (lane IN ('internal','client_visible','speaker_visible')),
  author_user_id  uuid REFERENCES users(id),
  author_speaker_id uuid REFERENCES speakers(id),
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(author_user_id, author_speaker_id) = 1)
);
CREATE INDEX comments_version_idx ON comments (file_version_id);

CREATE TABLE room_agents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id            uuid NOT NULL REFERENCES rooms(id),
  event_id           uuid NOT NULL REFERENCES events(id),
  client_id          uuid NOT NULL REFERENCES clients(id),
  device_fingerprint text NOT NULL,
  public_key         bytea NOT NULL,                 -- device credential (SECURITY_MODEL §2)
  agent_version      text,
  release_channel    text NOT NULL DEFAULT 'stable' CHECK (release_channel IN ('stable','event_pinned')),
  registered_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at         timestamptz,
  last_heartbeat_at  timestamptz,                    -- heartbeat detail goes to metrics, latest here
  lock_version       int NOT NULL DEFAULT 0
);
CREATE INDEX room_agents_room_idx ON room_agents (room_id) WHERE revoked_at IS NULL;
ALTER TABLE workflow_transitions
  ADD CONSTRAINT transitions_agent_fk FOREIGN KEY (actor_agent_id) REFERENCES room_agents(id);

-- Per-room sync state: one file version × room (WORKFLOW_STATES §4).
CREATE TABLE room_files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_version_id uuid NOT NULL REFERENCES file_versions(id),
  room_id         uuid NOT NULL REFERENCES rooms(id),
  event_id        uuid NOT NULL REFERENCES events(id),
  client_id       uuid NOT NULL REFERENCES clients(id),
  sync_state      text NOT NULL DEFAULT 'assigned'
                  CHECK (sync_state IN
                    ('assigned','syncing','synced','acknowledged','active','obsolete','sync_failed')),
  acknowledged_by uuid REFERENCES users(id),
  acknowledged_at timestamptz,
  synced_sha256   bytea,                              -- checksum verified on the room machine
  lock_version    int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_version_id, room_id)
);
CREATE INDEX room_files_room_state_idx ON room_files (room_id, sync_state);

-- Delta manifests issued to agents (FR-SYNC-001); reconciliation dedup via manifest ids.
CREATE TABLE sync_manifests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id      uuid NOT NULL REFERENCES rooms(id),
  agent_id     uuid NOT NULL REFERENCES room_agents(id),
  event_id     uuid NOT NULL REFERENCES events(id),
  client_id    uuid NOT NULL REFERENCES clients(id),
  manifest     jsonb NOT NULL,                        -- adds/removes/purges with version ids + sha256
  issued_at    timestamptz NOT NULL DEFAULT now(),
  applied_at   timestamptz,
  applied_result jsonb
);
CREATE INDEX sync_manifests_room_idx ON sync_manifests (room_id, issued_at DESC);

-- Launch logs from agents; offline queue replays are deduped by (agent_id, agent_seq).
CREATE TABLE launch_logs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_id      uuid NOT NULL REFERENCES room_agents(id),
  room_id       uuid NOT NULL REFERENCES rooms(id),
  event_id      uuid NOT NULL REFERENCES events(id),
  client_id     uuid NOT NULL REFERENCES clients(id),
  file_version_id uuid REFERENCES file_versions(id),
  agent_seq     bigint NOT NULL,                      -- FR-SYNC-003 replay dedup
  action        text NOT NULL,                        -- launch|stop|holding_screen|error|override
  occurred_at   timestamptz NOT NULL,
  detail        jsonb NOT NULL DEFAULT '{}',
  received_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, agent_seq)
);

-- SRR (M10).
CREATE TABLE srr_checkins (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES events(id),
  client_id    uuid NOT NULL REFERENCES clients(id),
  speaker_id   uuid NOT NULL REFERENCES speakers(id),
  technician_id uuid NOT NULL REFERENCES users(id),
  station      text,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  departed_at  timestamptz,
  lock_version int NOT NULL DEFAULT 0
);
CREATE INDEX srr_checkins_event_idx ON srr_checkins (event_id, checked_in_at DESC);

CREATE TABLE usb_ingestions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id      uuid NOT NULL REFERENCES srr_checkins(id),
  event_id        uuid NOT NULL REFERENCES events(id),
  client_id       uuid NOT NULL REFERENCES clients(id),
  file_version_id uuid REFERENCES file_versions(id), -- NULL if quarantined before versioning
  scan_result     text NOT NULL CHECK (scan_result IN ('clean','infected','error')),
  scan_detail     jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sign_offs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkin_id      uuid NOT NULL REFERENCES srr_checkins(id),
  event_id        uuid NOT NULL REFERENCES events(id),
  client_id       uuid NOT NULL REFERENCES clients(id),
  speaker_id      uuid NOT NULL REFERENCES speakers(id),
  file_version_id uuid NOT NULL REFERENCES file_versions(id), -- exact version bound (FR-SRR-004)
  signed_at       timestamptz NOT NULL DEFAULT now(),
  signature_blob  bytea,                              -- captured signature image, optional
  receipt_id      uuid                                -- set after receipt row created
);

CREATE TABLE receipts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sign_off_id  uuid NOT NULL REFERENCES sign_offs(id),
  event_id     uuid NOT NULL REFERENCES events(id),
  client_id    uuid NOT NULL REFERENCES clients(id),
  content      jsonb NOT NULL,                        -- rendered receipt payload (print/email)
  emailed_to   citext,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sign_offs ADD CONSTRAINT sign_offs_receipt_fk FOREIGN KEY (receipt_id) REFERENCES receipts(id);

-- Room assignment of holding slides / shared media (FR-EVT-003).
CREATE TABLE room_media_assignments (
  room_id    uuid NOT NULL REFERENCES rooms(id),
  file_id    uuid NOT NULL REFERENCES files(id),
  event_id   uuid NOT NULL REFERENCES events(id),
  client_id  uuid NOT NULL REFERENCES clients(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, file_id)
);
