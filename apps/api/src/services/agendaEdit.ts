import type pg from "pg";
import { appendAudit } from "@pmp/db";
import type { Actor, DomainError, Result } from "@pmp/domain";
import { atLeast, err, hasAnyRole, ok } from "@pmp/domain";
import { normalise, resolveDay, resolveRoom, resolveTrack, syncPresenters } from "./scheduleImport.ts";

/**
 * Editing the agenda from the event details (D-064).
 *
 * Until now the agenda could only change by re-importing the whole spreadsheet. These
 * are the single-item edits a project manager makes on the day a room changes or a
 * title is corrected: a session's title, location, track, day and times; the
 * presentations in it; who presents; cancelling and reinstating; and deleting what
 * was added by mistake.
 *
 * Rooms, tracks, days and presenters are resolved by the same helpers the import
 * uses, so a location typed here and a location in the next spreadsheet are the same
 * location, not two. Times are entered as wall-clock `HH:MM` on a date and converted
 * in the *event's* timezone by Postgres — never the server's (the D-026 lesson).
 *
 * Every write needs a presentation manager or above, is audited, and is refused on an
 * archived event by the D-062 middleware before it arrives here.
 */
const EDITORS = atLeast("presentation_manager");

const forbidden = (attempt: string): DomainError => ({
  code: "agenda.forbidden",
  message: `${attempt} needs a presentation manager, project manager or administrator.`,
});

const notFound = (what: string): DomainError => ({ code: "agenda.not_found", message: `No such ${what} on this event.` });

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type SessionInput = {
  title: string;
  room: string;
  track?: string;
  /** `YYYY-MM-DD`, within the event's dates. */
  date: string;
  /** `HH:MM`, wall-clock in the event's timezone. */
  start: string;
  end: string;
};

export type PresenterInput = { name: string; email: string; organization?: string };

export type PresentationInput = {
  title: string;
  /** Optional `HH:MM` on the session's day; empty means it runs with the session (D-031). */
  start?: string;
  end?: string;
};

type EventRow = { client_id: string; timezone: string; starts_on: string; ends_on: string };

async function eventOf(tx: pg.PoolClient, eventId: string): Promise<EventRow | undefined> {
  const { rows } = await tx.query<EventRow>(
    `SELECT client_id, timezone, starts_on::text, ends_on::text FROM pmp.events WHERE id = $1`,
    [eventId],
  );
  return rows[0];
}

function checkSession(input: SessionInput, event: EventRow): DomainError | null {
  const missing: string[] = [];
  if (!input.title?.trim()) missing.push("a title");
  if (!input.room?.trim()) missing.push("a location");
  if (!DATE.test(input.date ?? "")) missing.push("a day");
  if (!CLOCK.test(input.start ?? "") || !CLOCK.test(input.end ?? "")) missing.push("a start and end time");
  if (missing.length > 0) {
    return { code: "agenda.incomplete", message: `A session needs ${missing.join(", ")}.` };
  }
  if (input.date < event.starts_on || input.date > event.ends_on) {
    return {
      code: "agenda.bad_dates",
      message: `That day is outside the event, which runs ${event.starts_on} to ${event.ends_on}.`,
    };
  }
  if (input.end <= input.start) {
    return { code: "agenda.bad_times", message: "A session has to end after it starts." };
  }
  return null;
}

function checkPresentation(input: PresentationInput): DomainError | null {
  if (!input.title?.trim()) return { code: "agenda.incomplete", message: "A presentation needs a title." };
  const start = input.start ?? "";
  const end = input.end ?? "";
  if ((start && !CLOCK.test(start)) || (end && !CLOCK.test(end))) {
    return { code: "agenda.bad_times", message: "Times are `HH:MM`." };
  }
  if (start && end && end <= start) {
    return { code: "agenda.bad_times", message: "A presentation has to end after it starts." };
  }
  return null;
}

