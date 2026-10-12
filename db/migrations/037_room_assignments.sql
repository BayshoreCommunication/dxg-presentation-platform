-- 037_room_assignments.sql
-- Which DXG Technician staff work which rooms (client review, D-154): a technician sees and
-- loads only the rooms they are assigned to on Room sync. Admins and support staff assign
-- them there. Re-running changes nothing.
SET search_path TO pmp, public;

CREATE TABLE IF NOT EXISTS room_assignments (
  user_id     uuid NOT NULL REFERENCES users(id),
  room_id     uuid NOT NULL REFERENCES rooms(id),
  event_id    uuid NOT NULL REFERENCES events(id),
  client_id   uuid NOT NULL REFERENCES clients(id),
  assigned_by uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, room_id)
);
CREATE INDEX IF NOT EXISTS room_assignments_event_idx ON room_assignments (event_id, user_id);

ALTER TABLE room_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON room_assignments;
CREATE POLICY tenant_isolation ON room_assignments
  FOR ALL TO pmp_app
  USING (pmp.is_platform_context() OR client_id = pmp.current_client_id())
  WITH CHECK (pmp.is_platform_context() OR client_id = pmp.current_client_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON room_assignments TO pmp_app;
