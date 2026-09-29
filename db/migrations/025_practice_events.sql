-- 025_practice_events.sql
-- Practice events (D-116): DXG staff learn the platform by doing every job on a realistic
-- event that can reach nobody. A practice event is an ordinary event with a flag — the
-- same screens, services, audit and outbox — so what is practised is the real thing.
--   - `events.is_practice` marks it; `practice_owner` is who started it (the per-person
--     limit, and the name an administrator sees). Only a practice event has an owner.
--   - `clients.is_practice` marks the one made-up client practice events belong to, so it
--     is never offered when a real event is created.
--   - `communications.status = 'practice'`: an email a practice event produced, which the
--     dispatcher recorded and did not send.
SET search_path TO pmp, public;

ALTER TABLE events  ADD COLUMN IF NOT EXISTS is_practice    boolean NOT NULL DEFAULT false;
ALTER TABLE events  ADD COLUMN IF NOT EXISTS practice_owner uuid REFERENCES users(id);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_practice    boolean NOT NULL DEFAULT false;

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_practice_owner_check;
ALTER TABLE events ADD CONSTRAINT events_practice_owner_check
  CHECK (is_practice OR practice_owner IS NULL);

CREATE INDEX IF NOT EXISTS events_practice_owner_idx ON events (practice_owner) WHERE is_practice;

COMMENT ON COLUMN events.is_practice IS
  'Practice event (D-116): fictional speakers, no email ever sent, never counted with real events.';

ALTER TABLE communications DROP CONSTRAINT IF EXISTS communications_status_check;
ALTER TABLE communications ADD CONSTRAINT communications_status_check
  CHECK (status IN ('queued','sent','delivered','opened','clicked','bounced','complained','failed','practice'));
