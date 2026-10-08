import type pg from "pg";
import { portalTalks } from "./portal.ts";
import type { PortalSession, PortalTalk } from "./portal.ts";

/**
 * What a speaker *account* (D-146) can reach: every speaker row that carries its email
 * address, on every event of every client. A speaker row is event-scoped and always
 * will be — it is how a speaker belongs to an agenda — so the account is the thing that
 * spans them, and email is the join: it is what the account signs in with and what DXG
 * holds for the speaker on each event.
 *
 * Each match becomes the same `PortalSession` the speaker portal works with, so every
 * portal rule (own talks only, approved file only, final-locked, archived read-only)
 * applies unchanged.
 */
export async function speakerSessionsFor(tx: pg.PoolClient, email: string): Promise<PortalSession[]> {
  const { rows } = await tx.query<PortalSession & { status: string }>(
    `SELECT sp.id AS speaker_id, sp.full_name AS speaker_name, e.id AS event_id, e.client_id,
            e.name AS event_name, e.timezone, e.status
       FROM pmp.speakers sp JOIN pmp.events e ON e.id = sp.event_id
      WHERE lower(sp.email::text) = $1 AND sp.merged_into IS NULL AND sp.removed_at IS NULL
        AND NOT e.is_practice
      ORDER BY e.starts_on DESC, e.name`,
    [email.trim().toLowerCase()],
  );
  return rows;
}

export type MyEvent = {
  id: string;
  name: string;
  timezone: string;
  starts_on: string;
  ends_on: string;
  status: string;
  upload_deadline: string | null;
  accent: string | null;
  speaker_id: string;
  talks: PortalTalk[];
};

/** Every presentation this account speaks on, grouped by event, newest event first. */
export async function myPresentations(tx: pg.PoolClient, email: string): Promise<MyEvent[]> {
  const sessions = await speakerSessionsFor(tx, email);
  const events: MyEvent[] = [];
  for (const session of sessions) {
    const { rows } = await tx.query<{
      starts_on: string;
      ends_on: string;
      status: string;
      deadline: string | null;
      accent: string | null;
    }>(
      `SELECT starts_on::text, ends_on::text, status, settings ->> 'upload_deadline' AS deadline,
              NULLIF(branding ->> 'accent', '') AS accent
         FROM pmp.events WHERE id = $1`,
      [session.event_id],
    );
    const event = rows[0]!;
    events.push({
      id: session.event_id,
      name: session.event_name,
      timezone: session.timezone,
      starts_on: event.starts_on,
      ends_on: event.ends_on,
      status: event.status,
      upload_deadline: event.deadline || null,
      accent: event.accent,
      speaker_id: session.speaker_id,
      talks: await portalTalks(tx, session),
    });
  }
  return events;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The session that owns a talk: the one of this account's speaker rows that is currently
 * assigned to it. Null when none is — a talk that is not the speaker's is "not yours",
 * the same refusal the portal gives, and never a hint that it exists.
 */
export async function sessionForSlot(tx: pg.PoolClient, email: string, slotId: string): Promise<PortalSession | null> {
  if (!UUID.test(slotId)) return null;
  const sessions = await speakerSessionsFor(tx, email);
  if (sessions.length === 0) return null;
  const { rows } = await tx.query<{ speaker_id: string }>(
    `SELECT sa.speaker_id FROM pmp.speaker_assignments sa
      WHERE sa.slot_id = $1 AND sa.replaced_by IS NULL AND sa.speaker_id = ANY($2::uuid[])
      LIMIT 1`,
    [slotId, sessions.map((session) => session.speaker_id)],
  );
  const owner = rows[0]?.speaker_id;
  return sessions.find((session) => session.speaker_id === owner) ?? null;
}

/** The session that owns an uploaded version, by the same rule. */
export async function sessionForVersion(tx: pg.PoolClient, email: string, versionId: string): Promise<PortalSession | null> {
  if (!UUID.test(versionId)) return null;
  const { rows } = await tx.query<{ slot_id: string }>(
    `SELECT f.slot_id FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id WHERE fv.id = $1`,
    [versionId],
  );
  return rows[0] ? sessionForSlot(tx, email, rows[0].slot_id) : null;
}

/**
 * The session an upload in progress belongs to. An upload id is minted by `beginUpload`
 * with the talk it is for, so resuming or finishing one goes through the talk's owner —
 * never through whichever talk the request body names.
 */
export async function sessionForUpload(tx: pg.PoolClient, email: string, uploadId: string): Promise<{ session: PortalSession; slotId: string } | null> {
  if (!UUID.test(uploadId)) return null;
  const { rows } = await tx.query<{ request_hash: string }>(
    `SELECT request_hash FROM pmp.idempotency_keys WHERE key = $1`,
    [uploadId],
  );
  const slotId = rows[0]?.request_hash.replace(/^upload:/, "");
  if (!slotId) return null;
  const session = await sessionForSlot(tx, email, slotId);
  return session ? { session, slotId } : null;
}
