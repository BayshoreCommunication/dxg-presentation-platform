-- 039_srr_open.sql
-- The Speaker Ready Room's event-day switch (client review, D-156): a DXG Admin or support
-- staff opens it on the event day; while closed, no one checks in, takes a file in at a
-- check-in or signs off. Events that already exist stay open, so nothing in use changes;
-- new events start closed. Re-running changes nothing.
SET search_path TO pmp, public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'pmp' AND table_name = 'events' AND column_name = 'srr_open') THEN
    ALTER TABLE events ADD COLUMN srr_open boolean NOT NULL DEFAULT true;
    ALTER TABLE events ALTER COLUMN srr_open SET DEFAULT false;
  END IF;
END $$;
