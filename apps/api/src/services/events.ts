import type pg from "pg";
import { appendAudit } from "@pmp/db";
import type { Actor, DomainError, Result } from "@pmp/domain";
import { err, ok } from "@pmp/domain";

export type CreateEventInput = {
  name: string;
  venue: string;
  timezone: string;
  starts_on: string;
  ends_on: string;
};

export type EventDraft = {
  id: string;
  name: string;
  status: string;
  rooms: string[];
  tracks: string[];
  days: number;
  settings: Record<string, unknown>;
};

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "UTC",
];

export const isKnownTimezone = (value: string): boolean => TIMEZONES.includes(value);
export const supportedTimezones = (): string[] => [...TIMEZONES];

/** Step 1 — a draft event. A draft sends nothing to anyone (SCREEN_SPECS §2). */
export async function createEvent(
  tx: pg.PoolClient,
  actor: Actor,
  clientId: string,
  input: CreateEventInput,
): Promise<Result<{ event_id: string }, DomainError>> {
  if (!input.name.trim()) return err({ code: "events.name_required", message: "The event needs a name." });
  if (!isKnownTimezone(input.timezone)) {
    return err({
      code: "events.unknown_timezone",
      message: `“${input.timezone}” is not a supported timezone.`,
    });
  }
  if (new Date(input.ends_on) < new Date(input.starts_on)) {
    return err({ code: "events.bad_dates", message: "The event cannot end before it starts." });
  }

  let venueId: string | null = null;
  if (input.venue.trim()) {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO pmp.venues (name) VALUES ($1) RETURNING id`,
      [input.venue.trim()],
    );
    venueId = rows[0]!.id;
  }

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.events (client_id, venue_id, name, starts_on, ends_on, timezone, status, settings)
     VALUES ($1,$2,$3,$4,$5,$6,'draft','{}'::jsonb) RETURNING id`,
    [clientId, venueId, input.name.trim(), input.starts_on, input.ends_on, input.timezone],
  );
  const eventId = rows[0]!.id;

  // Every day between the dates, so the schedule has somewhere to hang.
  for (
    let day = new Date(`${input.starts_on}T00:00:00Z`);
    day <= new Date(`${input.ends_on}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    await tx.query(
      `INSERT INTO pmp.event_days (event_id, client_id, day_date) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [eventId, clientId, day.toISOString().slice(0, 10)],
    );
  }

  await appendAudit(tx, {
    partitionId: eventId,
    clientId,
    actorUserId: actor.id,
    action: "events.created",
    subjectType: "event",
    subjectId: eventId,
    detail: { name: input.name, timezone: input.timezone },
  });

  return ok({ event_id: eventId });
}

/** Steps 2–4 — rooms, tracks, deadlines, branding. */
export async function configureEvent(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  input: { rooms?: string[]; tracks?: string[]; settings?: Record<string, unknown>; branding?: Record<string, unknown> },
): Promise<Result<EventDraft, DomainError>> {
  const { rows: eventRows } = await tx.query<{ client_id: string }>(
    `SELECT client_id FROM pmp.events WHERE id = $1`,
    [eventId],
  );
  if (!eventRows[0]) return err({ code: "events.not_found", message: "No such event." });
  const clientId = eventRows[0].client_id;

  for (const room of input.rooms ?? []) {
    if (!room.trim()) continue;
    await tx.query(
      `INSERT INTO pmp.rooms (event_id, client_id, name)
       SELECT $1, $2, $3
        WHERE NOT EXISTS (SELECT 1 FROM pmp.rooms WHERE event_id = $1 AND lower(name) = lower($3))`,
      [eventId, clientId, room.trim()],
    );
  }
  for (const track of input.tracks ?? []) {
    if (!track.trim()) continue;
    await tx.query(
      `INSERT INTO pmp.tracks (event_id, client_id, name)
       SELECT $1, $2, $3
        WHERE NOT EXISTS (SELECT 1 FROM pmp.tracks WHERE event_id = $1 AND lower(name) = lower($3))`,
      [eventId, clientId, track.trim()],
    );
  }
  if (input.settings) {
    await tx.query(
      `UPDATE pmp.events SET settings = settings || $2::jsonb, lock_version = lock_version + 1 WHERE id = $1`,
      [eventId, JSON.stringify(input.settings)],
    );
  }
  if (input.branding) {
    await tx.query(
      `UPDATE pmp.events SET branding = COALESCE(branding,'{}'::jsonb) || $2::jsonb, lock_version = lock_version + 1
        WHERE id = $1`,
      [eventId, JSON.stringify(input.branding)],
    );
  }

  await appendAudit(tx, {
    partitionId: eventId,
    clientId,
    actorUserId: actor.id,
    action: "events.configured",
    subjectType: "event",
    subjectId: eventId,
    detail: { rooms: input.rooms?.length ?? 0, tracks: input.tracks?.length ?? 0 },
  });

  return draftOf(tx, eventId);
}

