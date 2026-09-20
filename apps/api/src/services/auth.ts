import type pg from "pg";
import { appendAudit } from "@pmp/db";
import {
  hashPassword,
  verifyPassword,
  checkPassword,
  generateAccessCode,
  normaliseCode,
  hashSecret,
  generateSessionToken,
  lockoutFor,
  lockoutState,
} from "@pmp/auth";
import { openChallenge, isEnrolled } from "./mfa.ts";
import type { Actor, DomainError, EventRole, Result } from "@pmp/domain";
import { err, ok, atLeast, hasAnyRole } from "@pmp/domain";

/** Staff sessions per SECURITY_MODEL §2; presenters get a shorter portal session. */
const IDLE_MINUTES = { staff: 12 * 60, presenter: 8 * 60 } as const;
const ABSOLUTE_MINUTES = { staff: 24 * 60, presenter: 24 * 60 } as const;

export const SESSION_COOKIE = "pmp_session";

export type Principal =
  | {
      kind: "staff";
      user_id: string;
      email: string;
      display_name: string;
      roles: EventRole[];
      /**
       * Which roles are held on which event. The flattened `roles` above says what
       * this account can ever do; this says where, and it is the difference between
       * the two that SRS §5 requires: "Access shall be event-scoped and
       * least-privilege. Client and event isolation is mandatory."
       */
      event_roles: { event_id: string; role: EventRole }[];
      /** Clients this account has any role on — empty for DXG staff, who work across all. */
      client_ids: string[];
      /**
       * Events this account can open as a *client*. Populated only for accounts with
       * no staff role: a client signs in to look at their own event and has nowhere
       * else to go, so the app needs to know where that is without guessing. Left
       * empty for DXG staff, whose landing place is the portfolio and for whom this
       * would be every event in the system.
       */
      client_events: { id: string; name: string }[];
      must_change_password: boolean;
      mfa_enrolled: boolean;
    }
  | { kind: "presenter"; speaker_id: string; email: string | null; display_name: string; event_id: string; client_id: string };

type Attempt = {
  kind: "staff" | "presenter";
  identifier: string;
  outcome:
    | "success"
    | "bad_credentials"
    | "locked"
    | "unknown_identity"
    | "expired"
    | "revoked"
    | "mfa_required"
    | "bad_mfa_code"
    | "mfa_recovery_used";
  ip?: string | undefined;
  userAgent?: string | undefined;
  detail?: Record<string, unknown>;
};

async function record(tx: pg.PoolClient, attempt: Attempt): Promise<void> {
  await tx.query(
    `INSERT INTO pmp.auth_attempts (kind, identifier, outcome, ip, user_agent, detail)
     VALUES ($1,$2,$3,$4::inet,$5,$6)`,
    [
      attempt.kind,
      attempt.identifier.slice(0, 320),
      attempt.outcome,
      attempt.ip ?? null,
      attempt.userAgent?.slice(0, 500) ?? null,
      JSON.stringify(attempt.detail ?? {}),
    ],
  );
}

async function openSession(
  tx: pg.PoolClient,
  input: {
    kind: "staff" | "presenter";
    userId?: string;
    speakerId?: string;
    clientId?: string;
    ip?: string | undefined;
    userAgent?: string | undefined;
  },
): Promise<string> {
  const token = generateSessionToken();
  const now = Date.now();
  await tx.query(
    `INSERT INTO pmp.auth_sessions
       (kind, user_id, speaker_id, client_id, token_hash, idle_expires_at, absolute_expires_at, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::inet,$9)`,
    [
      input.kind,
      input.userId ?? null,
      input.speakerId ?? null,
      input.clientId ?? null,
      hashSecret(token),
      new Date(now + IDLE_MINUTES[input.kind] * 60_000),
      new Date(now + ABSOLUTE_MINUTES[input.kind] * 60_000),
      input.ip ?? null,
      input.userAgent?.slice(0, 500) ?? null,
    ],
  );
  return token;
}

