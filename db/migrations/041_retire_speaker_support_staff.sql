-- 041_retire_speaker_support_staff.sql
-- Speaker Support Staff is retired (D-159, Travis): submitting for a speaker is DXG Technician
-- staff's job on the events they are assigned to, not a per-speaker assistant's. Every
-- assistant sign-in is closed and its sessions end. `users.assists_user_id` stays, so the
-- versions they uploaded still say who sent them, and sign-in refuses any account that has it.
-- Re-running changes nothing.
SET search_path TO pmp, public;

UPDATE auth_sessions SET revoked_at = now()
 WHERE revoked_at IS NULL
   AND user_id IN (SELECT id FROM users WHERE assists_user_id IS NOT NULL);

UPDATE users SET is_active = false
 WHERE assists_user_id IS NOT NULL AND is_active;
