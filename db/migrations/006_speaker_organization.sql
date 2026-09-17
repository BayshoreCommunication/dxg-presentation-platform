-- 006_speaker_organization.sql
-- Speakers carry an organization (shown in the speaker directory, M04/screen 5).
-- Additive: nullable column, no rewrite of existing rows.
SET search_path TO pmp, public;

ALTER TABLE speakers ADD COLUMN IF NOT EXISTS organization text;

CREATE INDEX IF NOT EXISTS speakers_search_idx ON speakers (event_id, lower(full_name));
