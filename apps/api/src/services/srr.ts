import type pg from "pg";
import { appendAudit } from "@pmp/db";
import { deriveTalkStatus, TALK_STATUS_LABEL } from "@pmp/domain";
import type { Actor, DomainError, Result } from "@pmp/domain";
import { atLeast, err, hasAnyRole, ok } from "@pmp/domain";
import { formatBytes, formatBytesDelta, formatSessionTime, VERSION_STATE, wordsFor } from "@pmp/format";
import { ingestVersion, versionFacts } from "./ingest.ts";
import type { VersionFacts } from "./ingest.ts";
import { approvedRoomCopiesSql } from "./queries.ts";
import { lookFor } from "./emailLook.ts";

/* ── screen 11: Speaker Ready Room dashboard ─────────────────────────────── */

export type ExpectedArrival = {
  speaker_id: string;
  speaker: string;
  slot_id: string;
  title: string;
  room: string | null;
  starts_at: string;
  status: string;
  status_label: string;
  checkin_id: string | null;
  signed_off: boolean;
  /*
   * For the approval → sign-off → room strip on each row (D-113): the approved version and
   * its room copies' states, the last version signed off, and whether the speaker has
   * already checked in and out (R32).
   */
  approved_version: number | null;
  approved_room_states: string[];
  signed_off_version: number | null;
  checked_out: boolean;
};

/** An open warning, with where and when the talk is (R31, D-113). */
export type SrrWarning = {
  slot_id: string;
  speaker: string | null;
  check_code: string;
  severity: string;
  title: string;
  room: string | null;
  starts_at: string;
  file_version_id: string;
};

export async function srrDashboard(
  tx: pg.PoolClient,
  eventId: string,
): Promise<{
  expected: ExpectedArrival[];
  warnings: SrrWarning[];
  stations: SrrStation[];
  open: boolean;
  technicians: SrrTechnician[];
}> {
  const { rows } = await tx.query<{
    speaker_id: string;
    speaker: string;
    slot_id: string;
    title: string;
    room: string | null;
    starts_at: string;
    session_state: string;
    versions: { processing: string; inspection: string; review: string }[] | null;
    room_copies: { state: string; requiresAck: boolean; acknowledged: boolean }[] | null;
    checkin_id: string | null;
    signed_off: boolean;
    approved_version: number | null;
    approved_room_states: string[] | null;
    signed_off_version: number | null;
    checked_out: boolean;
  }>(
    `SELECT sp.id AS speaker_id, sp.full_name AS speaker, s.id AS slot_id, s.title,
            r.name AS room, se.starts_at, se.session_state,
            (SELECT json_agg(json_build_object('processing', fv.processing_state,
                                               'inspection', fv.inspection_state,
                                               'review', fv.review_state) ORDER BY fv.version_number)
               FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
              WHERE f.slot_id = s.id) AS versions,
            ${approvedRoomCopiesSql("s.id")} AS room_copies,
            (SELECT c.id FROM pmp.srr_checkins c
              WHERE c.speaker_id = sp.id AND c.departed_at IS NULL
              ORDER BY c.checked_in_at DESC LIMIT 1) AS checkin_id,
            EXISTS (SELECT 1 FROM pmp.sign_offs so WHERE so.speaker_id = sp.id) AS signed_off,
            (SELECT max(fv3.version_number) FROM pmp.file_versions fv3 JOIN pmp.files f3 ON f3.id = fv3.file_id
              WHERE f3.slot_id = s.id AND fv3.review_state = 'approved') AS approved_version,
            (SELECT array_agg(DISTINCT rf4.sync_state) FROM pmp.room_files rf4
               JOIN pmp.file_versions fv4 ON fv4.id = rf4.file_version_id
               JOIN pmp.files f4 ON f4.id = fv4.file_id
              WHERE f4.slot_id = s.id AND fv4.review_state = 'approved') AS approved_room_states,
            (SELECT fv5.version_number FROM pmp.sign_offs so5
               JOIN pmp.file_versions fv5 ON fv5.id = so5.file_version_id
              WHERE so5.speaker_id = sp.id ORDER BY so5.signed_at DESC LIMIT 1) AS signed_off_version,
            (EXISTS (SELECT 1 FROM pmp.srr_checkins c6 WHERE c6.speaker_id = sp.id AND c6.departed_at IS NOT NULL)
             AND NOT EXISTS (SELECT 1 FROM pmp.srr_checkins c7 WHERE c7.speaker_id = sp.id AND c7.departed_at IS NULL))
              AS checked_out
       FROM pmp.speakers sp
       JOIN pmp.speaker_assignments sa ON sa.speaker_id = sp.id
       JOIN pmp.slots s ON s.id = sa.slot_id
       JOIN pmp.sessions se ON se.id = s.session_id
       LEFT JOIN pmp.rooms r ON r.id = se.room_id
      WHERE sp.event_id = $1 AND sp.merged_into IS NULL AND sp.removed_at IS NULL
      ORDER BY se.starts_at`,
    [eventId],
  );

  const expected = rows.map((row) => {
    const status = deriveTalkStatus({
      sessionState: row.session_state as never,
      eventArchived: false,
      versions: (row.versions ?? []) as never,
      roomCopies: (row.room_copies ?? []) as never,
    });
    return {
      speaker_id: row.speaker_id,
      speaker: row.speaker,
      slot_id: row.slot_id,
      title: row.title,
      room: row.room,
      starts_at: row.starts_at,
      status,
      status_label: TALK_STATUS_LABEL[status],
      checkin_id: row.checkin_id,
      signed_off: row.signed_off,
      approved_version: row.approved_version,
      approved_room_states: row.approved_room_states ?? [],
      signed_off_version: row.signed_off_version,
      checked_out: row.checked_out,
    };
  });

  const { rows: warnings } = await tx.query<SrrWarning>(
    `SELECT s.id AS slot_id, inf.check_code, inf.severity, s.title, r.name AS room, se.starts_at,
            fv.id AS file_version_id,
            (SELECT sp.full_name FROM pmp.speaker_assignments sa
               JOIN pmp.speakers sp ON sp.id = sa.speaker_id WHERE sa.slot_id = s.id LIMIT 1) AS speaker
       FROM pmp.inspection_findings inf
       JOIN pmp.file_versions fv ON fv.id = inf.file_version_id
       JOIN pmp.files f ON f.id = fv.file_id
       JOIN pmp.slots s ON s.id = f.slot_id
       JOIN pmp.sessions se ON se.id = s.session_id
       LEFT JOIN pmp.rooms r ON r.id = se.room_id
      WHERE inf.event_id = $1 AND inf.waived_at IS NULL
        AND inf.severity IN ('warning', 'blocking')
        AND fv.review_state IN ('awaiting_review', 'in_review')
      ORDER BY inf.severity DESC, se.starts_at`,
    [eventId],
  );

  return {
    expected,
    warnings,
    stations: await eventStations(tx, eventId),
    open: await srrIsOpen(tx, eventId),
    technicians: await eventTechnicianChoices(tx, eventId),
  };
}

