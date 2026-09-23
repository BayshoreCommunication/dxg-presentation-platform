-- 012_event_archive.sql
-- Archiving an event is reversible (D-061).
--
-- `events.status` has allowed 'archived' since 002, but nothing could set it except
-- test cleanup writing SQL directly. Archiving from the portfolio needs to remember
-- what the event was, so restoring puts a live event back live and a draft back into
-- setup rather than guessing one of them.
--
-- Additive and nullable: an event that has never been archived has none of these.
SET search_path TO pmp, public;

ALTER TABLE events ADD COLUMN IF NOT EXISTS archived_at   timestamptz;
ALTER TABLE events ADD COLUMN IF NOT EXISTS archived_by   uuid REFERENCES users(id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS archived_from text
  CHECK (archived_from IS NULL OR archived_from IN ('draft','active','closed'));

COMMENT ON COLUMN events.archived_from IS
  'The status the event had when it was archived; restoring returns it there. NULL when not archived.';
