-- 034_speaker_notifications.sql
-- What the DXG team tells a speaker, inside the speaker site (Travis, 2026-10-11): a review
-- decision, an approval. Written in the same transaction as the decision, read by the speaker
-- site's bell; the email still goes too. Re-running changes nothing.
SET search_path TO pmp, public;

CREATE TABLE IF NOT EXISTS speaker_notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  speaker_id      uuid NOT NULL REFERENCES speakers(id),
  event_id        uuid NOT NULL REFERENCES events(id),
  client_id       uuid NOT NULL REFERENCES clients(id),
  kind            text NOT NULL CHECK (kind IN ('changes_requested', 'rejected', 'approved')),
  title           text NOT NULL,
  body            text NOT NULL DEFAULT '',
  slot_id         uuid REFERENCES slots(id),
  file_version_id uuid REFERENCES file_versions(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  read_at         timestamptz
);
CREATE INDEX IF NOT EXISTS speaker_notifications_speaker_idx ON speaker_notifications (speaker_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON speaker_notifications TO pmp_app;