/* ── Speaker Ready Room stations (D-080) ─────────────────────────────────── */

export type SrrStation = {
  id: string;
  /** The station's name; kept as `station` too, the field the screen has always read. */
  station: string;
  name: string;
  technician: string | null;
  speaker: string | null;
  /** The visit at this desk, so the desk opens it whoever the speaker is (D-153 follow-up). */
  checkin_id: string | null;
  busy: boolean;
  lock_version: number;
};

/**
 * The event's stations, each with whoever is checked in at it right now. Busy is read
 * by station id, so renaming a desk does not strand the speaker sitting at it.
 */
export async function eventStations(tx: pg.PoolClient, eventId: string): Promise<SrrStation[]> {
  const { rows } = await tx.query<SrrStation>(
    `SELECT st.id, st.name AS station, st.name, st.lock_version,
            open.technician, open.speaker, open.id AS checkin_id, open.id IS NOT NULL AS busy
       FROM pmp.srr_stations st
       LEFT JOIN LATERAL (
         SELECT c.id, u.display_name AS technician, sp.full_name AS speaker
           FROM pmp.srr_checkins c
           JOIN pmp.users u ON u.id = c.technician_id
           JOIN pmp.speakers sp ON sp.id = c.speaker_id
          WHERE c.event_id = $1 AND c.station_id = st.id AND c.departed_at IS NULL
          ORDER BY c.checked_in_at DESC LIMIT 1
       ) open ON true
      WHERE st.event_id = $1 AND st.retired_at IS NULL
      ORDER BY st.position, st.created_at`,
    [eventId],
  );
  return rows;
}

// Running the room is the SRR technician's job, so they may set up its desks.
const STATION_EDITORS = atLeast("srr_technician");

const cleanName = (name: unknown): string | null => {
  if (typeof name !== "string") return null;
  const trimmed = name.replace(/\s+/g, " ").trim();
  return trimmed.length >= 1 && trimmed.length <= 60 ? trimmed : null;
};

