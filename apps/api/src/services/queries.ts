import type pg from "pg";
import { deriveTalkStatus, deriveRoomReadiness, TALK_STATUS_LABEL } from "@pmp/domain";
import type { TalkSnapshot, VersionSnapshot, RoomCopySnapshot } from "@pmp/domain";

export type EventSummary = {
  event: {
    id: string;
    name: string;
    starts_on: string;
    ends_on: string;
    status: string;
    timezone: string;
    /** Null when no venue has been recorded — the header says so rather than inventing one. */
    venue: string | null;
  };
  collected: number;
  total: number;
  approved: number;
  warnings_open: number;
  missing: number;
  rooms_ready: number;
  rooms_total: number;
};

type TalkAggRow = {
  slot_id: string;
  room_id: string | null;
  room_name: string | null;
  session_state: string;
  event_archived: boolean;
  versions: VersionSnapshot[] | null;
  room_copies: RoomCopySnapshot[] | null;
  warnings: number;
};

/**
 * The room copies of a talk's approved version, as `deriveTalkStatus` reads them. `slot` is
 * the SQL expression for the talk's slot id.
 *
 * D-125: room PCs are loaded by hand, so nothing is "acknowledged" any more. A copy is
 * pending ("Update pending ack") when it is not loaded yet while the room still plays an
 * older copy of the same talk — the room PC has the old version and the new one must be
 * loaded. It used to mean "copied by the room PC but not switched in".
 */
export const approvedRoomCopiesSql = (slot: string): string => `
  (SELECT json_agg(json_build_object(
            'state', rf.sync_state,
            'requiresAck', (rf.sync_state NOT IN ('active', 'obsolete') AND EXISTS (
                SELECT 1 FROM pmp.room_files rfo
                  JOIN pmp.file_versions fvo ON fvo.id = rfo.file_version_id
                 WHERE rfo.room_id = rf.room_id AND fvo.file_id = fv2.file_id
                   AND rfo.sync_state = 'active' AND rfo.id <> rf.id)),
            'acknowledged', false))
     FROM pmp.room_files rf
     JOIN pmp.file_versions fv2 ON fv2.id = rf.file_version_id
     JOIN pmp.files f2 ON f2.id = fv2.file_id
    WHERE f2.slot_id = ${slot} AND fv2.review_state = 'approved')`;

const TALK_AGG = `
  SELECT s.id AS slot_id, r.id AS room_id, r.name AS room_name,
         se.session_state, (e.status = 'archived') AS event_archived,
         (SELECT json_agg(json_build_object('processing', fv.processing_state,
                                            'inspection', fv.inspection_state,
                                            'review', fv.review_state)
                          ORDER BY fv.version_number)
            FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
           WHERE f.slot_id = s.id) AS versions,
         ${approvedRoomCopiesSql("s.id")} AS room_copies,
         (SELECT count(*) FROM pmp.inspection_findings inf
            JOIN pmp.file_versions fv3 ON fv3.id = inf.file_version_id
            JOIN pmp.files f3 ON f3.id = fv3.file_id
           WHERE f3.slot_id = s.id AND inf.severity IN ('warning','blocking')
             AND inf.waived_at IS NULL) AS warnings
    FROM pmp.slots s
    JOIN pmp.sessions se ON se.id = s.session_id
    JOIN pmp.events e ON e.id = s.event_id
    LEFT JOIN pmp.rooms r ON r.id = se.room_id
   WHERE s.event_id = $1`;

const snapshotOf = (row: TalkAggRow): TalkSnapshot => ({
  sessionState: row.session_state as TalkSnapshot["sessionState"],
  eventArchived: row.event_archived,
  versions: row.versions ?? [],
  roomCopies: row.room_copies ?? [],
});

