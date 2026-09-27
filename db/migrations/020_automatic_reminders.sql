-- 020_automatic_reminders.sql
-- Automatic upload reminders (D-096, FR-COM-002).
--
-- The event's "Reminders" setting was free text ("T-14 · T-7 · T-2 · missing-file only")
-- that nothing read: no reminder was ever sent on a schedule, and the Communications
-- screen said they were. It becomes `settings.reminder_days`, the days before the upload
-- deadline on which the reminder template goes to every speaker still missing a file,
-- and a scheduler in the API sends them.
--
-- `reminder_runs` records each reminder day once per event *and deadline*, so a restart, a
-- second API instance or a missed day can never send the same reminder twice — while
-- moving the deadline starts a fresh set of reminders for the new date.
SET search_path TO pmp, public;

CREATE TABLE IF NOT EXISTS reminder_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES events(id),
  client_id    uuid NOT NULL REFERENCES clients(id),
  -- The deadline these reminders counted back from.
  deadline     date NOT NULL,
  days_before  int  NOT NULL CHECK (days_before BETWEEN 0 AND 60),
  due_on       date NOT NULL,
  ran_at       timestamptz NOT NULL DEFAULT now(),
  -- 'sent' — the reminder went out; 'caught_up' — an earlier day that was missed and folded
  -- into a later run; 'failed' — the event could not send (e.g. no rooms), recorded so it is
  -- not retried every quarter hour.
  outcome      text NOT NULL CHECK (outcome IN ('sent', 'caught_up', 'failed')),
  queued       int  NOT NULL DEFAULT 0,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (event_id, deadline, days_before)
);
CREATE INDEX IF NOT EXISTS reminder_runs_event_idx ON reminder_runs (event_id);

ALTER TABLE reminder_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON reminder_runs;
CREATE POLICY tenant_isolation ON reminder_runs
  FOR ALL TO pmp_app
  USING (pmp.is_platform_context() OR client_id = pmp.current_client_id())
  WITH CHECK (pmp.is_platform_context() OR client_id = pmp.current_client_id());
-- DELETE too: runs are operational state, not history — clearing them re-arms an event's
-- reminders (the test suite resets its probe this way).
GRANT SELECT, INSERT, DELETE ON reminder_runs TO pmp_app;

-- The free-text setting goes; every event gets the SOW's default cadence, which is what
-- the text claimed. Nothing sends until an event is active and has a deadline.
UPDATE events
   SET settings = (settings - 'reminders') || '{"reminder_days": [14, 7, 2]}'::jsonb
 WHERE NOT (settings ? 'reminder_days');
