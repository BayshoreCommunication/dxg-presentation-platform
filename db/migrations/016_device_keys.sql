-- 016_device_keys.sql
-- Room computers authenticate their check-ins (D-077).
--
-- `POST /agent/heartbeat` accepted a bare room id: anyone who knew one could report that
-- room's computer online, and "Rooms ready" counted it. Each agent now holds a device key
-- issued by staff; only its SHA-256 is stored, so the key cannot be read back from the
-- database, and issuing a new one replaces it.
--
-- `public_key` (a placeholder '\x00' so far) stays for the signed-manifest design in
-- SECURITY_MODEL §2; this is the simpler shared-secret step that closes the gap now.
SET search_path TO pmp, public;

ALTER TABLE room_agents ADD COLUMN IF NOT EXISTS key_hash      bytea;
ALTER TABLE room_agents ADD COLUMN IF NOT EXISTS key_issued_at timestamptz;
ALTER TABLE room_agents ADD COLUMN IF NOT EXISTS key_issued_by uuid REFERENCES users(id);