/** Any uploaded file on these slots — the line past which deleting becomes destroying work. */
async function slotsHaveFiles(tx: pg.PoolClient, slotIds: string[]): Promise<boolean> {
  if (slotIds.length === 0) return false;
  const { rows } = await tx.query(`SELECT 1 FROM pmp.files WHERE slot_id = ANY($1::uuid[]) LIMIT 1`, [slotIds]);
  return rows.length > 0;
}

async function roomIdsOf(tx: pg.PoolClient, eventId: string): Promise<Map<string, string>> {
  const { rows } = await tx.query<{ id: string; name: string }>(`SELECT id, name FROM pmp.rooms WHERE event_id = $1`, [
    eventId,
  ]);
  return new Map(rows.map((room) => [normalise(room.name), room.id]));
}

/* ── sessions ─────────────────────────────────────────────────────────────── */

export async function createSession(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  input: SessionInput & { presentation?: PresentationInput; presenter?: PresenterInput },
): Promise<Result<{ session_id: string; slot_id: string }, DomainError>> {
  if (!hasAnyRole(actor, EDITORS)) return err(forbidden("Adding a session"));
  const event = await eventOf(tx, eventId);
  if (!event) return err(notFound("event"));
  const invalid = checkSession(input, event);
  if (invalid) return err(invalid);
  const presentation = input.presentation?.title?.trim() ? input.presentation : { title: input.title };
  const invalidTalk = checkPresentation(presentation);
  if (invalidTalk) return err(invalidTalk);

  const roomId = await resolveRoom(tx, eventId, event.client_id, await roomIdsOf(tx, eventId), input.room.trim());
  const trackId = await resolveTrack(tx, eventId, event.client_id, input.track?.trim() ?? "");
  const dayId = await resolveDay(tx, eventId, event.client_id, input.date);

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.sessions (event_id, client_id, room_id, track_id, day_id, title, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6,
             ($7::date + $8::time) AT TIME ZONE $10,
             ($7::date + $9::time) AT TIME ZONE $10)
     RETURNING id`,
    [eventId, event.client_id, roomId, trackId, dayId, input.title.trim(), input.date, input.start, input.end, event.timezone],
  );
  const sessionId = rows[0]!.id;
  const slotId = await insertSlot(tx, eventId, event, sessionId, input.date, presentation);
  if (input.presenter && (input.presenter.name.trim() || input.presenter.email.trim())) {
    await syncPresenters(tx, {
      eventId,
      clientId: event.client_id,
      slotId,
      presenters: [{ name: input.presenter.name.trim(), email: input.presenter.email.trim() }],
      organization: input.presenter.organization?.trim() ?? "",
    });
  }

  await appendAudit(tx, {
    partitionId: eventId,
    clientId: event.client_id,
    actorUserId: actor.id,
    action: "session.created",
    subjectType: "session",
    subjectId: sessionId,
    detail: { title: input.title.trim(), location: input.room.trim(), via: "event_details" },
  });
  return ok({ session_id: sessionId, slot_id: slotId });
}

export async function updateSession(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  sessionId: string,
  input: SessionInput,
): Promise<Result<{ session_id: string; rooms_rerouted: number }, DomainError>> {
  if (!hasAnyRole(actor, EDITORS)) return err(forbidden("Changing a session"));
  const event = await eventOf(tx, eventId);
  if (!event) return err(notFound("event"));
  const { rows } = await tx.query<{ room_id: string | null; title: string; room: string | null }>(
    `SELECT se.room_id, se.title, r.name AS room
       FROM pmp.sessions se LEFT JOIN pmp.rooms r ON r.id = se.room_id
      WHERE se.id = $1 AND se.event_id = $2 FOR UPDATE OF se`,
    [sessionId, eventId],
  );
  const before = rows[0];
  if (!before) return err(notFound("session"));
  const invalid = checkSession(input, event);
  if (invalid) return err(invalid);

  const roomId = await resolveRoom(tx, eventId, event.client_id, await roomIdsOf(tx, eventId), input.room.trim());
  const trackId = await resolveTrack(tx, eventId, event.client_id, input.track?.trim() ?? "");
  const dayId = await resolveDay(tx, eventId, event.client_id, input.date);

  await tx.query(
    `UPDATE pmp.sessions
        SET title = $2, room_id = $3, track_id = $4, day_id = $5,
            starts_at = ($6::date + $7::time) AT TIME ZONE $9,
            ends_at   = ($6::date + $8::time) AT TIME ZONE $9,
            lock_version = lock_version + 1, updated_at = now()
      WHERE id = $1`,
    [sessionId, input.title.trim(), roomId, trackId, dayId, input.date, input.start, input.end, event.timezone],
  );

  /*
   * A session that changes room takes its approved files with it. The copies in the
   * old room step aside (`obsolete`, WORKFLOW_STATES §4) and each approved version is
   * queued for the new room exactly as an approval queues it (services/review.ts), so
   * the room agent there receives a manifest and nothing plays in the wrong room.
   */
  let rerouted = 0;
  if (before.room_id && before.room_id !== roomId) {
    await tx.query(
      `UPDATE pmp.room_files rf
          SET sync_state = 'obsolete', lock_version = rf.lock_version + 1
         FROM pmp.file_versions fv, pmp.files f, pmp.slots s
        WHERE rf.file_version_id = fv.id AND fv.file_id = f.id AND f.slot_id = s.id
          AND s.session_id = $1 AND rf.room_id = $2 AND rf.sync_state <> 'obsolete'`,
      [sessionId, before.room_id],
    );
    const { rows: approved } = await tx.query<{ id: string }>(
      `SELECT fv.id FROM pmp.file_versions fv
         JOIN pmp.files f ON f.id = fv.file_id
         JOIN pmp.slots s ON s.id = f.slot_id
        WHERE s.session_id = $1 AND fv.review_state = 'approved'`,
      [sessionId],
    );
    for (const version of approved) {
      await tx.query(
        `INSERT INTO pmp.room_files (file_version_id, room_id, event_id, client_id, sync_state)
         VALUES ($1, $2, $3, $4, 'assigned') ON CONFLICT DO NOTHING`,
        [version.id, roomId, eventId, event.client_id],
      );
      await tx.query(`INSERT INTO pmp.outbox (topic, payload) VALUES ('sync.rebuild_manifest', $1)`, [
        JSON.stringify({ room_id: roomId, file_version_id: version.id, requires_ack: false }),
      ]);
      rerouted += 1;
    }
  }

  await appendAudit(tx, {
    partitionId: eventId,
    clientId: event.client_id,
    actorUserId: actor.id,
    action: "session.updated",
    subjectType: "session",
    subjectId: sessionId,
    detail: {
      via: "event_details",
      before: { title: before.title, location: before.room },
      after: { title: input.title.trim(), location: input.room.trim(), date: input.date, start: input.start, end: input.end },
      files_rerouted: rerouted,
    },
  });
  return ok({ session_id: sessionId, rooms_rerouted: rerouted });
}

/**
 * Cancelling keeps everything — files are retained per the archive rules — and only
 * takes the session off room lists (WORKFLOW_STATES §5). Both directions need a
 * reason, because un-cancelling is the documented override.
 */
export async function setSessionCanceled(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  sessionId: string,
  canceled: boolean,
  reason: string,
): Promise<Result<{ state: string }, DomainError>> {
  if (!hasAnyRole(actor, EDITORS)) return err(forbidden(canceled ? "Cancelling a session" : "Reinstating a session"));
  if (!reason.trim()) {
    return err({ code: "agenda.reason_required", message: "Say why — it goes on the session's record." });
  }
  const { rows } = await tx.query<{ session_state: string; client_id: string }>(
    `SELECT session_state, client_id FROM pmp.sessions WHERE id = $1 AND event_id = $2 FOR UPDATE`,
    [sessionId, eventId],
  );
  const session = rows[0];
  if (!session) return err(notFound("session"));
  if (session.session_state === "completed") {
    return err({ code: "agenda.state_conflict", message: "A completed session cannot be cancelled or reinstated." });
  }
  const from = session.session_state;
  const to = canceled ? "canceled" : "scheduled";
  if ((from === "canceled") === canceled) {
    return err({
      code: "agenda.state_conflict",
      message: canceled ? "This session is already cancelled." : "This session is not cancelled.",
    });
  }

  await tx.query(
    `UPDATE pmp.sessions SET session_state = $2, lock_version = lock_version + 1, updated_at = now() WHERE id = $1`,
    [sessionId, to],
  );
  await tx.query(
    `INSERT INTO pmp.workflow_transitions
       (event_id, client_id, subject_type, subject_id, from_state, to_state, action, actor_user_id, reason, is_override)
     VALUES ($1, $2, 'session', $3, $4, $5, $6, $7, $8, $9)`,
    [eventId, session.client_id, sessionId, from, to, canceled ? "cancel" : "reinstate", actor.id, reason.trim(), !canceled],
  );
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: session.client_id,
    actorUserId: actor.id,
    action: canceled ? "session.canceled" : "session.reinstated",
    subjectType: "session",
    subjectId: sessionId,
    detail: { from, to },
    reason: reason.trim(),
  });
  return ok({ state: to });
}

/** Deleting is for mistakes. Once anything has been uploaded, cancel instead. */
export async function deleteSession(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  sessionId: string,
): Promise<Result<{ deleted: true }, DomainError>> {
  if (!hasAnyRole(actor, EDITORS)) return err(forbidden("Deleting a session"));
  const { rows } = await tx.query<{ title: string; client_id: string }>(
    `SELECT title, client_id FROM pmp.sessions WHERE id = $1 AND event_id = $2 FOR UPDATE`,
    [sessionId, eventId],
  );
  const session = rows[0];
  if (!session) return err(notFound("session"));
  const { rows: slots } = await tx.query<{ id: string }>(`SELECT id FROM pmp.slots WHERE session_id = $1`, [sessionId]);
  if (await slotsHaveFiles(tx, slots.map((slot) => slot.id))) {
    return err({
      code: "agenda.files_conflict",
      message: "Files have been uploaded to this session, so it cannot be deleted. Cancel it instead — that keeps them.",
    });
  }
  await tx.query(`DELETE FROM pmp.speaker_assignments WHERE slot_id IN (SELECT id FROM pmp.slots WHERE session_id = $1)`, [
    sessionId,
  ]);
  await tx.query(`DELETE FROM pmp.slots WHERE session_id = $1`, [sessionId]);
  await tx.query(`DELETE FROM pmp.sessions WHERE id = $1`, [sessionId]);
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: session.client_id,
    actorUserId: actor.id,
    action: "session.deleted",
    subjectType: "session",
    subjectId: sessionId,
    detail: { title: session.title, via: "event_details" },
  });
  return ok({ deleted: true });
}

/* ── presentations ────────────────────────────────────────────────────────── */

async function insertSlot(
  tx: pg.PoolClient,
  eventId: string,
  event: EventRow,
  sessionId: string,
  day: string,
  input: PresentationInput,
): Promise<string> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.slots (session_id, event_id, client_id, title, position, starts_at, ends_at)
     VALUES ($1, $2, $3, $4,
             (SELECT COALESCE(max(position) + 1, 0) FROM pmp.slots WHERE session_id = $1),
             CASE WHEN $6 = '' THEN NULL ELSE ($5::date + NULLIF($6, '')::time) AT TIME ZONE $8 END,
             CASE WHEN $7 = '' THEN NULL ELSE ($5::date + NULLIF($7, '')::time) AT TIME ZONE $8 END)
     RETURNING id`,
    [sessionId, eventId, event.client_id, input.title.trim(), day, input.start ?? "", input.end ?? "", event.timezone],
  );
  return rows[0]!.id;
}