async function nameTaken(tx: pg.PoolClient, eventId: string, name: string, except?: string): Promise<boolean> {
  const { rows } = await tx.query(
    `SELECT 1 FROM pmp.srr_stations
      WHERE event_id = $1 AND retired_at IS NULL AND lower(btrim(name)) = lower($2)
        AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [eventId, name, except ?? null],
  );
  return rows.length > 0;
}

export async function addStation(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  rawName: unknown,
): Promise<Result<SrrStation, DomainError>> {
  if (!hasAnyRole(actor, STATION_EDITORS)) {
    return err({ code: "srr.forbidden", message: "Only the Speaker Ready Room team and managers can set up stations." });
  }
  const name = cleanName(rawName);
  if (!name) return err({ code: "srr.station_name_invalid", message: "Give the station a name of 1–60 characters." });
  if (await nameTaken(tx, eventId, name)) {
    return err({ code: "srr.station_conflict", message: `There is already a station called "${name}".` });
  }
  const { rows } = await tx.query<{ id: string; client_id: string }>(
    `INSERT INTO pmp.srr_stations (event_id, client_id, name, position, created_by)
     SELECT e.id, e.client_id, $2,
            COALESCE((SELECT max(position) FROM pmp.srr_stations WHERE event_id = e.id), 0) + 1, $3
       FROM pmp.events e WHERE e.id = $1
     RETURNING id, client_id`,
    [eventId, name, actor.id],
  );
  const created = rows[0];
  if (!created) return err({ code: "events.not_found", message: "This event no longer exists — it may have been removed. Refresh the page." });
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: created.client_id,
    actorUserId: actor.id,
    action: "srr.station_added",
    subjectType: "srr_station",
    subjectId: created.id,
    detail: { name },
  });
  const station = (await eventStations(tx, eventId)).find((row) => row.id === created.id)!;
  return ok(station);
}

async function stationRow(tx: pg.PoolClient, eventId: string, stationId: string) {
  const { rows } = await tx.query<{ id: string; client_id: string; name: string; lock_version: number; busy: boolean }>(
    `SELECT st.id, st.client_id, st.name, st.lock_version,
            EXISTS (SELECT 1 FROM pmp.srr_checkins c WHERE c.station_id = st.id AND c.departed_at IS NULL) AS busy
       FROM pmp.srr_stations st
      WHERE st.id = $1 AND st.event_id = $2 AND st.retired_at IS NULL`,
    [stationId, eventId],
  );
  return rows[0];
}

export async function renameStation(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  stationId: string,
  rawName: unknown,
): Promise<Result<SrrStation, DomainError>> {
  if (!hasAnyRole(actor, STATION_EDITORS)) {
    return err({ code: "srr.forbidden", message: "Only the Speaker Ready Room team and managers can set up stations." });
  }
  const name = cleanName(rawName);
  if (!name) return err({ code: "srr.station_name_invalid", message: "Give the station a name of 1–60 characters." });
  const current = await stationRow(tx, eventId, stationId);
  if (!current) return err({ code: "srr.station_not_found", message: "This station no longer exists at this event — it may have been removed. Refresh the page." });
  if (await nameTaken(tx, eventId, name, stationId)) {
    return err({ code: "srr.station_conflict", message: `There is already a station called "${name}".` });
  }
  await tx.query(
    `UPDATE pmp.srr_stations SET name = $2, lock_version = lock_version + 1 WHERE id = $1`,
    [stationId, name],
  );
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: current.client_id,
    actorUserId: actor.id,
    action: "srr.station_renamed",
    subjectType: "srr_station",
    subjectId: stationId,
    detail: { from: current.name, to: name },
  });
  return ok((await eventStations(tx, eventId)).find((row) => row.id === stationId)!);
}

/** Retired, not deleted: past check-ins still name the desk they happened at. */
export async function retireStation(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  stationId: string,
): Promise<Result<{ retired: true }, DomainError>> {
  if (!hasAnyRole(actor, STATION_EDITORS)) {
    return err({ code: "srr.forbidden", message: "Only the Speaker Ready Room team and managers can set up stations." });
  }
  const current = await stationRow(tx, eventId, stationId);
  if (!current) return err({ code: "srr.station_not_found", message: "This station no longer exists at this event — it may have been removed. Refresh the page." });
  if (current.busy) {
    return err({
      code: "srr.station_conflict",
      message: `A speaker is checked in at ${current.name}. Finish that check-in before removing the station.`,
    });
  }
  await tx.query(`UPDATE pmp.srr_stations SET retired_at = now(), lock_version = lock_version + 1 WHERE id = $1`, [
    stationId,
  ]);
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: current.client_id,
    actorUserId: actor.id,
    action: "srr.station_retired",
    subjectType: "srr_station",
    subjectId: stationId,
    detail: { name: current.name },
  });
  return ok({ retired: true });
}

/* ── the event-day switch (client review, D-157) ─────────────────────────── */

const SRR_CLOSED: DomainError = {
  code: "srr.closed_conflict",
  message: "The Speaker Ready Room is closed. A DXG Admin or support staff opens it on the event day.",
};

export async function srrIsOpen(tx: pg.PoolClient, eventId: string): Promise<boolean> {
  const { rows } = await tx.query<{ srr_open: boolean }>(`SELECT srr_open FROM pmp.events WHERE id = $1`, [eventId]);
  return rows[0]?.srr_open ?? false;
}

/**
 * Opens or closes the Speaker Ready Room for the event: DXG Admins and support staff, whose
 * placement makes them presentation and project managers (D-151). Technicians work the room;
 * they don't open it.
 */
export async function setSrrOpen(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  open: boolean,
): Promise<Result<{ srr_open: boolean }, DomainError>> {
  if (!hasAnyRole(actor, atLeast("presentation_manager"))) {
    return err({ code: "auth.forbidden", message: "Only a DXG Admin or support staff can open or close the Speaker Ready Room." });
  }
  const { rows } = await tx.query<{ client_id: string; was: boolean }>(
    `UPDATE pmp.events e SET srr_open = $2 FROM (SELECT srr_open AS was FROM pmp.events WHERE id = $1) old
      WHERE e.id = $1 RETURNING e.client_id, old.was`,
    [eventId, open],
  );
  if (!rows[0]) return err({ code: "events.not_found", message: "This event no longer exists." });
  if (rows[0].was !== open) {
    await appendAudit(tx, {
      partitionId: eventId,
      clientId: rows[0].client_id,
      actorUserId: actor.id,
      action: open ? "srr.opened" : "srr.closed",
      subjectType: "event",
      subjectId: eventId,
      detail: {},
    });
  }
  return ok({ srr_open: open });
}

/* ── screen 12: check-in ─────────────────────────────────────────────────── */

export async function checkIn(
  tx: pg.PoolClient,
  actor: Actor,
  input: { eventId: string; speakerId: string; stationId: string | undefined; technicianId: string | undefined },
): Promise<Result<{ checkin_id: string }, DomainError>> {
  // Closed until the event day (D-157): no one checks in.
  if (!(await srrIsOpen(tx, input.eventId))) return err(SRR_CLOSED);

  const { rows: existing } = await tx.query<{ id: string }>(
    `SELECT id FROM pmp.srr_checkins WHERE speaker_id = $1 AND departed_at IS NULL`,
    [input.speakerId],
  );
  if (existing[0]) return ok({ checkin_id: existing[0].id });

  const { rows: speaker } = await tx.query<{ client_id: string }>(
    `SELECT client_id FROM pmp.speakers WHERE id = $1 AND event_id = $2`,
    [input.speakerId, input.eventId],
  );
  if (!speaker[0]) return err({ code: "srr.speaker_not_found", message: "This speaker no longer exists at this event — it may have been removed. Refresh the page." });

  // A check-in happens at a real desk of this event (D-080) — it used to be recorded at
  // "Station 2" whatever the speaker sat at.
  if (!input.stationId) {
    return err({ code: "srr.station_required", message: "Choose the station the speaker is at." });
  }
  const station = await stationRow(tx, input.eventId, input.stationId);
  if (!station) {
    return err({
      code: "srr.station_not_found",
      message: "That station is not set up for this event. Add it under Stations first.",
    });
  }
  // And the technician who helps them there (D-169) — no longer whoever pressed Check in.
  const technician = await technicianChoice(tx, input.eventId, input.technicianId);
  if (!technician.ok) return err(technician.error);

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.srr_checkins (event_id, client_id, speaker_id, technician_id, station, station_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [input.eventId, speaker[0].client_id, input.speakerId, technician.value.id, station.name, station.id],
  );

  await appendAudit(tx, {
    partitionId: input.eventId,
    clientId: speaker[0].client_id,
    actorUserId: actor.id,
    action: "srr.checked_in",
    subjectType: "srr_checkin",
    subjectId: rows[0]!.id,
    detail: { speaker_id: input.speakerId, station: station.name, station_id: station.id, technician_id: technician.value.id },
  });

  return ok({ checkin_id: rows[0]!.id });
}

export type CheckinDetail = {
  checkin: {
    id: string;
    station: string | null;
    checked_in_at: string;
    technician: string;
    technician_id: string;
    departed_at: string | null;
  };
  /** Who may take this speaker over (D-169): the event's technicians. */
  technicians: SrrTechnician[];
  speaker: { id: string; name: string };
  /**
   * The talk the speaker gives. `slot_id` is null when they are no longer on one — removed
   * from the event or taken off their session while at a desk — so the visit can still be
   * opened and checked out.
   */
  talk: { slot_id: string | null; title: string; room: string | null; starts_at: string; final_locked: boolean; status: string; status_label: string };
  /** Who approved it and where its room copies are, for the confirmation strip (D-113). */
  approved: (VersionFacts & { approved_by?: string | null; approved_at?: string | null; room_states?: string[] }) | null;
  latest: (VersionFacts & { file_version_id: string; review_state: string; processing_state: string }) | null;
  usb: { id: string; scan_result: string; file_version_id: string | null; created_at: string } | null;
  receipt: {
    version_number: number;
    sha256: string;
    signed_at: string;
    station: string | null;
    technician: string;
    /** Read with the receipt, so staff see "v2 · deck.pptx · 24 slides", not a fingerprint (R34, D-112). */
    file_name?: string | null;
    slides?: number | null;
  } | null;
  /**
   * The talk's latest sign-off from any visit (D-119). A speaker checked in again has no
   * receipt on this visit yet, but their earlier sign-off still stands — the strip showed
   * "Not yet" beside "Final onsite version locked".
   */
  standing_sign_off: { version_number: number; signed_at: string; technician: string | null; station: string | null } | null;
};

export async function checkinDetail(tx: pg.PoolClient, checkinId: string): Promise<CheckinDetail | null> {
  const { rows } = await tx.query<{
    id: string;
    station: string | null;
    checked_in_at: string;
    departed_at: string | null;
    technician: string;
    technician_id: string;
    event_id: string;
    speaker_id: string;
    speaker_name: string;
    slot_id: string | null;
    title: string | null;
    room: string | null;
    starts_at: string | null;
    final_locked: boolean | null;
    session_state: string | null;
    versions: { processing: string; inspection: string; review: string }[] | null;
    room_copies: { state: string; requiresAck: boolean; acknowledged: boolean }[] | null;
  }>(
    `SELECT c.id, c.station, c.checked_in_at, c.departed_at, u.display_name AS technician,
            c.technician_id, c.event_id,
            sp.id AS speaker_id, sp.full_name AS speaker_name,
            talk.slot_id, talk.title, talk.room, talk.starts_at, talk.final_locked, talk.session_state,
            (SELECT json_agg(json_build_object('processing', fv.processing_state,
                                               'inspection', fv.inspection_state,
                                               'review', fv.review_state) ORDER BY fv.version_number)
               FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
              WHERE f.slot_id = talk.slot_id) AS versions,
            ${approvedRoomCopiesSql("talk.slot_id")} AS room_copies
       FROM pmp.srr_checkins c
       JOIN pmp.users u ON u.id = c.technician_id
       JOIN pmp.speakers sp ON sp.id = c.speaker_id
       -- A left join: a speaker taken off their session (or the event) while at a desk still
       -- has a visit to open and close. With more than one talk, the next one comes first.
       -- Looked up per visit (LATERAL): as a chain of left joins, row-level security kept the
       -- planner from narrowing to this speaker first, and it walked every speaker × talk ×
       -- session pair — 18 s on the seed event (D-169).
       LEFT JOIN LATERAL (
         SELECT s.id AS slot_id, s.title, r.name AS room, se.starts_at, s.final_locked, se.session_state
           FROM pmp.speaker_assignments sa
           JOIN pmp.slots s ON s.id = sa.slot_id
           LEFT JOIN pmp.sessions se ON se.id = s.session_id
           LEFT JOIN pmp.rooms r ON r.id = se.room_id
          WHERE sa.speaker_id = c.speaker_id
          -- Their next talk that hasn't ended (else their last): a file taken in today belongs to
          -- today's talk, not to one they gave yesterday.
          ORDER BY (se.starts_at IS NULL), (se.ends_at < now()), CASE WHEN se.ends_at < now() THEN se.starts_at END DESC, se.starts_at
          LIMIT 1
       ) talk ON true
      WHERE c.id = $1`,
    [checkinId],
  );
  const row = rows[0];
  if (!row) return null;

  const status = row.slot_id
    ? deriveTalkStatus({
        sessionState: row.session_state as never,
        eventArchived: false,
        versions: (row.versions ?? []) as never,
        roomCopies: (row.room_copies ?? []) as never,
      })
    : "canceled";

  const { rows: approvedRows } = await tx.query<{
    id: string;
    approved_at: string | null;
    approved_by: string | null;
    room_states: string[] | null;
  }>(
    `SELECT fv.id, fv.approved_at, u.display_name AS approved_by,
            (SELECT array_agg(DISTINCT rf.sync_state) FROM pmp.room_files rf WHERE rf.file_version_id = fv.id) AS room_states
       FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
       LEFT JOIN pmp.users u ON u.id = fv.approved_by
      WHERE f.slot_id = $1 AND fv.review_state = 'approved'
      ORDER BY fv.version_number DESC LIMIT 1`,
    [row.slot_id],
  );
  const { rows: latestRows } = await tx.query<{ id: string; review_state: string; processing_state: string }>(
    `SELECT fv.id, fv.review_state, fv.processing_state
       FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
      WHERE f.slot_id = $1 ORDER BY fv.version_number DESC LIMIT 1`,
    [row.slot_id],
  );

  const approvedFacts = approvedRows[0] ? await versionFacts(tx, approvedRows[0].id) : null;
  const approved = approvedFacts
    ? {
        ...approvedFacts,
        approved_by: approvedRows[0]!.approved_by,
        approved_at: approvedRows[0]!.approved_at,
        room_states: approvedRows[0]!.room_states ?? [],
      }
    : null;
  const latestFacts = latestRows[0] ? await versionFacts(tx, latestRows[0].id) : null;

  const { rows: usbRows } = await tx.query<{
    id: string;
    scan_result: string;
    file_version_id: string | null;
    created_at: string;
  }>(
    `SELECT id, scan_result, file_version_id, created_at FROM pmp.usb_ingestions
      WHERE checkin_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [checkinId],
  );

  const { rows: receiptRows } = await tx.query<{
    content: Record<string, unknown>;
    file_version_id: string;
    file_name: string | null;
  }>(
    `SELECT rc.content, so.file_version_id, fv.original_filename AS file_name FROM pmp.receipts rc
       JOIN pmp.sign_offs so ON so.id = rc.sign_off_id
       JOIN pmp.file_versions fv ON fv.id = so.file_version_id
      WHERE so.checkin_id = $1 ORDER BY rc.created_at DESC LIMIT 1`,
    [checkinId],
  );
  const receiptRow = receiptRows[0];
  const receipt: CheckinDetail["receipt"] = receiptRow
    ? {
        ...(receiptRow.content as NonNullable<CheckinDetail["receipt"]>),
        file_name: receiptRow.file_name,
        slides: (await versionFacts(tx, receiptRow.file_version_id))?.slides ?? null,
      }
    : null;

  const { rows: standing } = await tx.query<NonNullable<CheckinDetail["standing_sign_off"]>>(
    `SELECT fv.version_number, so.signed_at, u.display_name AS technician, c.station
       FROM pmp.sign_offs so
       JOIN pmp.file_versions fv ON fv.id = so.file_version_id
       JOIN pmp.files f ON f.id = fv.file_id
       JOIN pmp.srr_checkins c ON c.id = so.checkin_id
       LEFT JOIN pmp.users u ON u.id = c.technician_id
      WHERE f.slot_id = $1
      ORDER BY so.signed_at DESC LIMIT 1`,
    [row.slot_id],
  );

  return {
    checkin: {
      id: row.id,
      station: row.station,
      checked_in_at: row.checked_in_at,
      departed_at: row.departed_at,
      technician: row.technician,
      technician_id: row.technician_id,
    },
    technicians: await eventTechnicianChoices(tx, row.event_id),
    speaker: { id: row.speaker_id, name: row.speaker_name },
    talk: {
      slot_id: row.slot_id,
      title: row.title ?? "No talk — no longer on a session at this event",
      room: row.room,
      starts_at: row.starts_at ?? row.checked_in_at,
      final_locked: row.final_locked ?? false,
      status,
      status_label: row.slot_id ? TALK_STATUS_LABEL[status] : "No talk",
    },
    approved,
    latest:
      latestFacts && latestRows[0]
        ? {
            ...latestFacts,
            file_version_id: latestRows[0].id,
            review_state: latestRows[0].review_state,
            processing_state: latestRows[0].processing_state,
          }
        : null,
    usb: usbRows[0] ?? null,
    receipt,
    standing_sign_off: standing[0] ?? null,
  };
}

