import type pg from "pg";
import { hashPassword, checkPassword, hashSecret, generateSessionToken } from "@pmp/auth";
import type { DomainError, Result } from "@pmp/domain";
import { err, ok } from "@pmp/domain";

const TOKEN_MINUTES = 30;
/** Enough for a genuine retry, not enough to use the endpoint as a mail cannon. */
const MAX_REQUESTS_PER_HOUR = 5;

/**
 * Requesting a reset always looks the same from outside, whether or not the
 * address belongs to an account: the endpoint must not become a way to discover
 * who works at DXG.
 */
export async function requestReset(
  tx: pg.PoolClient,
  input: { email: string; resetBase: string; ip?: string | undefined },
): Promise<{ queued: boolean }> {
  const email = input.email.trim().toLowerCase();

  const { rows } = await tx.query<{ id: string; display_name: string; is_active: boolean }>(
    `SELECT id, display_name, is_active FROM pmp.users WHERE lower(email::text) = $1`,
    [email],
  );
  const user = rows[0];

  await tx.query(
    `INSERT INTO pmp.auth_attempts (kind, identifier, outcome, ip, detail)
     VALUES ('staff', $1, 'reset_requested', $2::inet, $3)`,
    [email.slice(0, 320), input.ip ?? null, JSON.stringify({ known: Boolean(user) })],
  );

  if (!user || !user.is_active) return { queued: false };

  const { rows: recent } = await tx.query<{ count: string }>(
    `SELECT count(*)::text FROM pmp.password_reset_tokens
      WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
    [user.id],
  );
  if (Number(recent[0]?.count ?? 0) >= MAX_REQUESTS_PER_HOUR) return { queued: false };

  // Any earlier link stops working the moment a new one is asked for.
  await tx.query(
    `UPDATE pmp.password_reset_tokens SET consumed_at = now()
      WHERE user_id = $1 AND consumed_at IS NULL`,
    [user.id],
  );

  const token = generateSessionToken();
  await tx.query(
    `INSERT INTO pmp.password_reset_tokens (user_id, token_hash, expires_at, requested_ip)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval, $4::inet)`,
    [user.id, hashSecret(token), String(TOKEN_MINUTES), input.ip ?? null],
  );

  const link = `${input.resetBase}/reset-password?token=${encodeURIComponent(token)}`;
  await tx.query(`INSERT INTO pmp.outbox (topic, payload) VALUES ('email.send', $1)`, [
    JSON.stringify({
      to: email,
      subject: "Reset your DXG·PM password",
      body: [
        `Hi ${user.display_name},`,
        "",
        "Someone asked to reset the password on your DXG·PM account. If that was you, use this link:",
        "",
        link,
        "",
        `It stops working in ${TOKEN_MINUTES} minutes, and only once.`,
        "",
        "If it wasn't you, nothing has changed and you can ignore this email — but tell a platform admin,",
        "because it means someone knows your address.",
        "",
        "The DXG presentation team",
      ].join("\n"),
    }),
  ]);

  return { queued: true };
}

export type ResetOutcome = { reset: true; mfa_still_required: boolean };

/**
 * Completing a reset sets the password and ends every session. It does **not**
 * satisfy the second factor: an account with an authenticator still needs it at
 * the next sign-in, so a hijacked mailbox alone does not open the account.
 */
export async function completeReset(
  tx: pg.PoolClient,
  input: { token: string; newPassword: string; ip?: string | undefined },
): Promise<Result<ResetOutcome, DomainError>> {
  const { rows } = await tx.query<{
    id: string;
    user_id: string;
    expires_at: Date;
    consumed_at: Date | null;
  }>(
    `SELECT id, user_id, expires_at, consumed_at
       FROM pmp.password_reset_tokens WHERE token_hash = $1`,
    [hashSecret(input.token)],
  );
  const reset = rows[0];
  if (!reset || reset.consumed_at || reset.expires_at < new Date()) {
    return err({
      code: "auth.reset_invalid",
      message: "That reset link has expired or already been used. Request a new one.",
    });
  }

  const problem = checkPassword(input.newPassword);
  if (problem) return err({ code: `auth.${problem.code}`, message: problem.message });

  await tx.query(
    `UPDATE pmp.users
        SET password_hash = $1, password_set_at = now(), must_change_password = false,
            failed_logins = 0, locked_until = NULL
      WHERE id = $2`,
    [await hashPassword(input.newPassword), reset.user_id],
  );
  await tx.query(`UPDATE pmp.password_reset_tokens SET consumed_at = now() WHERE id = $1`, [reset.id]);
  await tx.query(
    `UPDATE pmp.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
    [reset.user_id],
  );

  const { rows: userRows } = await tx.query<{ email: string; mfa_enrolled: boolean }>(
    `SELECT email::text, (mfa_enrolled_at IS NOT NULL) AS mfa_enrolled FROM pmp.users WHERE id = $1`,
    [reset.user_id],
  );
  await tx.query(
    `INSERT INTO pmp.auth_attempts (kind, identifier, outcome, ip) VALUES ('staff', $1, 'reset_completed', $2::inet)`,
    [userRows[0]?.email ?? reset.user_id, input.ip ?? null],
  );

  return ok({ reset: true, mfa_still_required: userRows[0]?.mfa_enrolled ?? false });
}