export async function draftOf(tx: pg.PoolClient, eventId: string): Promise<Result<EventDraft, DomainError>> {
  const { rows } = await tx.query<{
    id: string;
    name: string;
    status: string;
    settings: Record<string, unknown>;
    days: string;
    rooms: string[];
    tracks: string[];
  }>(
    `SELECT e.id, e.name, e.status, e.settings,
            (SELECT count(*)::text FROM pmp.event_days d WHERE d.event_id = e.id) AS days,
            COALESCE((SELECT array_agg(r.name ORDER BY r.name) FROM pmp.rooms r WHERE r.event_id = e.id), '{}') AS rooms,
            COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM pmp.tracks t WHERE t.event_id = e.id), '{}') AS tracks
       FROM pmp.events e WHERE e.id = $1`,
    [eventId],
  );
  const row = rows[0];
  if (!row) return err({ code: "events.not_found", message: "No such event." });
  return ok({
    id: row.id,
    name: row.name,
    status: row.status,
    rooms: row.rooms,
    tracks: row.tracks,
    days: Number(row.days),
    settings: row.settings ?? {},
  });
}

/** Activating turns a draft into a live event. */
export async function activateEvent(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
): Promise<Result<EventDraft, DomainError>> {
  const draft = await draftOf(tx, eventId);
  if (!draft.ok) return draft;
  if (draft.value.rooms.length === 0 || draft.value.days === 0) {
    return err({
      code: "events.incomplete",
      message: "An event needs at least one day and one room before it can be activated.",
    });
  }
  await tx.query(`UPDATE pmp.events SET status = 'active', lock_version = lock_version + 1 WHERE id = $1`, [
    eventId,
  ]);
  const { rows } = await tx.query<{ client_id: string }>(`SELECT client_id FROM pmp.events WHERE id = $1`, [
    eventId,
  ]);
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: rows[0]!.client_id,
    actorUserId: actor.id,
    action: "events.activated",
    subjectType: "event",
    subjectId: eventId,
  });
  return draftOf(tx, eventId);
}

/**
 * FR-EVT-002: duplication copies structure and settings — rooms, tracks, days,
 * deadlines, branding, templates — and copies no speakers, files or
 * communications. Last year's decks must not appear in this year's event.
 */
export async function duplicateEvent(
  tx: pg.PoolClient,
  actor: Actor,
  sourceId: string,
  input: { name: string; starts_on: string; ends_on: string },
): Promise<Result<{ event_id: string; rooms: number; tracks: number }, DomainError>> {
  const { rows: sourceRows } = await tx.query<{
    client_id: string;
    venue_id: string | null;
    timezone: string;
    settings: Record<string, unknown>;
    branding: Record<string, unknown> | null;
  }>(`SELECT client_id, venue_id, timezone, settings, branding FROM pmp.events WHERE id = $1`, [sourceId]);
  const source = sourceRows[0];
  if (!source) return err({ code: "events.not_found", message: "No such event." });

  const { rows: created } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.events (client_id, venue_id, name, starts_on, ends_on, timezone, status, settings, branding, duplicated_from)
     VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9) RETURNING id`,
    [
      source.client_id,
      source.venue_id,
      input.name,
      input.starts_on,
      input.ends_on,
      source.timezone,
      JSON.stringify(source.settings ?? {}),
      JSON.stringify(source.branding ?? {}),
      sourceId,
    ],
  );
  const eventId = created[0]!.id;

  const { rowCount: rooms } = await tx.query(
    `INSERT INTO pmp.rooms (event_id, client_id, name, capacity, room_code)
     SELECT $1, client_id, name, capacity, room_code FROM pmp.rooms WHERE event_id = $2`,
    [eventId, sourceId],
  );
  const { rowCount: tracks } = await tx.query(
    `INSERT INTO pmp.tracks (event_id, client_id, name)
     SELECT $1, client_id, name FROM pmp.tracks WHERE event_id = $2`,
    [eventId, sourceId],
  );
  await tx.query(
    `INSERT INTO pmp.communication_templates (client_id, event_id, name, subject, body)
     SELECT client_id, $1, name, subject, body FROM pmp.communication_templates WHERE event_id = $2`,
    [eventId, sourceId],
  );
  for (
    let day = new Date(`${input.starts_on}T00:00:00Z`);
    day <= new Date(`${input.ends_on}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    await tx.query(
      `INSERT INTO pmp.event_days (event_id, client_id, day_date) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [eventId, source.client_id, day.toISOString().slice(0, 10)],
    );
  }

  await appendAudit(tx, {
    partitionId: eventId,
    clientId: source.client_id,
    actorUserId: actor.id,
    action: "events.duplicated",
    subjectType: "event",
    subjectId: eventId,
    detail: { duplicated_from: sourceId, rooms: rooms ?? 0, tracks: tracks ?? 0 },
  });

  return ok({ event_id: eventId, rooms: rooms ?? 0, tracks: tracks ?? 0 });
}