/* ── screen 13: local intake (was "USB intake") ─────────────────────────── */

/*
 * "Local intake" (client review, D-153): the file comes from a USB drive or from a copy
 * saved on the desk's computer — the browser cannot tell the two apart, and the rules are
 * the same for both. The stored names (`srr_usb`, `usb_ingestions`, `/usb-ingestions`)
 * keep their first spelling; only what people read changed.
 */
export type UsbResult = {
  ingestion_id: string | null;
  scan_result: string;
  file_version_id: string | null;
  version_number: number | null;
  inspection_state: string | null;
  /** What the incoming file is being compared against, and why. */
  compared_with: { version_number: number; basis: "approved" | "previous" } | null;
  comparison: { field: string; approved: string; incoming: string; delta: string }[];
  message: string;
};

/** The talk's approved and newest versions, read before a new one comes in. */
async function baselineOf(tx: pg.PoolClient, slotId: string): Promise<{ approved: VersionFacts | null; latest: VersionFacts | null }> {
  const { rows } = await tx.query<{ approved_id: string | null; latest_id: string | null }>(
    `SELECT (SELECT fv.id FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
              WHERE f.slot_id = $1 AND fv.review_state = 'approved'
              ORDER BY fv.version_number DESC LIMIT 1) AS approved_id,
            (SELECT fv.id FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
              WHERE f.slot_id = $1 ORDER BY fv.version_number DESC LIMIT 1) AS latest_id`,
    [slotId],
  );
  return {
    approved: rows[0]?.approved_id ? await versionFacts(tx, rows[0].approved_id) : null,
    latest: rows[0]?.latest_id ? await versionFacts(tx, rows[0].latest_id) : null,
  };
}