/** Command-center KPI row (screen 4) — every number computed, none stored. */
export async function eventSummary(tx: pg.PoolClient, eventId: string): Promise<EventSummary | null> {
  const { rows: eventRows } = await tx.query<EventSummary["event"]>(
    /*
     * The venue comes back with the event because the command centre's header claims
     * to show it. It was a hardcoded string there — "Tampa Convention Center · Day 2
     * of 3 · Doors 08:00" on every event, whatever its venue and however long it ran.
     */
    `SELECT e.id, e.name, e.starts_on::text, e.ends_on::text, e.status, e.timezone,
            v.name AS venue
       FROM pmp.events e
       LEFT JOIN pmp.venues v ON v.id = e.venue_id
      WHERE e.id = $1`,
    [eventId],
  );
  const event = eventRows[0];
  if (!event) return null;

  const { rows } = await tx.query<TalkAggRow>(TALK_AGG, [eventId]);
  const statuses = rows.map((row) => deriveTalkStatus(snapshotOf(row)));

  const { rows: roomRows } = await tx.query<{ room_id: string }>(
    `SELECT r.id AS room_id FROM pmp.rooms r WHERE r.event_id = $1`,
    [eventId],
  );

  // D-125: a room is ready when every talk in it is loaded — no room PC report needed.
  let roomsReady = 0;
  for (const room of roomRows) {
    const talks = rows.filter((row) => row.room_id === room.room_id).map(snapshotOf);
    if (deriveRoomReadiness({ upcomingTalks: talks }) === "ready") roomsReady += 1;
  }

  return {
    event,
    total: statuses.length,
    collected: statuses.filter((status) => status !== "missing").length,
    approved: statuses.filter(
      (status) =>
        status === "approved" || status === "approved_delivering" || status === "synchronized_onsite",
    ).length,
    warnings_open: rows.reduce((sum, row) => sum + Number(row.warnings), 0),
    missing: statuses.filter((status) => status === "missing").length,
    rooms_ready: roomsReady,
    rooms_total: roomRows.length,
  };
}

export type RiskItem = {
  slot_id: string;
  room: string | null;
  starts_at: string;
  speaker: string | null;
  title: string;
  status: string;
  status_label: string;
};

/**
 * "Today's risk list" — every talk not yet loaded on its room PC and ready to play
 * (screen 4). D-125: "Synchronized onsite" means a person ticked it loaded, so it is off
 * the list; there is no room PC report to second-guess it with any more.
 */
export async function riskList(tx: pg.PoolClient, eventId: string): Promise<RiskItem[]> {
  const { rows } = await tx.query<TalkAggRow & { starts_at: string; title: string; speaker: string | null }>(
    `SELECT agg.*, se.starts_at, s.title,
            (SELECT sp.full_name FROM pmp.speaker_assignments sa
               JOIN pmp.speakers sp ON sp.id = sa.speaker_id
              WHERE sa.slot_id = s.id LIMIT 1) AS speaker
       FROM (${TALK_AGG}) agg
       JOIN pmp.slots s ON s.id = agg.slot_id
       JOIN pmp.sessions se ON se.id = s.session_id
      ORDER BY se.starts_at`,
    [eventId],
  );

  return rows.flatMap((row) => {
    const status = deriveTalkStatus(snapshotOf(row));
    if (status === "archived" || status === "synchronized_onsite") return [];
    return [
      {
        slot_id: row.slot_id,
        room: row.room_name,
        starts_at: row.starts_at,
        speaker: row.speaker,
        title: row.title,
        status,
        status_label: TALK_STATUS_LABEL[status],
      },
    ];
  });
}

export type QueueItem = {
  file_version_id: string;
  lock_version: number;
  review_state: string;
  inspection_state: string;
  version_number: number;
  slot_id: string;
  title: string;
  speaker: string | null;
  speaker_id: string | null;
  room: string | null;
  starts_at: string;
  size_bytes: string;
  findings: { check_code: string; severity: string; detail: Record<string, unknown> }[];
  /** The slide preview (a PDF made at upload, D-074); null when never queued. */
  pdf_state: "queued" | "converting" | "done" | "failed" | null;
  pdf_error: string | null;
  original_filename: string | null;
};