/** The session a slot sits in, with the calendar day its times are read against. */
async function slotOf(
  tx: pg.PoolClient,
  eventId: string,
  slotId: string,
): Promise<{ session_id: string; day: string; title: string } | undefined> {
  const { rows } = await tx.query<{ session_id: string; day: string; title: string }>(
    `SELECT s.session_id, s.title, (se.starts_at AT TIME ZONE e.timezone)::date::text AS day
       FROM pmp.slots s
       JOIN pmp.sessions se ON se.id = s.session_id
       JOIN pmp.events e    ON e.id = s.event_id
      WHERE s.id = $1 AND s.event_id = $2`,
    [slotId, eventId],
  );
  return rows[0];
}

export async function addPresentation(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  sessionId: string,
  input: PresentationInput & { presenter?: PresenterInput },
): Promise<Result<{ slot_id: string }, DomainError>> {
  if (!hasAnyRole(actor, EDITORS)) return err(forbidden("Adding a presentation"));
  const event = await eventOf(tx, eventId);
  if (!event) return err(notFound("event"));
  const { rows } = await tx.query<{ day: string }>(
    `SELECT (starts_at AT TIME ZONE $3)::date::text AS day FROM pmp.sessions WHERE id = $1 AND event_id = $2`,
    [sessionId, eventId, event.timezone],
  );
  if (!rows[0]) return err(notFound("session"));
  const invalid = checkPresentation(input);
  if (invalid) return err(invalid);

  const slotId = await insertSlot(tx, eventId, event, sessionId, rows[0].day, input);
  if (input.presenter && (input.presenter.name.trim() || input.presenter.email.trim())) {
    await syncPresenters(tx, {
      eventId,
      clientId: event.client_id,
      slotId,
      presenters: [{ name: input.presenter.name.trim(), email: input.presenter.email.trim() }],
      organization: input.presenter.organization?.trim() ?? "",
    });
  }
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: event.client_id,
    actorUserId: actor.id,
    action: "slot.created",
    subjectType: "slot",
    subjectId: slotId,
    detail: { title: input.title.trim(), session_id: sessionId, via: "event_details" },
  });
  return ok({ slot_id: slotId });
}