/**
 * FR-SRR-002: a local file is scanned before anything else, and a failed scan
 * quarantines it while the approved version stays active (I-1, I-2). Acceptance
 * sends the new version to re-approval — it never becomes the room copy here.
 * Shared by intake on a check-in and intake straight from the Speaker Ready Room.
 */
async function takeLocalFile(
  tx: pg.PoolClient,
  actor: Actor,
  input: {
    eventId: string;
    clientId: string;
    slotId: string;
    checkinId: string | null;
    uploadId: string;
    fileName: string;
    reason: string;
  },
): Promise<Result<UsbResult, DomainError>> {
  const baseline = await baselineOf(tx, input.slotId);

  const ingested = await ingestVersion(tx, {
    eventId: input.eventId,
    clientId: input.clientId,
    slotId: input.slotId,
    fileName: input.fileName,
    uploadId: input.uploadId,
    source: input.checkinId ? "srr_usb" : "srr_manual",
    actorUserId: actor.id,
  });
  if (!ingested.ok) return err({ code: ingested.error.code, message: ingested.error.message });

  let ingestionId: string | null = null;
  if (input.checkinId) {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO pmp.usb_ingestions (checkin_id, event_id, client_id, file_version_id, scan_result, scan_detail)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        input.checkinId,
        input.eventId,
        input.clientId,
        ingested.value.file_version_id,
        ingested.value.scan_verdict,
        JSON.stringify({ reason: input.reason, filename: input.fileName }),
      ],
    );
    ingestionId = rows[0]!.id;
  }

  await appendAudit(tx, {
    partitionId: input.eventId,
    clientId: input.clientId,
    actorUserId: actor.id,
    action: input.checkinId ? "srr.usb_ingested" : "srr.local_intake",
    subjectType: input.checkinId ? "usb_ingestion" : "file_version",
    subjectId: ingestionId ?? ingested.value.file_version_id,
    detail: {
      verdict: ingested.value.scan_verdict,
      version: ingested.value.version_number,
      slot_id: input.slotId,
      filename: input.fileName,
    },
    reason: input.reason,
  });

  if (ingested.value.scan_verdict !== "clean") {
    return ok({
      ingestion_id: ingestionId,
      scan_result: ingested.value.scan_verdict,
      file_version_id: ingested.value.file_version_id,
      version_number: ingested.value.version_number,
      inspection_state: null,
      compared_with: null,
      comparison: [],
      // Only claim an approved copy is playing when there is one (D-108).
      message: baseline.approved
        ? `This file failed the virus check and was not stored. v${baseline.approved.version_number} (approved) is unchanged and stays in use. Ask the speaker for another copy — re-saved, or from a different USB drive — and check it again.`
        : "This file failed the virus check and was not stored. Ask the speaker for another copy — re-saved, or from a different USB drive — and check it again.",
    });
  }

  const incoming = await versionFacts(tx, ingested.value.file_version_id);

  // Compare against the approved version when there is one; otherwise against
  // whatever the speaker last submitted, so the technician always sees what
  // changed rather than an empty panel.
  const against = baseline.approved ?? baseline.latest;
  const comparedWith = against
    ? {
        version_number: against.version_number,
        basis: (baseline.approved ? "approved" : "previous") as "approved" | "previous",
      }
    : null;

  return ok({
    ingestion_id: ingestionId,
    scan_result: "clean",
    file_version_id: ingested.value.file_version_id,
    version_number: ingested.value.version_number,
    inspection_state: ingested.value.inspection_state,
    compared_with: comparedWith,
    comparison: compare(against, incoming),
    message: `Virus check passed. Saved as version ${ingested.value.version_number} and sent for review. The room keeps the approved version until this one is approved and loaded onto the room PC.`,
  });
}

