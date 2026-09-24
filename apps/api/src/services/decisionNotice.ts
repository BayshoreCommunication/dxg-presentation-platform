import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Actor } from "@pmp/domain";
import { hashToken } from "./portal.ts";

const PORTAL_BASE = process.env.PORTAL_BASE ?? "http://localhost:3001";

export type DecisionNoticeResult = {
  /** Speakers an email was queued for. */
  emailed: string[];
  /** Speakers on the talk with no email address — they will see the note only in the portal. */
  without_email: string[];
};

/**
 * Tells the speaker what a reviewer decided and why (D-073). Until this, "Request
 * revision" and "Reject" said "speaker notified" and notified nobody: the only event they
 * raised went to a worker that does not exist, and the speaker learnt nothing unless a
 * reviewer also thought to write a comment.
 *
 * Runs inside the decision's transaction, so the note, the comment and the email exist
 * together with the decision or not at all:
 *   - the message becomes a speaker-lane comment, shown in the speaker's portal;
 *   - each speaker on the talk with an address gets an email carrying the message and
 *     their own sign-in link, recorded in `communications` like any other mail (stored
 *     body with the link removed, D-069) and sent through the outbox.
 */
export async function noticeToSpeakers(
  tx: pg.PoolClient,
  actor: Actor,
  input: { versionId: string; outcome: "changes_requested" | "rejected"; message: string },
): Promise<DecisionNoticeResult> {
  const { rows: context } = await tx.query<{
    event_id: string;
    client_id: string;
    event_name: string;
    title: string;
    version_number: number;
  }>(
    `SELECT fv.event_id, fv.client_id, e.name AS event_name, s.title, fv.version_number
       FROM pmp.file_versions fv
       JOIN pmp.files f  ON f.id = fv.file_id
       JOIN pmp.slots s  ON s.id = f.slot_id
       JOIN pmp.events e ON e.id = fv.event_id
      WHERE fv.id = $1`,
    [input.versionId],
  );
  const talk = context[0];
  if (!talk) return { emailed: [], without_email: [] };

  await tx.query(
    `INSERT INTO pmp.comments (event_id, client_id, file_version_id, lane, author_user_id, body)
     VALUES ($1, $2, $3, 'speaker_visible', $4, $5)`,
    [talk.event_id, talk.client_id, input.versionId, actor.id, input.message],
  );

  const { rows: speakers } = await tx.query<{ id: string; full_name: string; email: string | null }>(
    `SELECT sp.id, sp.full_name, sp.email::text AS email
       FROM pmp.speaker_assignments sa
       JOIN pmp.speakers sp ON sp.id = sa.speaker_id
       JOIN pmp.files f ON f.slot_id = sa.slot_id
       JOIN pmp.file_versions fv ON fv.file_id = f.id
      WHERE fv.id = $1 AND sa.replaced_by IS NULL AND sp.merged_into IS NULL`,
    [input.versionId],
  );

  const result: DecisionNoticeResult = { emailed: [], without_email: [] };
  for (const speaker of speakers) {
    if (!speaker.email) {
      result.without_email.push(speaker.full_name);
      continue;
    }
    const token = randomUUID();
    await tx.query(
      `INSERT INTO pmp.speaker_tokens (speaker_id, event_id, client_id, kind, token_hash, expires_at)
       VALUES ($1, $2, $3, 'magic_link', $4, now() + interval '30 days')`,
      [speaker.id, talk.event_id, talk.client_id, hashToken(token)],
    );

    const changes = input.outcome === "changes_requested";
    const subject = changes
      ? `${talk.event_name}: changes needed to “${talk.title}”`
      : `${talk.event_name}: “${talk.title}” was not accepted`;
    const link = `${PORTAL_BASE}/t/${token}`;
    const body = [
      `Hi ${speaker.full_name},`,
      "",
      changes
        ? `We've reviewed version ${talk.version_number} of your presentation for “${talk.title}” and need a few changes before it can go to the room:`
        : `We've reviewed version ${talk.version_number} of your presentation for “${talk.title}” and could not accept it:`,
      "",
      input.message,
      "",
      changes
        ? `Please upload a corrected version using your personal link: ${link}`
        : `You can upload a new version, or see the details, using your personal link: ${link}`,
      "",
      "Reply to this email if anything is unclear.",
    ].join("\n");

    const { rows: comm } = await tx.query<{ id: string }>(
      `INSERT INTO pmp.communications (event_id, client_id, speaker_id, to_address, subject, body, status)
       VALUES ($1, $2, $3, $4::citext, $5, $6, 'queued') RETURNING id`,
      [talk.event_id, talk.client_id, speaker.id, speaker.email, subject, body.replaceAll(token, "[personal link removed]")],
    );
    await tx.query(`INSERT INTO pmp.outbox (topic, payload) VALUES ('email.send', $1)`, [
      JSON.stringify({ communication_id: comm[0]!.id, to: speaker.email, subject, body }),
    ]);
    result.emailed.push(speaker.full_name);
  }
  return result;
}