/** Review queue, oldest first (screen 8, FR-REV-001). */
export async function reviewQueue(tx: pg.PoolClient, eventId: string): Promise<QueueItem[]> {
  const { rows } = await tx.query<QueueItem>(
    `SELECT fv.id AS file_version_id, fv.lock_version, fv.review_state, fv.version_number,
            fv.inspection_state,
            s.id AS slot_id, s.title, r.name AS room, se.starts_at, fv.size_bytes::text,
            (SELECT sp.full_name FROM pmp.speaker_assignments sa
               JOIN pmp.speakers sp ON sp.id = sa.speaker_id
              WHERE sa.slot_id = s.id LIMIT 1) AS speaker,
            (SELECT sp.id FROM pmp.speaker_assignments sa
               JOIN pmp.speakers sp ON sp.id = sa.speaker_id
              WHERE sa.slot_id = s.id LIMIT 1) AS speaker_id,
            COALESCE((SELECT json_agg(json_build_object(
                        'check_code', inf.check_code, 'severity', inf.severity, 'detail', inf.detail))
                        FROM pmp.inspection_findings inf
                       WHERE inf.file_version_id = fv.id AND inf.waived_at IS NULL), '[]'::json) AS findings,
            pc.state AS pdf_state, pc.error AS pdf_error, fv.original_filename
       FROM pmp.file_versions fv
       LEFT JOIN pmp.pdf_conversions pc ON pc.file_version_id = fv.id
       JOIN pmp.files f ON f.id = fv.file_id
       JOIN pmp.slots s ON s.id = f.slot_id
       JOIN pmp.sessions se ON se.id = s.session_id
       LEFT JOIN pmp.rooms r ON r.id = se.room_id
      WHERE fv.event_id = $1 AND fv.review_state IN ('awaiting_review','in_review')
        -- Only files that passed the virus scan are reviewed (D-105).
        AND fv.processing_state = 'stored'
      ORDER BY fv.created_at ASC`,
    [eventId],
  );
  return rows;
}

/** One talk on the loading checklist (D-125). */
export type FleetTalk = {
  slot_id: string;
  title: string;
  speaker: string | null;
  starts_at: string;
  session_state: string;
  status: string;
  status_label: string;
  /** The talk's approved version and its copy for this room; null when nothing is approved. */
  approved: {
    file_version_id: string;
    version_number: number;
    original_filename: string | null;
    /** The staff download route the Files screen uses (logged to the audit chain). */
    download_url: string;
    room_file_id: string | null;
    lock_version: number | null;
    sync_state: string | null;
    loaded: boolean;
  } | null;
  /** The version the room PC plays now, when a different (older) one is still loaded. */
  loaded_other_version: number | null;
};

export type FleetRoom = {
  room_id: string;
  room: string;
  /** D-125: "ready" when every talk's approved version is loaded (or the talk is cancelled). */
  readiness: "ready" | "attention";
  files_current: number;
  files_total: number;
  /** Kept for later room software; the screens no longer show it (D-125). */
  heartbeat_age: number | null;
  agent_version: string | null;
  /** When the room's computer was given its device key; null if never (D-077). */
  key_issued_at: string | null;
  talks: FleetTalk[];
};

/**
 * Room sync (screen 14, OBJ-6) — since D-125 a loading checklist: per room, each talk's
 * approved version, whether a person has ticked it loaded on the room PC, and a link to
 * download it for copying. Room readiness is the ticks alone.
 */
