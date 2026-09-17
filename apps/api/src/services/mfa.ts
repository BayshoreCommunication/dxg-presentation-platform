import type pg from "pg";
import { appendAudit } from "@pmp/db";
import {
  generateTotpSecret,
  verifyTotp,
  otpauthUri,
  groupSecret,
  generateRecoveryCodes,
  normaliseRecoveryCode,
  hashSecret,
  generateSessionToken,
  verifyPassword,
} from "@pmp/auth";
import type { DomainError, Result } from "@pmp/domain";
import { err, ok } from "@pmp/domain";

const ISSUER = process.env.MFA_ISSUER ?? "DXG·PM";
const CHALLENGE_MINUTES = 5;
const MAX_ATTEMPTS = 5;

export type Enrolment = {
  secret: string;
  secret_grouped: string;
  otpauth_uri: string;
  account: string;
};

/**
 * Enrolment hands out a secret but does not enable anything: MFA only becomes
 * real once the staff member proves their app produces a matching code, so a
 * mistyped secret cannot lock them out.
 */
export async function startEnrolment(
  tx: pg.PoolClient,
  userId: string,
): Promise<Result<Enrolment, DomainError>> {
  const { rows } = await tx.query<{ email: string; mfa_enrolled_at: Date | null }>(
    `SELECT email::text, mfa_enrolled_at FROM pmp.users WHERE id = $1`,
    [userId],
  );
  const user = rows[0];
  if (!user) return err({ code: "mfa.not_found", message: "No such account." });
  if (user.mfa_enrolled_at) {
    return err({
      code: "mfa.already_enrolled",
      message: "This account already has an authenticator. Remove it first to enrol a new one.",
    });
  }

  const secret = generateTotpSecret();
  // Held unconfirmed until a code proves it works.
  await tx.query(`UPDATE pmp.users SET mfa_secret = $1, mfa_enrolled_at = NULL WHERE id = $2`, [
    secret,
    userId,
  ]);

  return ok({
    secret,
    secret_grouped: groupSecret(secret),
    otpauth_uri: otpauthUri({ secret, account: user.email, issuer: ISSUER }),
    account: user.email,
  });
}

export async function confirmEnrolment(
  tx: pg.PoolClient,
  userId: string,
  code: string,
): Promise<Result<{ recovery_codes: string[] }, DomainError>> {
  const { rows } = await tx.query<{ mfa_secret: string | null; mfa_enrolled_at: Date | null; client: string | null }>(
    `SELECT mfa_secret, mfa_enrolled_at, NULL::text AS client FROM pmp.users WHERE id = $1`,
    [userId],
  );
  const user = rows[0];
  if (!user?.mfa_secret) {
    return err({ code: "mfa.not_started", message: "Start enrolment before confirming it." });
  }
  if (user.mfa_enrolled_at) {
    return err({ code: "mfa.already_enrolled", message: "This account is already enrolled." });
  }

  const check = verifyTotp(user.mfa_secret, code);
  if (!check.valid) {
    return err({
      code: "mfa.bad_code",
      message: "That code didn't match. Check your authenticator and try the next one.",
    });
  }

  const codes = generateRecoveryCodes();
  await tx.query(`DELETE FROM pmp.mfa_recovery_codes WHERE user_id = $1`, [userId]);
  for (const recovery of codes) {
    await tx.query(`INSERT INTO pmp.mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)`, [
      userId,
      hashSecret(normaliseRecoveryCode(recovery)),
    ]);
  }
  await tx.query(
    `UPDATE pmp.users SET mfa_enrolled_at = now(), mfa_last_counter = $2 WHERE id = $1`,
    [userId, check.counter ?? null],
  );

  await appendAudit(tx, {
    partitionId: userId,
    clientId: userId,
    actorUserId: userId,
    action: "auth.mfa_enrolled",
    subjectType: "user",
    subjectId: userId,
    detail: { recovery_codes_issued: codes.length },
  });

  return ok({ recovery_codes: codes });
}

/** Removing MFA needs both the password and a live code — knowing one is not enough. */
export async function disableMfa(
  tx: pg.PoolClient,
  userId: string,
  input: { password: string; code: string },
): Promise<Result<{ disabled: true }, DomainError>> {
  const { rows } = await tx.query<{ password_hash: string | null; mfa_secret: string | null }>(
    `SELECT password_hash, mfa_secret FROM pmp.users WHERE id = $1`,
    [userId],
  );
  const user = rows[0];
  if (!user?.mfa_secret) return err({ code: "mfa.not_enrolled", message: "This account has no authenticator." });
  if (!(await verifyPassword(input.password, user.password_hash))) {
    return err({ code: "auth.invalid_credentials", message: "Your password is not correct." });
  }
  if (!verifyTotp(user.mfa_secret, input.code).valid) {
    return err({ code: "mfa.bad_code", message: "That code didn't match." });
  }

  await tx.query(
    `UPDATE pmp.users SET mfa_secret = NULL, mfa_enrolled_at = NULL, mfa_last_counter = NULL WHERE id = $1`,
    [userId],
  );
  await tx.query(`DELETE FROM pmp.mfa_recovery_codes WHERE user_id = $1`, [userId]);
  await appendAudit(tx, {
    partitionId: userId,
    clientId: userId,
    actorUserId: userId,
    action: "auth.mfa_disabled",
    subjectType: "user",
    subjectId: userId,
  });
  return ok({ disabled: true });
}