export async function updatePresentation(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  slotId: string,
  input: PresentationInput,
): Promise<Result<{ slot_id: string }, DomainError>> {
  if (!hasAnyRole(actor, EDITORS)) return err(forbidden("Changing a presentation"));
  const event = await eventOf(tx, eventId);
  if (!event) return err(notFound("event"));
  const slot = await slotOf(tx, eventId, slotId);
  if (!slot) return err(notFound("presentation"));
  const invalid = checkPresentation(input);
  if (invalid) return err(invalid);

  await tx.query(
    `UPDATE pmp.slots
        SET title = $2,
            starts_at = CASE WHEN $4 = '' THEN NULL ELSE ($3::date + NULLIF($4, '')::time) AT TIME ZONE $6 END,
            ends_at   = CASE WHEN $5 = '' THEN NULL ELSE ($3::date + NULLIF($5, '')::time) AT TIME ZONE $6 END,
            lock_version = lock_version + 1, updated_at = now()
      WHERE id = $1`,
    [slotId, input.title.trim(), slot.day, input.start ?? "", input.end ?? "", event.timezone],
  );
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: event.client_id,
    actorUserId: actor.id,
    action: "slot.updated",
    subjectType: "slot",
    subjectId: slotId,
    detail: { before: { title: slot.title }, after: { title: input.title.trim(), start: input.start, end: input.end } },
  });
  return ok({ slot_id: slotId });
}

