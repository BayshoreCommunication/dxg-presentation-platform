-- 026_staff_recorded_launches.sql
-- Room PCs are loaded by hand (D-125) and have no room software, so a Launch pressed on
-- Room Agent is recorded by the staff member who pressed it, not by a room PC (D-128).
-- Launches were only written when the room had a registered room PC: with none, every
-- Launch said "Recorded as presented" and recorded nothing.
SET search_path TO pmp, public;

ALTER TABLE launch_logs ALTER COLUMN agent_id DROP NOT NULL;
ALTER TABLE launch_logs ADD COLUMN IF NOT EXISTS recorded_by uuid REFERENCES users(id);
ALTER TABLE launch_logs ADD CONSTRAINT launch_logs_recorded_by_someone
  CHECK (agent_id IS NOT NULL OR recorded_by IS NOT NULL) NOT VALID;