export const isEnrolled = async (tx: pg.PoolClient, userId: string): Promise<boolean> => {
  const { rows } = await tx.query<{ enrolled: boolean }>(
    `SELECT (mfa_enrolled_at IS NOT NULL) AS enrolled FROM pmp.users WHERE id = $1`,
    [userId],
  );
  return rows[0]?.enrolled ?? false;
};

/* ── the second step of signing in ───────────────────────────────────────── */

export async function openChallenge(
  tx: pg.PoolClient,
  userId: string,
  context: { ip?: string | undefined; userAgent?: string | undefined },
): Promise<string> {
  const token = generateSessionToken();
  await tx.query(
    `INSERT INTO pmp.mfa_challenges (user_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval, $4::inet, $5)`,
    [userId, hashSecret(token), String(CHALLENGE_MINUTES), context.ip ?? null, context.userAgent?.slice(0, 500) ?? null],
  );
  return token;
}

export type ChallengeResult =
  | { ok: true; userId: string; usedRecoveryCode: boolean; remainingRecoveryCodes: number }
  | { ok: false; error: DomainError };

/**
 * Verifies the second factor. A TOTP code is accepted once — replaying the same
 * code inside its 30-second window is refused — and a recovery code is burned on
 * use.
 */
export async function answerChallenge(
  tx: pg.PoolClient,
  input: { token: string; code: string },
): Promise<ChallengeResult> {
  const { rows } = await tx.query<{
    id: string;
    user_id: string;
    attempts: number;
    expires_at: Date;
    consumed_at: Date | null;
  }>(
    `SELECT id, user_id, attempts, expires_at, consumed_at
       FROM pmp.mfa_challenges WHERE token_hash = $1`,
    [hashSecret(input.token)],
  );
  const challenge = rows[0];
  if (!challenge || challenge.consumed_at || challenge.expires_at < new Date()) {
    return {
      ok: false,
      error: { code: "mfa.challenge_expired", message: "That sign-in attempt expired. Start again." },
    };
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    await tx.query(`UPDATE pmp.mfa_challenges SET consumed_at = now() WHERE id = $1`, [challenge.id]);
    return {
      ok: false,
      error: { code: "mfa.too_many_attempts", message: "Too many incorrect codes. Sign in again." },
    };
  }

  const { rows: userRows } = await tx.query<{ mfa_secret: string | null; mfa_last_counter: string | null }>(
    `SELECT mfa_secret, mfa_last_counter::text FROM pmp.users WHERE id = $1`,
    [challenge.user_id],
  );
  const user = userRows[0];
  if (!user?.mfa_secret) {
    return { ok: false, error: { code: "mfa.not_enrolled", message: "This account has no authenticator." } };
  }

  const check = verifyTotp(user.mfa_secret, input.code);
  if (check.valid) {
    const lastCounter = user.mfa_last_counter === null ? null : Number(user.mfa_last_counter);
    if (lastCounter !== null && check.counter !== undefined && check.counter <= lastCounter) {
      await tx.query(`UPDATE pmp.mfa_challenges SET attempts = attempts + 1 WHERE id = $1`, [challenge.id]);
      return {
        ok: false,
        error: {
          code: "mfa.code_reused",
          message: "That code has already been used. Wait for your authenticator to show the next one.",
        },
      };
    }
    await tx.query(`UPDATE pmp.users SET mfa_last_counter = $2 WHERE id = $1`, [
      challenge.user_id,
      check.counter ?? null,
    ]);
    await tx.query(`UPDATE pmp.mfa_challenges SET consumed_at = now() WHERE id = $1`, [challenge.id]);
    const { rows: remaining } = await tx.query<{ count: string }>(
      `SELECT count(*)::text FROM pmp.mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL`,
      [challenge.user_id],
    );
    return {
      ok: true,
      userId: challenge.user_id,
      usedRecoveryCode: false,
      remainingRecoveryCodes: Number(remaining[0]?.count ?? 0),
    };
  }

  // Not a live code — it may still be a recovery code.
  const { rows: recovery } = await tx.query<{ id: string }>(
    `SELECT id FROM pmp.mfa_recovery_codes
      WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`,
    [challenge.user_id, hashSecret(normaliseRecoveryCode(input.code))],
  );
  if (recovery[0]) {
    await tx.query(`UPDATE pmp.mfa_recovery_codes SET used_at = now() WHERE id = $1`, [recovery[0].id]);
    await tx.query(`UPDATE pmp.mfa_challenges SET consumed_at = now() WHERE id = $1`, [challenge.id]);
    const { rows: remaining } = await tx.query<{ count: string }>(
      `SELECT count(*)::text FROM pmp.mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL`,
      [challenge.user_id],
    );
    return {
      ok: true,
      userId: challenge.user_id,
      usedRecoveryCode: true,
      remainingRecoveryCodes: Number(remaining[0]?.count ?? 0),
    };
  }

  await tx.query(`UPDATE pmp.mfa_challenges SET attempts = attempts + 1 WHERE id = $1`, [challenge.id]);
  return {
    ok: false,
    error: {
      code: "mfa.bad_code",
      message: "That code didn't match. Check your authenticator, or use a recovery code.",
    },
  };
}