/**
 * Both failure modes — unknown email and wrong password — return the same
 * message and take a similar amount of work, so the response cannot be used to
 * discover who has an account. The distinction is recorded in auth_attempts.
 */
const GENERIC_FAILURE: DomainError = {
  code: "auth.invalid_credentials",
  message: "That email and password don't match an account.",
};

export type LoginOutcome =
  | { step: "signed_in"; token: string; principal: Principal }
  /** Password accepted; nothing is granted until the second factor is answered. */
  | { step: "mfa_required"; challenge: string };

export async function staffLogin(
  tx: pg.PoolClient,
  input: { email: string; password: string; ip?: string | undefined; userAgent?: string | undefined },
): Promise<Result<LoginOutcome, DomainError>> {
  const email = input.email.trim().toLowerCase();
  const { rows } = await tx.query<{
    id: string;
    email: string;
    display_name: string;
    password_hash: string | null;
    must_change_password: boolean;
    failed_logins: number;
    locked_until: Date | null;
    is_active: boolean;
  }>(
    `SELECT id, email::text, display_name, password_hash, must_change_password,
            failed_logins, locked_until, is_active
       FROM pmp.users WHERE lower(email::text) = $1`,
    [email],
  );
  const user = rows[0];

  if (!user || !user.is_active) {
    // Still spend the time hashing, so a missing account is not faster to probe.
    await verifyPassword(input.password, "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    await record(tx, { kind: "staff", identifier: email, outcome: "unknown_identity", ip: input.ip, userAgent: input.userAgent });
    return err(GENERIC_FAILURE);
  }

  const now = new Date();
  const lock = lockoutState(user.locked_until, user.failed_logins, now);
  if (lock.locked) {
    await record(tx, { kind: "staff", identifier: email, outcome: "locked", ip: input.ip, userAgent: input.userAgent });
    return err({
      code: "auth.locked",
      message: `Too many failed attempts. Try again after ${lock.until!.toISOString().slice(11, 16)} UTC, or ask a platform admin to reset it.`,
    });
  }

  if (!(await verifyPassword(input.password, user.password_hash))) {
    const failed = user.failed_logins + 1;
    await tx.query(`UPDATE pmp.users SET failed_logins = $1, locked_until = $2 WHERE id = $3`, [
      failed,
      lockoutFor(failed, now),
      user.id,
    ]);
    await record(tx, {
      kind: "staff",
      identifier: email,
      outcome: "bad_credentials",
      ip: input.ip,
      userAgent: input.userAgent,
      detail: { failed_logins: failed },
    });
    return err(GENERIC_FAILURE);
  }

  await tx.query(`UPDATE pmp.users SET failed_logins = 0, locked_until = NULL WHERE id = $1`, [user.id]);

  // A correct password is half of a sign-in for an enrolled account.
  if (await isEnrolled(tx, user.id)) {
    const challenge = await openChallenge(tx, user.id, { ip: input.ip, userAgent: input.userAgent });
    await record(tx, {
      kind: "staff",
      identifier: email,
      outcome: "mfa_required",
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return ok({ step: "mfa_required", challenge });
  }

  const token = await openSession(tx, { kind: "staff", userId: user.id, ip: input.ip, userAgent: input.userAgent });
  await record(tx, { kind: "staff", identifier: email, outcome: "success", ip: input.ip, userAgent: input.userAgent });

  return ok({ step: "signed_in", token, principal: await principalFor(tx, user.id) });
}

/** Builds the principal for an established session. */
export async function principalFor(tx: pg.PoolClient, userId: string): Promise<Principal> {
  const { rows } = await tx.query<{
    id: string;
    email: string;
    display_name: string;
    must_change_password: boolean;
    mfa_enrolled: boolean;
  }>(
    `SELECT id, email::text, display_name, must_change_password,
            (mfa_enrolled_at IS NOT NULL) AS mfa_enrolled
       FROM pmp.users WHERE id = $1`,
    [userId],
  );
  const user = rows[0]!;
  const roles = await rolesFor(tx, user.id);
  // Only an account with no staff role at all needs somewhere to be sent: staff land
  // on the portfolio. Asking the question this way also means a future hybrid account
  // is treated as staff, which is the safer of the two guesses.
  const clientOnly = roles.length > 0 && roles.every((role) => CLIENT_ROLES.includes(role));
  return {
    kind: "staff",
    user_id: user.id,
    email: user.email,
    display_name: user.display_name,
    roles,
    event_roles: await eventRolesFor(tx, user.id),
    client_ids: await clientsFor(tx, user.id),
    client_events: clientOnly ? await clientEventsFor(tx, user.id) : [],
    must_change_password: user.must_change_password,
    mfa_enrolled: user.mfa_enrolled,
  };
}

/** Opens the session once the second factor has been answered. */
export async function completeMfaLogin(
  tx: pg.PoolClient,
  userId: string,
  context: { ip?: string | undefined; userAgent?: string | undefined },
): Promise<{ token: string; principal: Principal }> {
  const token = await openSession(tx, { kind: "staff", userId, ip: context.ip, userAgent: context.userAgent });
  const principal = await principalFor(tx, userId);
  await record(tx, {
    kind: "staff",
    identifier: principal.kind === "staff" ? principal.email : userId,
    outcome: "success",
    ip: context.ip,
    userAgent: context.userAgent,
  });
  return { token, principal };
}

async function rolesFor(tx: pg.PoolClient, userId: string): Promise<EventRole[]> {
  const { rows } = await tx.query<{ role: EventRole }>(
    `SELECT DISTINCT role FROM pmp.event_roles WHERE user_id = $1`,
    [userId],
  );
  return rows.map((row) => row.role);
}

/** Every (event, role) pair this account holds — the basis for event scoping. */
async function eventRolesFor(
  tx: pg.PoolClient,
  userId: string,
): Promise<{ event_id: string; role: EventRole }[]> {
  const { rows } = await tx.query<{ event_id: string; role: EventRole }>(
    `SELECT event_id, role FROM pmp.event_roles WHERE user_id = $1`,
    [userId],
  );
  return rows;
}

/** The roles that make an account a client's, not DXG's. */
const CLIENT_ROLES: EventRole[] = ["client_event_admin", "scoped_reviewer"];

/**
 * The events this account holds a *client* role on. Only asked for when the account
 * has no staff role, so the query stays small and DXG staff never carry it.
 */
async function clientEventsFor(tx: pg.PoolClient, userId: string): Promise<{ id: string; name: string }[]> {
  const { rows } = await tx.query<{ id: string; name: string }>(
    `SELECT DISTINCT e.id, e.name
       FROM pmp.event_roles er JOIN pmp.events e ON e.id = er.event_id
      WHERE er.user_id = $1 AND er.role IN ('client_event_admin', 'scoped_reviewer')
      ORDER BY e.name`,
    [userId],
  );
  return rows;
}

/** Which clients this account touches, used to scope client-side accounts. */
async function clientsFor(tx: pg.PoolClient, userId: string): Promise<string[]> {
  const { rows } = await tx.query<{ client_id: string }>(
    `SELECT DISTINCT e.client_id
       FROM pmp.event_roles er JOIN pmp.events e ON e.id = er.event_id
      WHERE er.user_id = $1
      UNION
     SELECT DISTINCT cg.client_id FROM pmp.client_grants cg WHERE cg.user_id = $1`,
    [userId],
  );
  return rows.map((row) => row.client_id);
}

/**
 * Presenters sign in with the email DXG holds for them plus the access code DXG
 * generated. The same code is what the emailed link carries, so a presenter who
 * lost the email can still get in by typing it (FR-SPK, M06).
 */
export async function presenterLogin(
  tx: pg.PoolClient,
  input: { email: string; code: string; ip?: string | undefined; userAgent?: string | undefined },
): Promise<Result<{ token: string; principal: Principal }, DomainError>> {
  const email = input.email.trim().toLowerCase();
  const normalised = normaliseCode(input.code);
  if (!email || !normalised) {
    return err({ code: "auth.invalid_credentials", message: "Enter your email address and access code." });
  }

  const { rows } = await tx.query<{
    token_id: string;
    speaker_id: string;
    speaker_email: string | null;
    full_name: string;
    event_id: string;
    client_id: string;
    expires_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT st.id AS token_id, sp.id AS speaker_id, sp.email::text AS speaker_email, sp.full_name,
            st.event_id, st.client_id, st.expires_at, st.revoked_at
       FROM pmp.speaker_tokens st
       JOIN pmp.speakers sp ON sp.id = st.speaker_id
      WHERE st.token_hash = $1 AND sp.merged_into IS NULL`,
    [hashSecret(normalised)],
  );
  const token = rows[0];

  if (!token || (token.speaker_email ?? "").toLowerCase() !== email) {
    await record(tx, { kind: "presenter", identifier: email, outcome: "unknown_identity", ip: input.ip, userAgent: input.userAgent });
    return err({
      code: "auth.invalid_credentials",
      message: "That email and access code don't match. Check the details DXG sent you.",
    });
  }
  if (token.revoked_at) {
    await record(tx, { kind: "presenter", identifier: email, outcome: "revoked", ip: input.ip, userAgent: input.userAgent });
    return err({ code: "auth.revoked", message: "That access code has been withdrawn. Ask the DXG team for a new one." });
  }
  if (token.expires_at < new Date()) {
    await record(tx, { kind: "presenter", identifier: email, outcome: "expired", ip: input.ip, userAgent: input.userAgent });
    return err({ code: "auth.expired", message: "That access code has expired. Ask the DXG team for a new one." });
  }

  await tx.query(`UPDATE pmp.speaker_tokens SET last_used_at = now() WHERE id = $1`, [token.token_id]);
  const session = await openSession(tx, {
    kind: "presenter",
    speakerId: token.speaker_id,
    clientId: token.client_id,
    ip: input.ip,
    userAgent: input.userAgent,
  });
  await record(tx, { kind: "presenter", identifier: email, outcome: "success", ip: input.ip, userAgent: input.userAgent });

  return ok({
    token: session,
    principal: {
      kind: "presenter",
      speaker_id: token.speaker_id,
      email: token.speaker_email,
      display_name: token.full_name,
      event_id: token.event_id,
      client_id: token.client_id,
    },
  });
}

/** Resolves a session cookie, sliding the idle window but never the absolute one. */
export async function resolveSession(tx: pg.PoolClient, token: string): Promise<Principal | null> {
  const { rows } = await tx.query<{
    id: string;
    kind: "staff" | "presenter";
    user_id: string | null;
    speaker_id: string | null;
    idle_expires_at: Date;
    absolute_expires_at: Date;
  }>(
    `SELECT id, kind, user_id, speaker_id, idle_expires_at, absolute_expires_at
       FROM pmp.auth_sessions WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashSecret(token)],
  );
  const session = rows[0];
  if (!session) return null;

  const now = new Date();
  if (session.idle_expires_at < now || session.absolute_expires_at < now) {
    await tx.query(`UPDATE pmp.auth_sessions SET revoked_at = now() WHERE id = $1`, [session.id]);
    return null;
  }

  await tx.query(
    `UPDATE pmp.auth_sessions
        SET last_seen_at = now(),
            idle_expires_at = LEAST($2::timestamptz, absolute_expires_at)
      WHERE id = $1`,
    [session.id, new Date(now.getTime() + IDLE_MINUTES[session.kind] * 60_000)],
  );

  if (session.kind === "staff" && session.user_id) {
    const { rows: userRows } = await tx.query<{
      id: string;
      email: string;
      display_name: string;
      must_change_password: boolean;
      is_active: boolean;
    }>(`SELECT id, email::text, display_name, must_change_password, is_active FROM pmp.users WHERE id = $1`, [
      session.user_id,
    ]);
    const user = userRows[0];
    if (!user || !user.is_active) return null;
    return principalFor(tx, user.id);
  }

  if (session.speaker_id) {
    const { rows: speakerRows } = await tx.query<{
      id: string;
      email: string | null;
      full_name: string;
      event_id: string;
      client_id: string;
    }>(
      `SELECT id, email::text, full_name, event_id, client_id
         FROM pmp.speakers WHERE id = $1 AND merged_into IS NULL`,
      [session.speaker_id],
    );
    const speaker = speakerRows[0];
    if (!speaker) return null;
    return {
      kind: "presenter",
      speaker_id: speaker.id,
      email: speaker.email,
      display_name: speaker.full_name,
      event_id: speaker.event_id,
      client_id: speaker.client_id,
    };
  }

  return null;
}

export async function logout(tx: pg.PoolClient, token: string): Promise<void> {
  await tx.query(`UPDATE pmp.auth_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [
    hashSecret(token),
  ]);
}

/* ── credential issuance (there is no signup; DXG creates everything) ─────── */

export async function createStaffUser(
  tx: pg.PoolClient,
  actor: Actor,
  input: { email: string; displayName: string; password?: string },
): Promise<Result<{ user_id: string; temporary_password: string | null }, DomainError>> {
  if (!hasAnyRole(actor, ["platform_admin", "project_manager"])) {
    return err({
      code: "auth.forbidden",
      message: "Creating staff accounts requires a platform admin or project manager.",
    });
  }
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return err({ code: "auth.bad_email", message: "That doesn't look like an email address." });
  }

  const { rows: existing } = await tx.query(`SELECT id FROM pmp.users WHERE lower(email::text) = $1`, [email]);
  if (existing[0]) {
    return err({ code: "auth.email_taken", message: "An account already exists for that email address." });
  }

  // A generated password is handed over once and must be changed on first use.
  const temporary = input.password ?? `${generateAccessCode(4, 4)}`;
  const problem = checkPassword(temporary);
  if (problem) return err({ code: `auth.${problem.code}`, message: problem.message });

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.users (email, display_name, password_hash, password_set_at, must_change_password)
     VALUES ($1::citext, $2, $3, now(), true) RETURNING id`,
    [email, input.displayName.trim() || email, await hashPassword(temporary)],
  );

  return ok({ user_id: rows[0]!.id, temporary_password: input.password ? null : temporary });
}

export async function changeOwnPassword(
  tx: pg.PoolClient,
  userId: string,
  input: { currentPassword: string; newPassword: string },
): Promise<Result<{ changed: true }, DomainError>> {
  const { rows } = await tx.query<{ password_hash: string | null; must_change_password: boolean }>(
    `SELECT password_hash, must_change_password FROM pmp.users WHERE id = $1`,
    [userId],
  );
  if (!rows[0] || !(await verifyPassword(input.currentPassword, rows[0].password_hash))) {
    return err({ code: "auth.invalid_credentials", message: "Your current password is not correct." });
  }
  const problem = checkPassword(input.newPassword);
  if (problem) return err({ code: `auth.${problem.code}`, message: problem.message });

  // Keeping the same password is not a change. It matters most in exactly the case
  // that reaches here first: an account signing in on a temporary password issued by
  // an administrator. That password was chosen by someone else, handed over out of
  // band, and is sitting in whatever chat or email carried it — so re-entering it as
  // the "new" one leaves the account precisely as exposed as before, while marking it
  // resolved. Compared against the stored hash rather than the plaintext, so it also
  // catches a reset link being used to re-set the current password.
  if (await verifyPassword(input.newPassword, rows[0].password_hash)) {
    return err({
      code: "auth.same_as_old",
      message: rows[0].must_change_password
        ? "Choose a password different from the temporary one. The temporary password was sent to you by someone else, so it is not private."
        : "Your new password must be different from your current one.",
    });
  }

  await tx.query(
    `UPDATE pmp.users
        SET password_hash = $1, password_set_at = now(), must_change_password = false,
            failed_logins = 0, locked_until = NULL
      WHERE id = $2`,
    [await hashPassword(input.newPassword), userId],
  );
  // Changing a password ends every other session for that account.
  await tx.query(`UPDATE pmp.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
    userId,
  ]);
  return ok({ changed: true });
}

export type IssuedCredential = {
  speaker_id: string;
  speaker: string;
  email: string | null;
  access_code: string;
  code_hint: string;
  link: string;
  expires_at: string;
};

/**
 * Generates a presenter's credential. Returned in full exactly once — afterwards
 * only the last four characters are stored, so staff can say which code is
 * current without the platform being able to reproduce it.
 */
export async function issuePresenterCredential(
  tx: pg.PoolClient,
  actor: Actor,
  input: { speakerId: string; portalBase: string; days?: number },
): Promise<Result<IssuedCredential, DomainError>> {
  if (!hasAnyRole(actor, atLeast("srr_technician"))) {
    return err({
      code: "auth.forbidden",
      message: "Issuing presenter credentials requires an SRR technician or above.",
    });
  }

  const { rows } = await tx.query<{
    id: string;
    full_name: string;
    email: string | null;
    event_id: string;
    client_id: string;
  }>(
    `SELECT id, full_name, email::text, event_id, client_id
       FROM pmp.speakers WHERE id = $1 AND merged_into IS NULL`,
    [input.speakerId],
  );
  const speaker = rows[0];
  if (!speaker) return err({ code: "auth.speaker_not_found", message: "No such speaker." });

  // Only one live credential per presenter: issuing a new one retires the old.
  await tx.query(
    `UPDATE pmp.speaker_tokens SET revoked_at = now()
      WHERE speaker_id = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [speaker.id],
  );

  const code = generateAccessCode();
  const expires = new Date(Date.now() + (input.days ?? 45) * 86_400_000);
  await tx.query(
    `INSERT INTO pmp.speaker_tokens
       (speaker_id, event_id, client_id, kind, token_hash, expires_at, code_hint, issued_by)
     VALUES ($1,$2,$3,'access_code',$4,$5,$6,$7)`,
    [speaker.id, speaker.event_id, speaker.client_id, hashSecret(normaliseCode(code)), expires, code.slice(-4), actor.id],
  );

  await appendAudit(tx, {
    partitionId: speaker.event_id,
    clientId: speaker.client_id,
    actorUserId: actor.id,
    action: "auth.credential_issued",
    subjectType: "speaker",
    subjectId: speaker.id,
    detail: { code_hint: code.slice(-4), expires_at: expires.toISOString() },
  });

  return ok({
    speaker_id: speaker.id,
    speaker: speaker.full_name,
    email: speaker.email,
    access_code: code,
    code_hint: code.slice(-4),
    link: `${input.portalBase}/t/${encodeURIComponent(code)}`,
    expires_at: expires.toISOString(),
  });
}

export async function revokePresenterCredential(
  tx: pg.PoolClient,
  actor: Actor,
  speakerId: string,
): Promise<Result<{ revoked: number }, DomainError>> {
  if (!hasAnyRole(actor, atLeast("srr_technician"))) {
    return err({ code: "auth.forbidden", message: "Revoking credentials requires an SRR technician or above." });
  }
  const { rowCount } = await tx.query(
    `UPDATE pmp.speaker_tokens SET revoked_at = now() WHERE speaker_id = $1 AND revoked_at IS NULL`,
    [speakerId],
  );
  await tx.query(
    `UPDATE pmp.auth_sessions SET revoked_at = now() WHERE speaker_id = $1 AND revoked_at IS NULL`,
    [speakerId],
  );
  return ok({ revoked: rowCount ?? 0 });
}