export async function syncFleet(tx: pg.PoolClient, eventId: string): Promise<FleetRoom[]> {
  const { rows: talkRows } = await tx.query<TalkAggRow>(TALK_AGG, [eventId]);
  const { rows: roomRows } = await tx.query<{
    room_id: string;
    room: string;
    heartbeat_age: number | null;
    agent_version: string | null;
    key_issued_at: string | null;
  }>(
    `SELECT r.id AS room_id, r.name AS room,
            EXTRACT(EPOCH FROM (now() - ra.last_heartbeat_at))::int AS heartbeat_age,
            ra.agent_version, ra.key_issued_at
       FROM pmp.rooms r
       LEFT JOIN pmp.room_agents ra ON ra.room_id = r.id AND ra.revoked_at IS NULL
      WHERE r.event_id = $1
      ORDER BY r.name`,
    [eventId],
  );
  const { rows: checklist } = await tx.query<{
    slot_id: string;
    room_id: string;
    title: string;
    speaker: string | null;
    starts_at: string;
    session_state: string;
    file_version_id: string | null;
    version_number: number | null;
    original_filename: string | null;
    room_file_id: string | null;
    lock_version: number | null;
    sync_state: string | null;
    loaded_other_version: number | null;
  }>(
    `SELECT s.id AS slot_id, se.room_id, s.title, se.starts_at, se.session_state,
            (SELECT sp.full_name FROM pmp.speaker_assignments sa
               JOIN pmp.speakers sp ON sp.id = sa.speaker_id
              WHERE sa.slot_id = s.id LIMIT 1) AS speaker,
            fv.id AS file_version_id, fv.version_number, fv.original_filename,
            rf.id AS room_file_id, rf.lock_version, rf.sync_state,
            (SELECT max(fvo.version_number) FROM pmp.room_files rfo
               JOIN pmp.file_versions fvo ON fvo.id = rfo.file_version_id
               JOIN pmp.files fo ON fo.id = fvo.file_id
              WHERE fo.slot_id = s.id AND rfo.room_id = se.room_id AND rfo.sync_state = 'active'
                AND fvo.id IS DISTINCT FROM fv.id) AS loaded_other_version
       FROM pmp.slots s
       JOIN pmp.sessions se ON se.id = s.session_id
       LEFT JOIN LATERAL (
         SELECT fva.id, fva.version_number, fva.original_filename
           FROM pmp.file_versions fva JOIN pmp.files fa ON fa.id = fva.file_id
          WHERE fa.slot_id = s.id AND fva.review_state = 'approved'
          ORDER BY fva.version_number DESC LIMIT 1
       ) fv ON true
       LEFT JOIN pmp.room_files rf ON rf.file_version_id = fv.id AND rf.room_id = se.room_id
                                   AND rf.sync_state <> 'obsolete'
      WHERE s.event_id = $1 AND se.room_id IS NOT NULL
      ORDER BY se.starts_at, s.title`,
    [eventId],
  );

  return roomRows.map((room) => {
    const talks = talkRows.filter((row) => row.room_id === room.room_id);
    const snapshots = talks.map(snapshotOf);
    const statusOf = new Map(talks.map((row) => [row.slot_id, deriveTalkStatus(snapshotOf(row))]));
    return {
      room_id: room.room_id,
      room: room.room,
      readiness: deriveRoomReadiness({ upcomingTalks: snapshots }),
      files_current: snapshots.filter((talk) => deriveTalkStatus(talk) === "synchronized_onsite").length,
      files_total: snapshots.length,
      heartbeat_age: room.heartbeat_age,
      agent_version: room.agent_version,
      key_issued_at: room.key_issued_at,
      talks: checklist
        .filter((row) => row.room_id === room.room_id)
        .map((row) => {
          const status = statusOf.get(row.slot_id) ?? "missing";
          return {
            slot_id: row.slot_id,
            title: row.title,
            speaker: row.speaker,
            starts_at: row.starts_at,
            session_state: row.session_state,
            status,
            status_label: TALK_STATUS_LABEL[status],
            approved:
              row.file_version_id === null || row.version_number === null
                ? null
                : {
                    file_version_id: row.file_version_id,
                    version_number: row.version_number,
                    original_filename: row.original_filename,
                    download_url: `/api/v1/file-versions/${row.file_version_id}/download`,
                    room_file_id: row.room_file_id,
                    lock_version: row.lock_version,
                    sync_state: row.sync_state,
                    loaded: row.sync_state === "active",
                  },
            loaded_other_version: row.loaded_other_version,
          };
        }),
    };
  });
}
