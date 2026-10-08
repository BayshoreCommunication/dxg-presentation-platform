-- 032_speaker_accounts.sql
-- Speakers get persistent accounts (D-146): a `users` row of kind `speaker` that signs in
-- on the staff site with a password and is matched to its `speakers` rows — on every event
-- and every client — by email address. Staff accounts are unchanged; an existing row is
-- staff. Re-running changes nothing.
SET search_path TO pmp, public;

ALTER TABLE users ADD COLUMN IF NOT EXISTS account_kind text NOT NULL DEFAULT 'staff';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_account_kind_check;
ALTER TABLE users ADD CONSTRAINT users_account_kind_check CHECK (account_kind IN ('staff', 'speaker'));

-- A speaker account is found from a speaker row by email, so the lookup has an index.
CREATE INDEX IF NOT EXISTS users_account_kind_idx ON users (account_kind) WHERE account_kind = 'speaker';
