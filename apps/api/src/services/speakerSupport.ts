import type pg from "pg";
import { appendAudit } from "@pmp/db";
import type { DomainError, Result } from "@pmp/domain";
import { err, ok } from "@pmp/domain";
import { generateAccessCode, hashPassword } from "@pmp/auth";

/*
 * Speaker Support Staff (client review, D-155): an admin assistant who submits presentations
 * for a speaker. The speaker gives them a sign-in from their own site; it is a speaker
 * account that *assists* theirs — it reaches the speaker's presentations (Manage
 * presentations: look, upload, update, download) and nothing else: no agenda, no Speaker
 * Ready Room, no notifications, no assistants of its own.
 */

export const MAX_SUPPORT_STAFF = 5;

export type SupportStaffRow = {
  user_id: string;
  name: string;
  email: string;
  /** "invited" until they choose their own password, then "active". */
  state: "invited" | "active";
  added_at: string;
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function listSupportStaff(tx: pg.PoolClient, speakerUserId: string): Promise<SupportStaffRow[]> {
  const { rows } = await tx.query<SupportStaffRow>(
    `SELECT id AS user_id, display_name AS name, email::text AS email,
            CASE WHEN must_change_password THEN 'invited' ELSE 'active' END AS state,
            created_at AS added_at
       FROM pmp.users
      WHERE assists_user_id = $1 AND is_active AND deleted_at IS NULL
      ORDER BY created_at`,
    [speakerUserId],
  );
  return rows;
}

/** The sign-in email for a new support staff member, sent through the outbox like every email. */
async function queueSupportSignInEmail(
  tx: pg.PoolClient,
  input: { to: string; name: string; speaker: string; temporaryPassword: string },
): Promise<void> {
  const signIn = `${process.env.PORTAL_BASE ?? "http://localhost:3001"}/login`;
  await tx.query(`INSERT INTO pmp.outbox (topic, payload) VALUES ('email.send', $1)`, [
    JSON.stringify({
      to: input.to,
      subject: `Your DXG·PM sign-in to submit ${input.speaker}'s presentations`,
      sensitive: true,
      body: [
        `Hi ${input.name},`,
        "",
        `${input.speaker} has given you a sign-in on DXG·PM, so you can upload and update`,
        "their presentations for the events they speak at.",
        "",
        "Sign in with this email address and the temporary password below:",
        "",
        `    ${input.temporaryPassword}`,
        "",
        signIn,
        "",
        "You will be asked to choose your own password straight away.",
        "",
        `If you were not expecting this email, tell ${input.speaker} or the DXG presentation team.`,
        "",
        "The DXG presentation team",
      ].join("\n"),
    }),
  ]);
}

/**
 * A speaker adds a support staff member: a new sign-in for an address no one else uses, with
 * a temporary password emailed to it. An address that is already an account, or a speaker's
 * own address on any event, is refused — that person has (or will have) a sign-in of their own.
 */
export async function addSupportStaff(
  tx: pg.PoolClient,
  speaker: { user_id: string; name: string; email: string },
  input: { name: unknown; email: unknown },
): Promise<Result<SupportStaffRow, DomainError>> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!name || name.length > 80) return err({ code: "support.bad_name", message: "Write their name (up to 80 characters)." });
  if (!EMAIL.test(email) || email.length > 120) return err({ code: "support.bad_email", message: "Write a valid email address." });
  if (email === speaker.email.toLowerCase()) {
    return err({ code: "support.self", message: "That's your own address. Add your assistant's address instead." });
  }
  if ((await listSupportStaff(tx, speaker.user_id)).length >= MAX_SUPPORT_STAFF) {
    return err({ code: "support.too_many", message: `You can have up to ${MAX_SUPPORT_STAFF} support staff. Remove one to add another.` });
  }

  const { rows: taken } = await tx.query(
    `SELECT 1 FROM pmp.users WHERE lower(email::text) = $1 AND deleted_at IS NULL
     UNION ALL
     SELECT 1 FROM pmp.speakers WHERE lower(email::text) = $1 AND merged_into IS NULL AND removed_at IS NULL
     LIMIT 1`,
    [email],
  );
  if (taken.length > 0) {
    return err({
      code: "support.email_taken",
      message: "That address already has a DXG·PM sign-in, or is a speaker's own address. Use a different address for your assistant.",
    });
  }

  const temporary = generateAccessCode(4, 4);
  const { rows } = await tx.query<SupportStaffRow>(
    `INSERT INTO pmp.users (email, display_name, password_hash, password_set_at, must_change_password, account_kind, assists_user_id)
     VALUES ($1::citext, $2, $3, now(), true, 'speaker', $4)
     RETURNING id AS user_id, display_name AS name, email::text AS email, 'invited' AS state, created_at AS added_at`,
    [email, name, await hashPassword(temporary), speaker.user_id],
  );
  const row = rows[0]!;
  await queueSupportSignInEmail(tx, { to: email, name, speaker: speaker.name, temporaryPassword: temporary });
  // Account changes are audited against the account (as staff accounts are, D-100).
  await appendAudit(tx, {
    partitionId: row.user_id,
    clientId: row.user_id,
    actorUserId: speaker.user_id,
    action: "auth.speaker_support_added",
    subjectType: "user",
    subjectId: row.user_id,
    detail: { email, assists: speaker.user_id },
  });
  return ok(row);
}

/** A speaker removes a support staff member: the sign-in is closed and its sessions end. */
export async function removeSupportStaff(
  tx: pg.PoolClient,
  speakerUserId: string,
  assistantId: string,
): Promise<Result<{ removed: true }, DomainError>> {
  const { rowCount } = await tx.query(
    `UPDATE pmp.users SET is_active = false WHERE id = $1 AND assists_user_id = $2 AND is_active`,
    [assistantId, speakerUserId],
  );
  if (!rowCount) return err({ code: "support.not_found", message: "That person isn't on your support staff any more. Refresh the page." });
  await tx.query(`UPDATE pmp.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [assistantId]);
  await appendAudit(tx, {
    partitionId: assistantId,
    clientId: assistantId,
    actorUserId: speakerUserId,
    action: "auth.speaker_support_removed",
    subjectType: "user",
    subjectId: assistantId,
    detail: { assists: speakerUserId },
  });
  return ok({ removed: true });
}
