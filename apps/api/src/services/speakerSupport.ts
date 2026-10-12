import type pg from "pg";
import { appendAudit } from "@pmp/db";
import type { Actor, DomainError, Result } from "@pmp/domain";
import { atLeast, err, hasAnyRole, ok } from "@pmp/domain";
import { generateAccessCode, hashPassword } from "@pmp/auth";
import { ensureSpeakerSignIn } from "./auth.ts";

/*
 * Speaker Support Staff (client review, D-156): an admin assistant who submits presentations
 * for a speaker. DXG staff — Admins and support staff — give them a sign-in from the Speakers
 * screen (Travis: "DXG-কে দিয়ে করাও"); the speaker sees the list on their site. It is a speaker
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
        `The DXG presentation team has given you a sign-in on DXG·PM, so you can upload and`,
        `update ${input.speaker}'s presentations for the events they speak at.`,
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

/** Who may give a speaker support staff: DXG Admins and support staff (managers on the event). */
const MANAGERS = atLeast("presentation_manager");
const FORBIDDEN: DomainError = {
  code: "auth.forbidden",
  message: "Only a DXG Admin or support staff can give a speaker support staff.",
};

export type SpeakerAccount = { user_id: string; name: string; email: string; client_id: string };

/**
 * The speaker's own sign-in, which support staff hang off — made now if they have none (no
 * email goes; their invitation reissues the temporary password as it would anyway, D-147).
 */
export async function speakerAccountFor(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  speakerId: string,
): Promise<Result<SpeakerAccount, DomainError>> {
  if (!hasAnyRole(actor, MANAGERS)) return err(FORBIDDEN);
  const { rows } = await tx.query<{ full_name: string; email: string | null; client_id: string }>(
    `SELECT full_name, email::text, client_id FROM pmp.speakers
      WHERE id = $1 AND event_id = $2 AND merged_into IS NULL AND removed_at IS NULL`,
    [speakerId, eventId],
  );
  const speaker = rows[0];
  if (!speaker) return err({ code: "speakers.not_found", message: "This speaker no longer exists — it may have been removed. Refresh the page." });
  const email = (speaker.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) {
    return err({ code: "support.speaker_no_email", message: "Add the speaker's email address first — their support staff work under it." });
  }
  const signIn = await ensureSpeakerSignIn(tx, { email, displayName: speaker.full_name, eventId, clientId: speaker.client_id, actorUserId: actor.id });
  if (signIn.outcome === "staff" || signIn.outcome === "assistant") {
    return err({ code: "support.speaker_address_taken", message: "The speaker's address belongs to another kind of account. Correct it on the Agenda first." });
  }
  const { rows: account } = await tx.query<{ display_name: string }>(`SELECT display_name FROM pmp.users WHERE id = $1`, [signIn.user_id]);
  return ok({ user_id: signIn.user_id, name: account[0]?.display_name ?? speaker.full_name, email, client_id: speaker.client_id });
}

/**
 * DXG staff add a support staff member for a speaker: a new sign-in for an address no one
 * else uses, with a temporary password emailed to it. An address that is already an account,
 * or a speaker's own address on any event, is refused — that person has (or will have) a
 * sign-in of their own.
 */
export async function addSupportStaff(
  tx: pg.PoolClient,
  speaker: SpeakerAccount,
  input: { name: unknown; email: unknown },
  by: { actorUserId: string; eventId: string },
): Promise<Result<SupportStaffRow, DomainError>> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!name || name.length > 80) return err({ code: "support.bad_name", message: "Write their name (up to 80 characters)." });
  if (!EMAIL.test(email) || email.length > 120) return err({ code: "support.bad_email", message: "Write a valid email address." });
  if (email === speaker.email.toLowerCase()) {
    return err({ code: "support.self", message: "That's the speaker's own address. Add their assistant's address instead." });
  }
  if ((await listSupportStaff(tx, speaker.user_id)).length >= MAX_SUPPORT_STAFF) {
    return err({ code: "support.too_many", message: `A speaker can have up to ${MAX_SUPPORT_STAFF} support staff. Remove one to add another.` });
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
      message: "That address already has a DXG·PM sign-in, or is a speaker's own address. Use a different address for the assistant.",
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
  await appendAudit(tx, {
    partitionId: by.eventId,
    clientId: speaker.client_id,
    actorUserId: by.actorUserId,
    action: "auth.speaker_support_added",
    subjectType: "user",
    subjectId: row.user_id,
    detail: { email, assists: speaker.user_id, speaker: speaker.email },
  });
  return ok(row);
}

/** DXG staff remove a speaker's support staff member: the sign-in is closed and its sessions end. */
export async function removeSupportStaff(
  tx: pg.PoolClient,
  speaker: SpeakerAccount,
  assistantId: string,
  by: { actorUserId: string; eventId: string },
): Promise<Result<{ removed: true }, DomainError>> {
  const speakerUserId = speaker.user_id;
  const { rowCount } = await tx.query(
    `UPDATE pmp.users SET is_active = false WHERE id = $1 AND assists_user_id = $2 AND is_active`,
    [assistantId, speakerUserId],
  );
  if (!rowCount) return err({ code: "support.not_found", message: "That person isn't on your support staff any more. Refresh the page." });
  await tx.query(`UPDATE pmp.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [assistantId]);
  await appendAudit(tx, {
    partitionId: by.eventId,
    clientId: speaker.client_id,
    actorUserId: by.actorUserId,
    action: "auth.speaker_support_removed",
    subjectType: "user",
    subjectId: assistantId,
    detail: { assists: speakerUserId },
  });
  return ok({ removed: true });
}
