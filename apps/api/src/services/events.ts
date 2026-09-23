import type pg from "pg";
import { appendAudit } from "@pmp/db";
import type { Actor, DomainError, Result } from "@pmp/domain";
import { atLeast, err, hasAnyRole, ok } from "@pmp/domain";

/**
 * Who may set an event up. SCREEN_SPECS §2 says PjM, PM and Admin, and until now
 * nothing enforced it: `POST /events`, `PATCH /events/{id}`, activate and duplicate
 * took a staff session and an event scope and asked nothing further. Demonstrated
 * before this was added — `t.okafor`, a room technician on MedTech Forward and nothing
 * else there, set that event's upload deadline to 1999-01-01 and its accent colour,
 * and was answered 200. The deadline is what closes speaker uploads, so that is an
 * account with custody of one room locking every speaker out of the event.
 *
 * `room_technician` is deliberately not on the ladder (packages/domain/roles.ts): its
 * authority is physical custody of a room, which is not seniority, so a rule that
 * means to include it has to name it. This one does not mean to.
 */
const CONFIGURERS = atLeast("presentation_manager");

const forbidden = (attempt: string): DomainError => ({
  code: "events.forbidden",
  message: `${attempt} needs a presentation manager, project manager or administrator.`,
});

export type CreateEventInput = {
  name: string;
  venue: string;
  timezone: string;
  starts_on: string;
  ends_on: string;
};

/**
 * Everything the create-event wizard puts on screen, so an abandoned draft can be
 * resumed with what was already typed rather than started again. The first four
 * fields after `status` are step 1's boxes; `sessions` is how the wizard knows
 * whether an agenda has been imported, which is what gates steps 3 and 4 (D-027).
 */