export async function deletePresentation(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  slotId: string,
): Promise<Result<{ deleted: true }, DomainError>> {
  if (!hasAnyRole(actor, EDITORS)) return err(forbidden("Deleting a presentation"));
  const event = await eventOf(tx, eventId);
  if (!event) return err(notFound("event"));
  const slot = await slotOf(tx, eventId, slotId);
  if (!slot) return err(notFound("presentation"));
  if (await slotsHaveFiles(tx, [slotId])) {
    return err({
      code: "agenda.files_conflict",
      message: "Files have been uploaded to this presentation, so it cannot be deleted.",
    });
  }
  await tx.query(`DELETE FROM pmp.speaker_assignments WHERE slot_id = $1`, [slotId]);
  await tx.query(`DELETE FROM pmp.slots WHERE id = $1`, [slotId]);
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: event.client_id,
    actorUserId: actor.id,
    action: "slot.deleted",
    subjectType: "slot",
    subjectId: slotId,
    detail: { title: slot.title, session_id: slot.session_id, via: "event_details" },
  });
  return ok({ deleted: true });
}

/* ── presenters ───────────────────────────────────────────────────────────── */

/** Matched to an existing speaker by email (else name), or created — as the import does. */
export async function addPresenter(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  slotId: string,
  presenter: PresenterInput,
): Promise<Result<{ slot_id: string }, DomainError>> {
  if (!hasAnyRole(actor, EDITORS)) return err(forbidden("Adding a presenter"));
  const event = await eventOf(tx, eventId);
  if (!event) return err(notFound("event"));
  if (!(await slotOf(tx, eventId, slotId))) return err(notFound("presentation"));
  const name = presenter.name?.trim() ?? "";
  const email = presenter.email?.trim() ?? "";
  if (!name && !email) return err({ code: "agenda.incomplete", message: "A presenter needs a name or an email." });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return err({ code: "agenda.incomplete", message: "That email address does not look complete." });
  }
  const touched = await syncPresenters(tx, {
    eventId,
    clientId: event.client_id,
    slotId,
    presenters: [{ name, email }],
    organization: presenter.organization?.trim() ?? "",
  });
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: event.client_id,
    actorUserId: actor.id,
    action: "slot.presenter_added",
    subjectType: "slot",
    subjectId: slotId,
    detail: { speaker_ids: [...touched] },
  });
  return ok({ slot_id: slotId });
}

