-- 002_identity_events_schedule.sql
-- Clients, users/roles, events, venues, schedule (rooms/tracks/days/sessions/slots),
-- speakers and assignments. SRS M01, M03, M04; FR-EVT-*, FR-SPK-*, FR-ADMIN-001.
SET search_path TO pmp, public;

CREATE TABLE clients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  external_ref text,                                  -- RFPILOT_INTEGRATION correlation, optional
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  display_name  text NOT NULL,
  oidc_subject  text UNIQUE,                          -- staff; NULL for client-only users
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Client access grants (client admins / scoped reviewers; NFR-SEC-06).
CREATE TABLE client_grants (
  user_id    uuid NOT NULL REFERENCES users(id),
  client_id  uuid NOT NULL REFERENCES clients(id),
  granted_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, client_id)
);

CREATE TABLE venues (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  address    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES clients(id),
  venue_id       uuid REFERENCES venues(id),
  name           text NOT NULL,
  starts_on      date NOT NULL,
  ends_on        date NOT NULL,
  timezone       text NOT NULL DEFAULT 'America/New_York',
  branding       jsonb NOT NULL DEFAULT '{}',
  settings       jsonb NOT NULL DEFAULT '{}',        -- deadlines, reminder cadence, workflow config subset
  freeze_window  jsonb,                              -- deploy-gate window override (EDGE_APP_TIER §5)
  status         text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','active','closed','archived')),
  duplicated_from uuid REFERENCES events(id),        -- FR-EVT-002 provenance
  lock_version   int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX events_client_idx ON events (client_id);

-- Event-scoped role assignment (SRS §5 roles; FR-ADMIN-001).
CREATE TABLE event_roles (
  user_id    uuid NOT NULL REFERENCES users(id),
  event_id   uuid NOT NULL REFERENCES events(id),
  role       text NOT NULL CHECK (role IN (
               'platform_admin','project_manager','presentation_manager','srr_technician',
               'room_technician','content_reviewer','client_event_admin','scoped_reviewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id, role)
);

CREATE TABLE rooms (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES events(id),
  client_id    uuid NOT NULL REFERENCES clients(id),
  name         text NOT NULL,
  capacity     int,
  room_code    text UNIQUE,                          -- agent registration (FR-AGT-001), issued per room
  lock_version int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, name)
);

CREATE TABLE tracks (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  uuid NOT NULL REFERENCES events(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  name      text NOT NULL,
  UNIQUE (event_id, name)
);

CREATE TABLE event_days (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id  uuid NOT NULL REFERENCES events(id),
  client_id uuid NOT NULL REFERENCES clients(id),
  day_date  date NOT NULL,
  UNIQUE (event_id, day_date)
);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events(id),
  client_id     uuid NOT NULL REFERENCES clients(id),
  room_id       uuid REFERENCES rooms(id),
  track_id      uuid REFERENCES tracks(id),
  day_id        uuid REFERENCES event_days(id),
  external_id   text,                                -- import update-by-key (FR-IMP-002)
  title         text NOT NULL,
  kind          text NOT NULL DEFAULT 'session' CHECK (kind IN ('session','break','panel')),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  session_state text NOT NULL DEFAULT 'scheduled'    -- WORKFLOW_STATES §5
                CHECK (session_state IN ('scheduled','moved','replaced','canceled','completed')),
  lock_version  int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX sessions_event_idx ON sessions (event_id);
CREATE UNIQUE INDEX sessions_external_key ON sessions (event_id, external_id) WHERE external_id IS NOT NULL;

-- A slot is one talk within a session (panels have several). Files hang off slots.
CREATE TABLE slots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid NOT NULL REFERENCES sessions(id),
  event_id      uuid NOT NULL REFERENCES events(id),
  client_id     uuid NOT NULL REFERENCES clients(id),
  title         text NOT NULL,
  position      int NOT NULL DEFAULT 0,
  final_locked  boolean NOT NULL DEFAULT false,      -- final onsite lock flag (WORKFLOW_STATES §3)
  restricted    boolean NOT NULL DEFAULT false,      -- restricted-from-distribution flag
  lock_version  int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX slots_session_idx ON slots (session_id);

CREATE TABLE speakers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES clients(id),
  event_id       uuid NOT NULL REFERENCES events(id), -- speaker records are event-scoped; merge preserves history
  email          citext,
  full_name      text NOT NULL,
  bio            text,
  accessibility  text,
  notes          text,                                -- internal
  release_permission text NOT NULL DEFAULT 'undecided' -- FR-SPK-003 drives archive/PDF rules
                 CHECK (release_permission IN ('undecided','full','pdf_only','none')),
  merged_into    uuid REFERENCES speakers(id),        -- duplicate merge keeps the old row (FR-SPK-001)
  lock_version   int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX speakers_event_idx ON speakers (event_id);
CREATE INDEX speakers_email_idx ON speakers (event_id, email);

CREATE TABLE speaker_assignments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  speaker_id  uuid NOT NULL REFERENCES speakers(id),
  slot_id     uuid NOT NULL REFERENCES slots(id),
  event_id    uuid NOT NULL REFERENCES events(id),
  client_id   uuid NOT NULL REFERENCES clients(id),
  role        text NOT NULL DEFAULT 'speaker' CHECK (role IN ('speaker','moderator','panelist')),
  replaced_by uuid REFERENCES speaker_assignments(id), -- replacement speaker keeps history (SRS §18.9)
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (speaker_id, slot_id, role)
);

-- Speaker portal access tokens: hashed, recipient-bound, revocable (SECURITY_MODEL §2).
CREATE TABLE speaker_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  speaker_id  uuid NOT NULL REFERENCES speakers(id),
  event_id    uuid NOT NULL REFERENCES events(id),
  client_id   uuid NOT NULL REFERENCES clients(id),
  token_hash  bytea NOT NULL UNIQUE,
  kind        text NOT NULL DEFAULT 'magic_link' CHECK (kind IN ('magic_link','one_time_code')),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  last_used_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Holding slides / shared media assigned to rooms (FR-EVT-003) reference file_versions (003).