const REASON_REQUIRED: DomainError = {
  code: "srr.reason_required",
  message: "Taking in a new version needs a reason — nothing was recorded.",
};

/** Local intake on a speaker's check-in (screen 13). */
export async function usbIngest(
  tx: pg.PoolClient,
  actor: Actor,
  input: { checkinId: string; uploadId: string; fileName: string; reason: string },
): Promise<Result<UsbResult, DomainError>> {
  if (!input.reason.trim()) return err(REASON_REQUIRED);

  const detail = await checkinDetail(tx, input.checkinId);
  if (!detail) return err({ code: "srr.checkin_not_found", message: "This check-in no longer exists — it may have been removed. Refresh the page." });
  if (!detail.talk.slot_id) {
    return err({ code: "srr.no_talk_conflict", message: "This speaker is no longer on a session, so there is no talk to take a file in for. Check them out." });
  }
  const slotId = detail.talk.slot_id;

  const { rows: scope } = await tx.query<{ event_id: string; client_id: string }>(
    `SELECT event_id, client_id FROM pmp.srr_checkins WHERE id = $1`,
    [input.checkinId],
  );
  if (!(await srrIsOpen(tx, scope[0]!.event_id))) return err(SRR_CLOSED);
  return takeLocalFile(tx, actor, {
    eventId: scope[0]!.event_id,
    clientId: scope[0]!.client_id,
    slotId,
    checkinId: input.checkinId,
    uploadId: input.uploadId,
    fileName: input.fileName,
    reason: input.reason,
  });
}

/**
 * Local intake straight from the Speaker Ready Room, without a check-in (client review,
 * D-153): DXG staff upload or update a speaker's presentation the way the speaker can from
 * their own Speaker Ready Room view. Same scan → store → re-approval path; the version's
 * source is `srr_manual`.
 */
export async function slotIntake(
  tx: pg.PoolClient,
  actor: Actor,
  input: { eventId: string; slotId: string; uploadId: string; fileName: string; reason: string },
): Promise<Result<UsbResult, DomainError>> {
  // Who may: whoever may open the Speaker Ready Room — the account's level and its place on
  // the event (D-151), checked before this runs; the same as intake on a check-in.
  if (!input.reason.trim()) return err(REASON_REQUIRED);

  const { rows } = await tx.query<{ client_id: string }>(
    `SELECT client_id FROM pmp.slots WHERE id = $1 AND event_id = $2`,
    [input.slotId, input.eventId],
  );
  if (!rows[0]) {
    return err({ code: "srr.slot_not_found", message: "This talk no longer exists at this event — it may have been removed. Refresh the page." });
  }
  return takeLocalFile(tx, actor, {
    eventId: input.eventId,
    clientId: rows[0].client_id,
    slotId: input.slotId,
    checkinId: null,
    uploadId: input.uploadId,
    fileName: input.fileName,
    reason: input.reason,
  });
}

function compare(approved: VersionFacts | null, incoming: VersionFacts | null) {
  if (!approved || !incoming) return [];
  const delta = (a: number | null, b: number | null) =>
    a === null || b === null ? "—" : b === a ? "unchanged" : `${b > a ? "+" : ""}${b - a}`;
  return [
    {
      field: "Slides",
      approved: String(approved.slides ?? "—"),
      incoming: String(incoming.slides ?? "—"),
      delta: delta(approved.slides, incoming.slides),
    },
    {
      field: "Embedded media",
      approved: String(approved.embedded_media ?? 0),
      incoming: String(incoming.embedded_media ?? 0),
      delta: delta(approved.embedded_media ?? 0, incoming.embedded_media ?? 0),
    },
    {
      field: "Slide size",
      approved: approved.aspect ?? "—",
      incoming: incoming.aspect ?? "—",
      delta: approved.aspect === incoming.aspect ? "unchanged" : "changed",
    },
    {
      field: "Size",
      approved: formatBytes(approved.size_bytes),
      incoming: formatBytes(incoming.size_bytes),
      delta: formatBytesDelta(approved.size_bytes, incoming.size_bytes),
    },
  ];
}

/* ── sign-off and receipt (FR-SRR-003/004) ───────────────────────────────── */

export async function signOff(
  tx: pg.PoolClient,
  actor: Actor,
  input: { checkinId: string; fileVersionId: string },
): Promise<Result<{ receipt: NonNullable<CheckinDetail["receipt"]> }, DomainError>> {
  const detail = await checkinDetail(tx, input.checkinId);
  if (!detail) return err({ code: "srr.checkin_not_found", message: "This check-in no longer exists — it may have been removed. Refresh the page." });

  if (!detail.talk.slot_id) {
    return err({ code: "srr.no_talk_conflict", message: "This speaker is no longer on a session, so there is nothing to sign off. Check them out." });
  }

  const { rows: version } = await tx.query<{
    id: string;
    version_number: number;
    sha256: Buffer | null;
    processing_state: string;
    event_id: string;
    client_id: string;
  }>(
    // The version must be one of this talk's: a sign-off binds the speaker to their own file.
    `SELECT fv.id, fv.version_number, fv.sha256, fv.processing_state, fv.event_id, fv.client_id
       FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
      WHERE fv.id = $1 AND f.slot_id = $2`,
    [input.fileVersionId, detail.talk.slot_id],
  );
  if (!version[0]) return err({ code: "srr.version_not_found", message: "This version no longer exists — it may have been removed. Refresh the page." });
  if (!(await srrIsOpen(tx, version[0].event_id))) return err(SRR_CLOSED);

  // I-2 again, at the last gate: nothing unscanned is ever signed for.
  if (version[0].processing_state !== "stored") {
    return err({
      code: "srr.not_signable",
      message: `This version can't be signed off (${wordsFor(VERSION_STATE, version[0].processing_state).label.toLowerCase()}). Only a version that has passed the virus check can be signed off.`,
    });
  }

  const { rows: signOffRows } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.sign_offs (checkin_id, event_id, client_id, speaker_id, file_version_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [input.checkinId, version[0].event_id, version[0].client_id, detail.speaker.id, input.fileVersionId],
  );

  const receipt = {
    version_number: version[0].version_number,
    sha256: version[0].sha256 ? version[0].sha256.toString("hex") : "",
    signed_at: new Date().toISOString(),
    station: detail.checkin.station,
    technician: detail.checkin.technician,
  };

  const { rows: receiptRows } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.receipts (sign_off_id, event_id, client_id, content)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [signOffRows[0]!.id, version[0].event_id, version[0].client_id, JSON.stringify(receipt)],
  );
  await tx.query(`UPDATE pmp.sign_offs SET receipt_id = $1 WHERE id = $2`, [
    receiptRows[0]!.id,
    signOffRows[0]!.id,
  ]);

  // Final onsite lock: from here the speaker portal can no longer replace it.
  await tx.query(`UPDATE pmp.slots SET final_locked = true, lock_version = lock_version + 1 WHERE id = $1`, [
    detail.talk.slot_id,
  ]);

  await appendAudit(tx, {
    partitionId: version[0].event_id,
    clientId: version[0].client_id,
    actorUserId: actor.id,
    action: "srr.signed_off",
    subjectType: "sign_off",
    subjectId: signOffRows[0]!.id,
    detail: { ...receipt, slot_id: detail.talk.slot_id },
  });

  return ok({ receipt });
}