export type EventDraft = {
  id: string;
  name: string;
  status: string;
  venue: string | null;
  timezone: string;
  starts_on: string;
  ends_on: string;
  rooms: string[];
  tracks: string[];
  days: number;
  sessions: number;
  settings: Record<string, unknown>;
  branding: Record<string, unknown>;
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

/**
 * One rule set for both doors. Creating and later correcting an event's basics have
 * to agree — a draft resumed at step 1 is edited through `configureEvent`, and a
 * second copy of these three checks would be a second set of rules to drift.
 */
function checkBasics(input: CreateEventInput): DomainError | null {
  if (!input.name.trim()) return { code: "events.name_required", message: "The event needs a name." };
  if (!isKnownTimezone(input.timezone)) {
    return {
      code: "events.unknown_timezone",
      message: `“${input.timezone}” is not a supported timezone.`,
    };
  }
  if (new Date(input.ends_on) < new Date(input.starts_on)) {
    return { code: "events.bad_dates", message: "The event cannot end before it starts." };
  }
  return null;
}

/** Every date from `from` to `to` inclusive, as `YYYY-MM-DD`. */
function calendarDays(from: string, to: string): string[] {
  const days: string[] = [];
  for (
    let day = new Date(`${from}T00:00:00Z`);
    day <= new Date(`${to}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

/** Step 1 — a draft event. A draft sends nothing to anyone (SCREEN_SPECS §2). */
export async function createEvent(
  tx: pg.PoolClient,
  actor: Actor,
  clientId: string,
  input: CreateEventInput,
): Promise<Result<{ event_id: string }, DomainError>> {
  /*
   * The one place this asks a flat question rather than an event-scoped one, because
   * there is no event yet to scope to: a manager on any event may create a new one.
   * That is the same exception D-025 makes for `platform_admin`, and for the same
   * reason — creating an event is by definition done from outside every event. It
   * reaches into nothing that already exists.
   */
  if (!hasAnyRole(actor, CONFIGURERS)) return err(forbidden("Creating an event"));

  const invalid = checkBasics(input);
  if (invalid) return err(invalid);

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
  for (const day of calendarDays(input.starts_on, input.ends_on)) {
    await tx.query(
      `INSERT INTO pmp.event_days (event_id, client_id, day_date) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [eventId, clientId, day],
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

/** Steps 1–4 — basics, rooms, tracks, deadlines, branding. */
export async function configureEvent(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  input: {
    basics?: CreateEventInput;
    rooms?: string[];
    tracks?: string[];
    settings?: Record<string, unknown>;
    branding?: Record<string, unknown>;
  },
): Promise<Result<EventDraft, DomainError>> {
  const { rows: eventRows } = await tx.query<{
    client_id: string;
    status: string;
    venue_id: string | null;
    timezone: string;
    starts_on: string;
    ends_on: string;
  }>(
    `SELECT client_id, status, venue_id, timezone, starts_on::text, ends_on::text
       FROM pmp.events WHERE id = $1`,
    [eventId],
  );
  if (!eventRows[0]) return err({ code: "events.not_found", message: "No such event." });
  if (!hasAnyRole(actor, CONFIGURERS)) return err(forbidden("Changing an event's setup"));
  const clientId = eventRows[0].client_id;

  /*
   * Step 1 is editable while the event is a draft, because a draft is now something
   * you come back to: the portfolio sends an unfinished event here rather than to its
   * command centre. Without this the resumed boxes would accept typing and discard it
   * — the same trap D-033 removed from the row editor, where a field that looks
   * editable and is not is worse than one that is plainly locked.
   *
   * Only while a draft. After activation the dates, timezone and venue are load-bearing
   * for sessions, room files and every deadline computed from them, and moving them is
   * a rescheduling job rather than a correction.
   */
  if (input.basics) {
    /*
     * After activation the line runs between what a value *names* and what it
     * *means*. A name or a venue is a label: correcting either changes what people
     * read and nothing else, and both are wrong often enough — an event is created
     * before its venue is confirmed. The timezone and the dates are load-bearing:
     * every session time, every upload deadline and every room file hangs off them,
     * and moving them is a rescheduling job rather than a correction. So the refusal
     * is narrowed to exactly the three fields the reasoning was ever about, and it
     * names them rather than refusing the whole request generically.
     */
    if (eventRows[0].status !== "draft") {
      const live = eventRows[0];
      const locked = (
        [
          ["time zone", live.timezone, input.basics.timezone],
          ["start date", live.starts_on, input.basics.starts_on],
          ["end date", live.ends_on, input.basics.ends_on],
        ] as const
      )
        .filter(([, current, wanted]) => current !== wanted)
        .map(([label]) => label);
      if (locked.length > 0) {
        return err({
          code: "events.not_a_draft",
          message: `The ${locked.join(", ")} of an event that is no longer a draft cannot be changed here — its sessions, deadlines and room files are all set against them.`,
        });
      }
    }
    const invalid = checkBasics(input.basics);
    if (invalid) return err(invalid);

    const wanted = calendarDays(input.basics.starts_on, input.basics.ends_on);
    // A day carrying sessions is not ours to delete. It cannot happen from the wizard
    // — steps 3 and 4 are unreachable without an agenda, and step 1 is behind them —
    // but the endpoint is reachable directly, and a silent cascade here would drop an
    // imported agenda on a mistyped date.
    const { rows: stranded } = await tx.query<{ day_date: string; sessions: string }>(
      `SELECT d.day_date::text,
              (SELECT count(*)::text FROM pmp.sessions s WHERE s.day_id = d.id) AS sessions
         FROM pmp.event_days d
        WHERE d.event_id = $1 AND NOT (d.day_date::text = ANY($2::text[]))`,
      [eventId, wanted],
    );
    const inUse = stranded.filter((day) => Number(day.sessions) > 0);
    if (inUse.length > 0) {
      return err({
        code: "events.days_conflict",
        message: `The agenda has sessions on ${inUse
          .map((day) => day.day_date)
          .join(", ")}, which these dates would drop. Re-import the agenda or widen the dates.`,
      });
    }

    for (const day of wanted) {
      await tx.query(
        `INSERT INTO pmp.event_days (event_id, client_id, day_date) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [eventId, clientId, day],
      );
    }
    await tx.query(
      `DELETE FROM pmp.event_days WHERE event_id = $1 AND NOT (day_date::text = ANY($2::text[]))`,
      [eventId, wanted],
    );

    /*
     * A venue row is never edited in place unless this event is the only thing
     * pointing at it: `duplicateEvent` copies `venue_id`, so renaming the venue on a
     * duplicated draft would rename it under the event it was copied from.
     */
    const venue = input.basics.venue.trim();
    let venueId = eventRows[0].venue_id;
    if (!venue) {
      venueId = null;
    } else if (venueId) {
      const { rows: shared } = await tx.query<{ others: string }>(
        `SELECT count(*)::text AS others FROM pmp.events WHERE venue_id = $1 AND id <> $2`,
        [venueId, eventId],
      );
      if (Number(shared[0]!.others) > 0) {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO pmp.venues (name) VALUES ($1) RETURNING id`,
          [venue],
        );
        venueId = rows[0]!.id;
      } else {
        await tx.query(`UPDATE pmp.venues SET name = $2, updated_at = now() WHERE id = $1`, [venueId, venue]);
      }
    } else {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO pmp.venues (name) VALUES ($1) RETURNING id`,
        [venue],
      );
      venueId = rows[0]!.id;
    }

    await tx.query(
      `UPDATE pmp.events
          SET name = $2, venue_id = $3, timezone = $4, starts_on = $5, ends_on = $6,
              lock_version = lock_version + 1
        WHERE id = $1`,
      [
        eventId,
        input.basics.name.trim(),
        venueId,
        input.basics.timezone,
        input.basics.starts_on,
        input.basics.ends_on,
      ],
    );
  }

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
    detail: {
      rooms: input.rooms?.length ?? 0,
      tracks: input.tracks?.length ?? 0,
      ...(input.basics ? { basics: input.basics } : {}),
    },
  });

  return draftOf(tx, eventId);
}

export async function draftOf(tx: pg.PoolClient, eventId: string): Promise<Result<EventDraft, DomainError>> {
  const { rows } = await tx.query<{
    id: string;
    name: string;
    status: string;
    venue: string | null;
    timezone: string;
    starts_on: string;
    ends_on: string;
    settings: Record<string, unknown>;
    branding: Record<string, unknown> | null;
    days: string;
    sessions: string;
    rooms: string[];
    tracks: string[];
  }>(
    // `::text` on the dates deliberately: these fill `<input type="date">` boxes, and
    // a timestamp read back through the server's clock is how D-026 put every
    // imported session a day early.
    `SELECT e.id, e.name, e.status, e.timezone, e.starts_on::text, e.ends_on::text,
            e.settings, e.branding, v.name AS venue,
            (SELECT count(*)::text FROM pmp.event_days d WHERE d.event_id = e.id) AS days,
            (SELECT count(*)::text FROM pmp.sessions s WHERE s.event_id = e.id) AS sessions,
            COALESCE((SELECT array_agg(r.name ORDER BY r.name) FROM pmp.rooms r WHERE r.event_id = e.id), '{}') AS rooms,
            COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM pmp.tracks t WHERE t.event_id = e.id), '{}') AS tracks
       FROM pmp.events e
       LEFT JOIN pmp.venues v ON v.id = e.venue_id
      WHERE e.id = $1`,
    [eventId],
  );
  const row = rows[0];
  if (!row) return err({ code: "events.not_found", message: "No such event." });
  return ok({
    id: row.id,
    name: row.name,
    status: row.status,
    venue: row.venue,
    timezone: row.timezone,
    starts_on: row.starts_on,
    ends_on: row.ends_on,
    rooms: row.rooms,
    tracks: row.tracks,
    days: Number(row.days),
    sessions: Number(row.sessions),
    settings: row.settings ?? {},
    branding: row.branding ?? {},
  });
}

/** Activating turns a draft into a live event. */
export async function activateEvent(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
): Promise<Result<EventDraft, DomainError>> {
  if (!hasAnyRole(actor, CONFIGURERS)) return err(forbidden("Activating an event"));
  const draft = await draftOf(tx, eventId);
  if (!draft.ok) return draft;
  /*
   * D-027 says an event without an agenda "is not a partly-configured event, it is an
   * empty one", and SCREEN_SPECS §2 carries that as an acceptance criterion: with no
   * agenda committed, an event cannot be activated. Until now that rule lived only in
   * the browser — the forward button and the step chips — while this function, the one
   * place activation actually happens, asked only for a room and a day. `POST /events`
   * → `PATCH {rooms}` → activate produced a live event with no sessions, so no slots,
   * no talks, nothing to collect, review, sync or archive: a shell that reports 0 / 0
   * collected for ever and is indistinguishable on the portfolio from an event whose
   * speakers have simply not uploaded yet.
   *
   * Everything here comes from the same place — `commitImport` writes the rooms, the
   * days and the sessions in one transaction — so in practice this is one condition
   * stated three ways. It is listed field by field anyway, because "an event needs an
   * agenda" is not something an operator can act on, and "no sessions have been
   * imported" is.
   */
  const missing: string[] = [];
  if (draft.value.days === 0) missing.push("at least one day");
  if (draft.value.rooms.length === 0) missing.push("at least one room");
  if (draft.value.sessions === 0) missing.push("an imported agenda — it has no sessions");
  if (missing.length > 0) {
    return err({
      code: "events.incomplete",
      message: `An event needs ${missing.join(", ")} before it can be activated. Rooms, days and sessions all come from the schedule import.`,
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
 * Archiving takes an event off the portfolio without deleting anything (D-061). It
 * is a status, not a removal: files, talks, audit and communications all stay, and
 * much of that history is append-only and could not be removed anyway. Any status
 * may be archived — a draft abandoned half-way through setup is exactly the thing an
 * operator wants out of the list — and the status it had is kept so that restoring
 * puts it back where it was.
 */
export async function archiveEvent(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  reason: string,
): Promise<Result<EventDraft, DomainError>> {
  if (!hasAnyRole(actor, CONFIGURERS)) return err(forbidden("Archiving an event"));
  const { rows } = await tx.query<{ status: string; client_id: string }>(
    `SELECT status, client_id FROM pmp.events WHERE id = $1 FOR UPDATE`,
    [eventId],
  );
  const event = rows[0];
  if (!event) return err({ code: "events.not_found", message: "No such event." });
  if (event.status === "archived") {
    return err({ code: "events.archive_conflict", message: "This event is already archived." });
  }
  await tx.query(
    `UPDATE pmp.events
        SET status = 'archived', archived_from = status, archived_at = now(), archived_by = $2,
            lock_version = lock_version + 1, updated_at = now()
      WHERE id = $1`,
    [eventId, actor.id],
  );
  const why = reason.trim();
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: event.client_id,
    actorUserId: actor.id,
    action: "events.archived",
    subjectType: "event",
    subjectId: eventId,
    detail: { from: event.status },
    ...(why ? { reason: why } : {}),
  });
  return draftOf(tx, eventId);
}

/**
 * Restoring returns an archived event to the status it was archived from. An event
 * archived before that was recorded (test cleanup wrote the status directly) goes back
 * as `closed` — the one status that claims neither that setup is unfinished nor that
 * the event is running.
 */
export async function restoreEvent(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
): Promise<Result<EventDraft, DomainError>> {
  if (!hasAnyRole(actor, CONFIGURERS)) return err(forbidden("Restoring an archived event"));
  const { rows } = await tx.query<{ status: string; archived_from: string | null; client_id: string }>(
    `SELECT status, archived_from, client_id FROM pmp.events WHERE id = $1 FOR UPDATE`,
    [eventId],
  );
  const event = rows[0];
  if (!event) return err({ code: "events.not_found", message: "No such event." });
  if (event.status !== "archived") {
    return err({ code: "events.archive_conflict", message: "Only an archived event can be restored." });
  }
  const target = event.archived_from ?? "closed";
  await tx.query(
    `UPDATE pmp.events
        SET status = $2, archived_from = NULL, archived_at = NULL, archived_by = NULL,
            lock_version = lock_version + 1, updated_at = now()
      WHERE id = $1`,
    [eventId, target],
  );
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: event.client_id,
    actorUserId: actor.id,
    action: "events.restored",
    subjectType: "event",
    subjectId: eventId,
    detail: { to: target },
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
  if (!hasAnyRole(actor, CONFIGURERS)) return err(forbidden("Duplicating an event"));
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
