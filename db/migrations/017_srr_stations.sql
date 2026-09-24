-- 017_srr_stations.sql
-- Speaker Ready Room stations are the event's own data (D-080).
--
-- Every event's SRR showed the same three stations — "Station 1", "Station 2",
-- "Station 3 · USB" — from a VALUES list in the dashboard query, and every check-in was
-- recorded at "Station 2" whatever desk the speaker sat at. Stations are now rows an
-- event's staff add, rename and retire. A check-in names one of them.
--
-- Events that already exist keep the three names they have been showing, as ordinary
-- editable rows, so nothing an operator has seen disappears. New events start with none.
SET search_path TO pmp, public;

CREATE TABLE IF NOT EXISTS srr_stations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events(id),
  client_id   uuid NOT NULL REFERENCES clients(id),
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  position    int  NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Retired, not deleted: past check-ins still name the station they happened at.
  retired_at  timestamptz,
  lock_version int NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS srr_stations_live_name
  ON srr_stations (event_id, lower(btrim(name))) WHERE retired_at IS NULL;
CREATE INDEX IF NOT EXISTS srr_stations_event_idx ON srr_stations (event_id) WHERE retired_at IS NULL;

-- Which station a check-in used, by id. `srr_checkins.station` keeps the name as it was
-- then, for the record; the id is what "is this desk busy" is answered from, so renaming
-- a station does not strand the speaker sitting at it.
ALTER TABLE srr_checkins ADD COLUMN IF NOT EXISTS station_id uuid REFERENCES srr_stations(id);

INSERT INTO srr_stations (event_id, client_id, name, position)
SELECT e.id, e.client_id, s.name, s.position
  FROM events e
 CROSS JOIN (VALUES ('Station 1', 1), ('Station 2', 2), ('Station 3 · USB', 3)) AS s(name, position)
 WHERE NOT EXISTS (SELECT 1 FROM srr_stations x WHERE x.event_id = e.id);

UPDATE srr_checkins c
   SET station_id = st.id
  FROM srr_stations st
 WHERE c.station_id IS NULL AND st.event_id = c.event_id AND st.name = c.station;

ALTER TABLE srr_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE srr_stations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON srr_stations;
CREATE POLICY tenant_isolation ON srr_stations
  FOR ALL TO pmp_app
  USING (pmp.is_platform_context() OR client_id = pmp.current_client_id())
  WITH CHECK (pmp.is_platform_context() OR client_id = pmp.current_client_id());
GRANT SELECT, INSERT, UPDATE ON srr_stations TO pmp_app;
