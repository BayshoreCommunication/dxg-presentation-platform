-- 009_password_reset.sql
-- Self-service password reset. Tokens are stored hashed, single use, and short
-- lived; requesting one never reveals whether an account exists.
SET search_path TO pmp, public;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  bytea NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  requested_ip inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_lookup_idx ON password_reset_tokens (token_hash)
  WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS password_reset_recent_idx ON password_reset_tokens (user_id, created_at DESC);

ALTER TABLE auth_attempts DROP CONSTRAINT IF EXISTS auth_attempts_outcome_check;
ALTER TABLE auth_attempts ADD CONSTRAINT auth_attempts_outcome_check
  CHECK (outcome IN ('success', 'bad_credentials', 'locked', 'unknown_identity', 'expired', 'revoked',
                     'mfa_required', 'bad_mfa_code', 'mfa_recovery_used',
                     'reset_requested', 'reset_completed'));

GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO pmp_app;