/**
 * Emails the speaker their presentation receipt (FR-SRR-004). The button used to show
 * "Receipt emailed" and send nothing. It is recorded in `communications` like every
 * speaker email, so it shows in the event's mail log and the archive, and goes through
 * the outbox and the dispatcher's guards (bounced or invalid addresses are not mailed).
 */
export async function emailReceipt(
  tx: pg.PoolClient,
  actor: Actor,
  checkinId: string,
): Promise<Result<{ emailed_to: string }, DomainError>> {
  const detail = await checkinDetail(tx, checkinId);
  if (!detail) return err({ code: "srr.checkin_not_found", message: "This check-in no longer exists — it may have been removed. Refresh the page." });
  if (!detail.receipt) {
    return err({
      code: "srr.no_receipt_conflict",
      message: "There is no receipt yet — confirm the final onsite version first.",
    });
  }

  const { rows } = await tx.query<{
    email: string | null;
    event_id: string;
    client_id: string;
    event_name: string;
    timezone: string;
  }>(
    `SELECT sp.email::text AS email, e.id AS event_id, e.client_id, e.name AS event_name, e.timezone
       FROM pmp.srr_checkins c
       JOIN pmp.speakers sp ON sp.id = c.speaker_id
       JOIN pmp.events e ON e.id = c.event_id
      WHERE c.id = $1`,
    [checkinId],
  );
  const row = rows[0];
  if (!row) return err({ code: "srr.checkin_not_found", message: "This check-in no longer exists — it may have been removed. Refresh the page." });
  if (!row.email) {
    return err({
      code: "srr.no_email_conflict",
      message: `${detail.speaker.name} has no email address on file, so the receipt cannot be emailed. Print it instead.`,
    });
  }

  const receipt = detail.receipt;
  const subject = `${row.event_name}: your presentation receipt for “${detail.talk.title}”`;
  const body = [
    `Hi ${detail.speaker.name},`,
    "",
    `This confirms the presentation that will be shown for your talk at ${row.event_name}:`,
    "",
    `  Talk:        ${detail.talk.title}`,
    `  Room:        ${detail.talk.room ?? "to be confirmed"} · ${formatSessionTime(detail.talk.starts_at, row.timezone)}`,
    `  Version:     v${receipt.version_number}`,
    `  Signed off:  ${formatSessionTime(receipt.signed_at, row.timezone)}${receipt.station ? ` at ${receipt.station}` : ""}`,
    `  Technician:  ${receipt.technician}`,
    "",
    "This version is now locked for the room. If you need to change anything, come back to the Speaker Ready Room",
    "with the new file — it can no longer be replaced through the speaker portal.",
    "",
    "The DXG presentation team",
  ].join("\n");

  const { rows: comm } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.communications (event_id, client_id, speaker_id, to_address, subject, body, status)
     VALUES ($1, $2, $3, $4::citext, $5, $6, 'queued') RETURNING id`,
    [row.event_id, row.client_id, detail.speaker.id, row.email, subject, body],
  );
  await tx.query(`INSERT INTO pmp.outbox (topic, payload) VALUES ('email.send', $1)`, [
    // A receipt asks nothing of the speaker, so it carries the event's look but no button (D-138).
    JSON.stringify({ communication_id: comm[0]!.id, to: row.email, subject, body, look: await lookFor(tx, row.event_id, null) }),
  ]);
  await appendAudit(tx, {
    partitionId: row.event_id,
    clientId: row.client_id,
    actorUserId: actor.id,
    action: "srr.receipt_emailed",
    subjectType: "srr_checkin",
    subjectId: checkinId,
    detail: { to: row.email, version_number: receipt.version_number, communication_id: comm[0]!.id },
  });
  return ok({ emailed_to: row.email });
}

/* ── the speaker's technician (D-169) ──────────────────────────────────────── */

export type SrrTechnician = { id: string; name: string };

/**
 * Who a check-in may name as the speaker's technician: DXG Technician staff on this event — never
 * an admin or support staff, a practice event included (assign a technician to it to practise).
 */
export async function eventTechnicianChoices(tx: pg.PoolClient, eventId: string): Promise<SrrTechnician[]> {
  const { rows } = await tx.query<SrrTechnician>(
    `SELECT u.id, u.display_name AS name
       FROM pmp.users u
      WHERE u.is_active AND u.deleted_at IS NULL AND u.staff_kind = 'technician'
        AND EXISTS (SELECT 1 FROM pmp.event_roles er WHERE er.event_id = $1 AND er.user_id = u.id)
      ORDER BY name`,
    [eventId],
  );
  return rows;
}

async function technicianChoice(
  tx: pg.PoolClient,
  eventId: string,
  technicianId: string | undefined,
): Promise<Result<SrrTechnician, DomainError>> {
  const choices = await eventTechnicianChoices(tx, eventId);
  if (choices.length === 0) {
    return err({
      code: "srr.no_technicians",
      message: "No DXG Technician is on this event yet. A DXG Admin adds one under Event assignments.",
    });
  }
  if (!technicianId) {
    return err({ code: "srr.technician_required", message: "Choose the technician who helps the speaker." });
  }
  const chosen = choices.find((choice) => choice.id === technicianId);
  if (!chosen) {
    return err({
      code: "srr.technician_not_found",
      message: "That person isn't a technician on this event. Choose one from the list.",
    });
  }
  return ok(chosen);
}

/** Hands a speaker at a desk to another technician (D-169) — a shift change, say. */
export async function changeTechnician(
  tx: pg.PoolClient,
  actor: Actor,
  checkinId: string,
  technicianId: string | undefined,
): Promise<Result<{ technician: SrrTechnician }, DomainError>> {
  const { rows: visit } = await tx.query<{ event_id: string; client_id: string; technician_id: string; departed_at: string | null }>(
    `SELECT event_id, client_id, technician_id, departed_at FROM pmp.srr_checkins WHERE id = $1`,
    [checkinId],
  );
  if (!visit[0]) return err({ code: "srr.checkin_not_found", message: "This check-in no longer exists. Refresh the page." });
  if (visit[0].departed_at) {
    return err({ code: "srr.already_departed", message: "This speaker has checked out. Check them in again to change the technician." });
  }
  const technician = await technicianChoice(tx, visit[0].event_id, technicianId);
  if (!technician.ok) return err(technician.error);
  if (technician.value.id === visit[0].technician_id) return ok({ technician: technician.value });

  await tx.query(
    `UPDATE pmp.srr_checkins SET technician_id = $2, lock_version = lock_version + 1 WHERE id = $1`,
    [checkinId, technician.value.id],
  );
  await appendAudit(tx, {
    partitionId: visit[0].event_id,
    clientId: visit[0].client_id,
    actorUserId: actor.id,
    action: "srr.technician_changed",
    subjectType: "srr_checkin",
    subjectId: checkinId,
    detail: { from: visit[0].technician_id, to: technician.value.id },
  });
  return ok({ technician: technician.value });
}

export async function depart(
  tx: pg.PoolClient,
  actor: Actor,
  checkinId: string,
): Promise<Result<{ departed: true }, DomainError>> {
  const { rowCount } = await tx.query(
    `UPDATE pmp.srr_checkins SET departed_at = now(), lock_version = lock_version + 1
      WHERE id = $1 AND departed_at IS NULL`,
    [checkinId],
  );
  if (rowCount === 0) return err({ code: "srr.already_departed", message: "Already checked out." });
  const { rows } = await tx.query<{ event_id: string; client_id: string }>(
    `SELECT event_id, client_id FROM pmp.srr_checkins WHERE id = $1`,
    [checkinId],
  );
  await appendAudit(tx, {
    partitionId: rows[0]!.event_id,
    clientId: rows[0]!.client_id,
    actorUserId: actor.id,
    action: "srr.departed",
    subjectType: "srr_checkin",
    subjectId: checkinId,
  });
  return ok({ departed: true });
}

/* ── check-in / checkout report (client review, D-153) ───────────────────── */

/**
 * A spreadsheet cell. A value that would start a formula (`=`, `+`, `-`, `@`, tab, return) is
 * prefixed with an apostrophe, so a name typed into an agenda can never run in Excel.
 */
const csvCell = (raw: string): string => {
  const value = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
};

/**
 * Every check-in of the event, one row each, in the order they happened: who, at which
 * desk, when they came and went, on the event's own clock. A UTF-8 byte-order mark leads
 * the file so Excel opens names with accents correctly.
 */
export async function srrReportCsv(
  tx: pg.PoolClient,
  eventId: string,
): Promise<{ csv: string; eventName: string } | null> {
  const { rows: events } = await tx.query<{ name: string; timezone: string }>(
    `SELECT name, timezone FROM pmp.events WHERE id = $1`,
    [eventId],
  );
  const event = events[0];
  if (!event) return null;

  const { rows } = await tx.query<{
    presenter: string;
    email: string | null;
    talks: string | null;
    rooms: string | null;
    desk: string | null;
    checked_in: string;
    checked_out: string | null;
    minutes: number | null;
    technician: string | null;
    signed_off: number | null;
  }>(
    `SELECT sp.full_name AS presenter, sp.email,
            (SELECT string_agg(s.title, '; ' ORDER BY se.starts_at)
               FROM pmp.speaker_assignments sa JOIN pmp.slots s ON s.id = sa.slot_id
               JOIN pmp.sessions se ON se.id = s.session_id
              WHERE sa.speaker_id = sp.id) AS talks,
            (SELECT string_agg(DISTINCT r.name, '; ')
               FROM pmp.speaker_assignments sa JOIN pmp.slots s ON s.id = sa.slot_id
               JOIN pmp.sessions se ON se.id = s.session_id JOIN pmp.rooms r ON r.id = se.room_id
              WHERE sa.speaker_id = sp.id) AS rooms,
            c.station AS desk,
            to_char(c.checked_in_at AT TIME ZONE $2, 'YYYY-MM-DD HH24:MI') AS checked_in,
            to_char(c.departed_at AT TIME ZONE $2, 'YYYY-MM-DD HH24:MI') AS checked_out,
            CASE WHEN c.departed_at IS NULL THEN NULL
                 ELSE round(extract(epoch FROM c.departed_at - c.checked_in_at) / 60)::int END AS minutes,
            u.display_name AS technician,
            (SELECT fv.version_number FROM pmp.sign_offs so
               JOIN pmp.file_versions fv ON fv.id = so.file_version_id
              WHERE so.checkin_id = c.id ORDER BY so.signed_at DESC LIMIT 1) AS signed_off
       FROM pmp.srr_checkins c
       JOIN pmp.speakers sp ON sp.id = c.speaker_id
       LEFT JOIN pmp.users u ON u.id = c.technician_id
      WHERE c.event_id = $1
      ORDER BY c.checked_in_at, sp.full_name`,
    [eventId, event.timezone],
  );

  const heading = [
    "Presenter",
    "Email",
    "Talk",
    "Room",
    "Desk",
    `Check-in (${event.timezone})`,
    `Checkout (${event.timezone})`,
    "Minutes at desk",
    "Checked in by",
    "Signed-off version",
  ];
  const lines = [heading, ...rows.map((row) => [
    row.presenter,
    row.email ?? "",
    row.talks ?? "",
    row.rooms ?? "",
    row.desk ?? "",
    row.checked_in,
    row.checked_out ?? "Still checked in",
    row.minutes === null ? "" : String(row.minutes),
    row.technician ?? "",
    row.signed_off === null ? "" : `v${row.signed_off}`,
  ])];
  return { csv: "﻿" + lines.map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n", eventName: event.name };
}
