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

/* ── the speaker's other views (Travis, 2026-10-08): events, agenda, Speaker Ready Room ── */

export type MyEventSummary = {
  id: string;
  name: string;
  timezone: string;
  starts_on: string;
  ends_on: string;
  status: string;
  venue: string | null;
};

/** The events this account speaks at, newest first — for the sidebar's switcher and the portfolio. */
export async function myEvents(tx: pg.PoolClient, email: string): Promise<MyEventSummary[]> {
  const sessions = await speakerSessionsFor(tx, email);
  if (sessions.length === 0) return [];
  const { rows } = await tx.query<MyEventSummary>(
    `SELECT e.id, e.name, e.timezone, e.starts_on::text, e.ends_on::text, e.status, v.name AS venue
       FROM pmp.events e LEFT JOIN pmp.venues v ON v.id = e.venue_id
      WHERE e.id = ANY($1::uuid[])
      ORDER BY e.starts_on DESC, e.name`,
    [sessions.map((session) => session.event_id)],
  );
  return rows;
}

/** This account's session on one event, or null when it does not speak there. */
export async function sessionForEvent(tx: pg.PoolClient, email: string, eventId: string): Promise<PortalSession | null> {
  if (!UUID.test(eventId)) return null;
  return (await speakerSessionsFor(tx, email)).find((session) => session.event_id === eventId) ?? null;
}

export type MyAgendaPresentation = {
  slot_id: string;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  speakers: { name: string; organization: string | null; role: string }[];
  /** One of this speaker's own; only then is its status shown. */
  mine: boolean;
  status: string | null;
  status_label: string | null;
};

export type MyAgendaSession = {
  id: string;
  title: string;
  kind: string;
  state: string;
  day: string | null;
  room: string | null;
  track: string | null;
  starts_at: string;
  ends_at: string;
  presentations: MyAgendaPresentation[];
};

/**
 * The event's programme as a speaker may see it: every session, presentation and presenter
 * name (the public programme), with the status of the speaker's own talks only — no file
 * counts, no state of anyone else's presentation.
 */
export async function myAgenda(tx: pg.PoolClient, session: PortalSession): Promise<MyAgendaSession[]> {
  const { eventAgenda } = await import("./agenda.ts");
  const { rows: mine } = await tx.query<{ slot_id: string }>(
    `SELECT slot_id FROM pmp.speaker_assignments WHERE speaker_id = $1 AND replaced_by IS NULL`,
    [session.speaker_id],
  );
  const own = new Set(mine.map((row) => row.slot_id));
  const agenda = await eventAgenda(tx, session.event_id);
  return agenda.map((item) => ({
    id: item.id,
    title: item.title,
    kind: item.kind,
    state: item.state,
    day: item.day,
    room: item.room,
    track: item.track,
    starts_at: item.starts_at,
    ends_at: item.ends_at,
    presentations: item.presentations.map((presentation) => ({
      slot_id: presentation.slot_id,
      title: presentation.title,
      starts_at: presentation.starts_at,
      ends_at: presentation.ends_at,
      speakers: presentation.speakers.map((who) => ({ name: who.name, organization: who.organization, role: who.role })),
      mine: own.has(presentation.slot_id),
      status: own.has(presentation.slot_id) ? presentation.status : null,
      status_label: own.has(presentation.slot_id) ? presentation.status_label : null,
    })),
  }));
}

export type MySrr = {
  event: { id: string; name: string; timezone: string; starts_on: string; ends_on: string; venue: string | null };
  /** The desks the team has set up; a speaker checks in at one of them. */
  stations: { name: string; busy: boolean }[];
  /** This speaker's visits, newest first. */
  checkins: { id: string; station: string | null; checked_in_at: string; departed_at: string | null; technician: string }[];
  /** What they confirmed as final, newest first. */
  sign_offs: { signed_at: string; version_number: number; file_name: string; talk: string; receipt_emailed_to: string | null }[];
  talks: PortalTalk[];
};

/**
 * The Speaker Ready Room as the speaker sees it: where to go, whether they have checked in
 * and what they signed off — and their own presentations for the event, to look over or
 * replace before they do (a speaker may update from here; the client's review asked for it).
 */
export async function mySrr(tx: pg.PoolClient, session: PortalSession): Promise<MySrr> {
  const { rows: eventRows } = await tx.query<MySrr["event"]>(
    `SELECT e.id, e.name, e.timezone, e.starts_on::text, e.ends_on::text, v.name AS venue
       FROM pmp.events e LEFT JOIN pmp.venues v ON v.id = e.venue_id WHERE e.id = $1`,
    [session.event_id],
  );
  const { rows: stations } = await tx.query<{ name: string; busy: boolean }>(
    `SELECT st.name,
            EXISTS (SELECT 1 FROM pmp.srr_checkins c WHERE c.station_id = st.id AND c.departed_at IS NULL) AS busy
       FROM pmp.srr_stations st WHERE st.event_id = $1 AND st.retired_at IS NULL
      ORDER BY st.position, st.created_at`,
    [session.event_id],
  );
  const { rows: checkins } = await tx.query<MySrr["checkins"][number]>(
    `SELECT c.id, COALESCE(st.name, c.station) AS station, c.checked_in_at::text, c.departed_at::text,
            u.display_name AS technician
       FROM pmp.srr_checkins c
       LEFT JOIN pmp.srr_stations st ON st.id = c.station_id
       JOIN pmp.users u ON u.id = c.technician_id
      WHERE c.speaker_id = $1 AND c.event_id = $2
      ORDER BY c.checked_in_at DESC`,
    [session.speaker_id, session.event_id],
  );
  const { rows: signOffs } = await tx.query<MySrr["sign_offs"][number]>(
    `SELECT so.signed_at::text, fv.version_number, fv.original_filename AS file_name, s.title AS talk,
            r.emailed_to::text AS receipt_emailed_to
       FROM pmp.sign_offs so
       JOIN pmp.file_versions fv ON fv.id = so.file_version_id
       JOIN pmp.files f ON f.id = fv.file_id
       JOIN pmp.slots s ON s.id = f.slot_id
       LEFT JOIN pmp.receipts r ON r.id = so.receipt_id
      WHERE so.speaker_id = $1 AND so.event_id = $2
      ORDER BY so.signed_at DESC`,
    [session.speaker_id, session.event_id],
  );
  return {
    event: eventRows[0]!,
    stations,
    checkins,
    sign_offs: signOffs,
    talks: await portalTalks(tx, session),
  };
}
