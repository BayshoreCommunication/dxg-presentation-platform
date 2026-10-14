-- 043_event_staff_history.sql
-- D-181: support staff and technicians are freed from an event when it is archived, and the day
-- after it ends: their event roles go (so the event no longer appears as theirs, and they no
-- longer reach it), and who worked it is kept here — shown as "Worked this event" on Event
-- assignments. Clients and DXG Admins are not released. Re-running changes nothing.
SET search_path TO pmp, public;

CREATE TABLE IF NOT EXISTS event_staff_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events(id),
  client_id   uuid NOT NULL REFERENCES clients(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  role        text NOT NULL,
  assigned_at timestamptz,
  released_at timestamptz NOT NULL DEFAULT now(),
  reason      text NOT NULL CHECK (reason IN ('archived', 'ended'))
);
CREATE INDEX IF NOT EXISTS event_staff_history_event_idx ON event_staff_history (event_id);

ALTER TABLE event_staff_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_staff_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON event_staff_history;
CREATE POLICY tenant_isolation ON event_staff_history
  FOR ALL TO pmp_app
  USING (pmp.is_platform_context() OR client_id = pmp.current_client_id())
  WITH CHECK (pmp.is_platform_context() OR client_id = pmp.current_client_id());
GRANT SELECT, INSERT ON event_staff_history TO pmp_app;
