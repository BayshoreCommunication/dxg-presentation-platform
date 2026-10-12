-- 038_speaker_support_staff.sql
-- Speaker Support Staff (client review, D-156): an assistant who submits content for a speaker.
-- The assistant is a speaker account (so every speaker rule applies) that assists another
-- speaker account; it reaches that speaker's presentations, never its own. Re-running changes nothing.
SET search_path TO pmp, public;

ALTER TABLE users ADD COLUMN IF NOT EXISTS assists_user_id uuid REFERENCES users(id);
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_assists_speaker_check;
ALTER TABLE users ADD CONSTRAINT users_assists_speaker_check
  CHECK (assists_user_id IS NULL OR (account_kind = 'speaker' AND assists_user_id <> id));
CREATE INDEX IF NOT EXISTS users_assists_idx ON users (assists_user_id) WHERE assists_user_id IS NOT NULL;