/**
 * Adds a speaker from the Speakers screen, optionally straight onto a presentation.
 *
 * Until now a speaker could only arrive with the agenda — an import row or a presenter
 * typed onto a talk. A speaker confirmed before their talk is placed had nowhere to go.
 * Matching is the import's: by email when there is one, else by name. Without a talk,
 * a match is refused rather than silently returning the existing record, so the person
 * adding learns the speaker was already here. With a talk, a match is simply assigned.
 */
export async function addSpeaker(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  input: PresenterInput & { slot_id?: string },
): Promise<Result<{ speaker_id: string; created: boolean; slot_id: string | null }, DomainError>> {
  if (!hasAnyRole(actor, EDITORS)) return err(forbidden("Adding a speaker"));
  const event = await eventOf(tx, eventId);
  if (!event) return err(notFound("event"));
  const name = input.name?.trim() ?? "";
  const email = input.email?.trim() ?? "";
  const organization = input.organization?.trim() ?? "";
  const slotId = input.slot_id?.trim() || null;
  if (!name) return err({ code: "agenda.incomplete", message: "A speaker needs a name." });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return err({ code: "agenda.incomplete", message: "That email address does not look complete." });
  }
  if (slotId && !(await slotOf(tx, eventId, slotId))) return err(notFound("presentation"));

  const { rows: found } = await tx.query<{ id: string; full_name: string }>(
    email
      ? `SELECT id, full_name FROM pmp.speakers WHERE event_id = $1 AND lower(email::text) = lower($2) AND merged_into IS NULL`
      : `SELECT id, full_name FROM pmp.speakers WHERE event_id = $1 AND lower(full_name) = lower($2) AND merged_into IS NULL`,
    [eventId, email || name],
  );
  const existing = found[0];

  if (!slotId) {
    if (existing) {
      return err({
        code: "speakers.conflict",
        message: email
          ? `${existing.full_name} already has ${email} on this event.`
          : `${existing.full_name} is already a speaker on this event.`,
      });
    }
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO pmp.speakers (client_id, event_id, email, full_name, organization)
       VALUES ($1,$2,NULLIF($3,'')::citext,$4,NULLIF($5,'')) RETURNING id`,
      [event.client_id, eventId, email, name, organization],
    );
    const speakerId = rows[0]!.id;
    await appendAudit(tx, {
      partitionId: eventId,
      clientId: event.client_id,
      actorUserId: actor.id,
      action: "speakers.created",
      subjectType: "speaker",
      subjectId: speakerId,
      detail: { via: "speakers_screen" },
    });
    return ok({ speaker_id: speakerId, created: true, slot_id: null });
  }

  if (existing) {
    const { rowCount } = await tx.query(
      `SELECT 1 FROM pmp.speaker_assignments WHERE speaker_id = $1 AND slot_id = $2`,
      [existing.id, slotId],
    );
    if (rowCount) {
      return err({ code: "speakers.conflict", message: `${existing.full_name} already presents that presentation.` });
    }
  }
  const touched = await syncPresenters(tx, {
    eventId,
    clientId: event.client_id,
    slotId,
    presenters: [{ name, email }],
    organization,
  });
  const speakerId = [...touched][0]!;
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: event.client_id,
    actorUserId: actor.id,
    action: existing ? "slot.presenter_added" : "speakers.created",
    subjectType: existing ? "slot" : "speaker",
    subjectId: existing ? slotId : speakerId,
    detail: { speaker_ids: [speakerId], slot_id: slotId, via: "speakers_screen" },
  });
  return ok({ speaker_id: speakerId, created: !existing, slot_id: slotId });
}

/** What a speaker allows the archive to share (FR-SPK-003). */
export const RELEASE_PERMISSIONS = ["undecided", "full", "pdf_only", "none"] as const;
export type ReleasePermission = (typeof RELEASE_PERMISSIONS)[number];

/**
 * Records what a speaker agreed the archive may share (D-089).
 *
 * The archive leaves out any presentation whose speaker is "undecided", and every
 * speaker starts undecided — but nothing could set it, so a speaker added after the
 * seed could never reach the client's package. Changing it is audited with the old
 * and new value: it is the speaker's consent, and the archive acts on it.
 */
export async function setReleasePermission(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  speakerId: string,
  input: { release_permission?: unknown },
): Promise<Result<{ speaker_id: string; release_permission: ReleasePermission }, DomainError>> {
  if (!hasAnyRole(actor, EDITORS)) return err(forbidden("Setting a release permission"));
  const value = input.release_permission;
  if (typeof value !== "string" || !(RELEASE_PERMISSIONS as readonly string[]).includes(value)) {
    return err({
      code: "speakers.bad_release_permission",
      message: "Release permission must be one of: undecided, full, pdf_only, none.",
    });
  }
  const { rows } = await tx.query<{ client_id: string; before: string }>(
    `UPDATE pmp.speakers sp
        SET release_permission = $3, lock_version = sp.lock_version + 1, updated_at = now()
       FROM pmp.speakers prior
      WHERE sp.id = prior.id AND sp.id = $1 AND sp.event_id = $2 AND sp.merged_into IS NULL
      RETURNING sp.client_id, prior.release_permission AS before`,
    [speakerId, eventId, value],
  );
  const row = rows[0];
  if (!row) return err(notFound("speaker"));
  if (row.before !== value) {
    await appendAudit(tx, {
      partitionId: eventId,
      clientId: row.client_id,
      actorUserId: actor.id,
      action: "speakers.release_permission_set",
      subjectType: "speaker",
      subjectId: speakerId,
      detail: { before: row.before, after: value },
    });
  }
  return ok({ speaker_id: speakerId, release_permission: value as ReleasePermission });
}

/**
 * Takes a presenter off a presentation. The speaker record stays — they may give
 * other talks, and their history is theirs — only this assignment goes.
 */
export async function removePresenter(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  slotId: string,
  speakerId: string,
): Promise<Result<{ removed: true }, DomainError>> {
  if (!hasAnyRole(actor, EDITORS)) return err(forbidden("Removing a presenter"));
  const event = await eventOf(tx, eventId);
  if (!event) return err(notFound("event"));
  const { rowCount } = await tx.query(
    `DELETE FROM pmp.speaker_assignments WHERE slot_id = $1 AND speaker_id = $2 AND event_id = $3`,
    [slotId, speakerId, eventId],
  );
  if (!rowCount) return err(notFound("presenter on that presentation"));
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: event.client_id,
    actorUserId: actor.id,
    action: "slot.presenter_removed",
    subjectType: "slot",
    subjectId: slotId,
    detail: { speaker_id: speakerId },
  });
  return ok({ removed: true });
}
