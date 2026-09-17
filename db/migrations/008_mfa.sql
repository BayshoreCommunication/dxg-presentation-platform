-- 008_mfa.sql
-- Multi-factor authentication for DXG staff (NFR-SEC-02, closing the D-015 gap).
-- users.mfa_secret / mfa_enrolled_at were added in 007; this adds what surrounds
-- them: recovery codes, replay protection, and the half-finished login state.
SET search_path TO pmp, public;

-- A code is valid for a 30-second step; accepting the same one twice would let
-- anyone who glimpsed it reuse it inside that window.
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_last_counter bigint;

-- Single-use, stored hashed. The only way back in from a lost phone.
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  bytea NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);
CREATE INDEX IF NOT EXISTS mfa_recovery_unused_idx ON mfa_recovery_codes (user_id) WHERE used_at IS NULL;

-- Between a correct password and a correct code there is no session, only this:
-- a short-lived, single-purpose challenge that grants nothing on its own.
CREATE TABLE IF NOT EXISTS mfa_challenges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  attempts   int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  ip         inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mfa_challenges_lookup_idx ON mfa_challenges (token_hash) WHERE consumed_at IS NULL;

ALTER TABLE auth_attempts DROP CONSTRAINT IF EXISTS auth_attempts_outcome_check;
ALTER TABLE auth_attempts ADD CONSTRAINT auth_attempts_outcome_check
  CHECK (outcome IN ('success', 'bad_credentials', 'locked', 'unknown_identity', 'expired', 'revoked',
                     'mfa_required', 'bad_mfa_code', 'mfa_recovery_used'));

GRANT SELECT, INSERT, UPDATE, DELETE ON mfa_recovery_codes, mfa_challenges TO pmp_app;
