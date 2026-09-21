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

const TALK_AGG = `
  SELECT s.id AS slot_id, r.id AS room_id, r.name AS room_name,
         se.session_state, (e.status = 'archived') AS event_archived,
         (SELECT json_agg(json_build_object('processing', fv.processing_state,
                                            'inspection', fv.inspection_state,
                                            'review', fv.review_state)
                          ORDER BY fv.version_number)
            FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
           WHERE f.slot_id = s.id) AS versions,
         (SELECT json_agg(json_build_object('state', rf.sync_state,
                  'requiresAck', (rf.acknowledged_at IS NULL AND rf.sync_state = 'synced'),
                  'acknowledged', (rf.acknowledged_at IS NOT NULL)))
            FROM pmp.room_files rf
            JOIN pmp.file_versions fv2 ON fv2.id = rf.file_version_id
            JOIN pmp.files f2 ON f2.id = fv2.file_id
           WHERE f2.slot_id = s.id AND fv2.review_state = 'approved') AS room_copies,
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

  const { rows: roomRows } = await tx.query<{ room_id: string; heartbeat_age: number | null }>(
    `SELECT r.id AS room_id,
            EXTRACT(EPOCH FROM (now() - ra.last_heartbeat_at))::int AS heartbeat_age
       FROM pmp.rooms r
       LEFT JOIN pmp.room_agents ra ON ra.room_id = r.id AND ra.revoked_at IS NULL
      WHERE r.event_id = $1`,
    [eventId],
  );

  let roomsReady = 0;
  for (const room of roomRows) {
    const talks = rows.filter((row) => row.room_id === room.room_id).map(snapshotOf);
    const readiness = deriveRoomReadiness({
      heartbeatAgeSeconds: room.heartbeat_age ?? Number.MAX_SAFE_INTEGER,
      upcomingTalks: talks,
    });
    if (readiness === "ready") roomsReady += 1;
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

/** "Today's risk list" — anything not yet safely onsite (screen 4). */
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

  return rows
    .map((row) => {
      const status = deriveTalkStatus(snapshotOf(row));
      return {
        slot_id: row.slot_id,
        room: row.room_name,
        starts_at: row.starts_at,
        speaker: row.speaker,
        title: row.title,
        status,
        status_label: TALK_STATUS_LABEL[status],
      };
    })
    .filter((item) => item.status !== "synchronized_onsite" && item.status !== "archived");
}

export type QueueItem = {
  file_version_id: string;
  lock_version: number;
  review_state: string;
  version_number: number;
  slot_id: string;
  title: string;
  speaker: string | null;
  speaker_id: string | null;
  room: string | null;
  starts_at: string;
  size_bytes: string;
  findings: { check_code: string; severity: string; detail: Record<string, unknown> }[];
};

/** Review queue, oldest first (screen 8, FR-REV-001). */
export async function reviewQueue(tx: pg.PoolClient, eventId: string): Promise<QueueItem[]> {
  const { rows } = await tx.query<QueueItem>(
    `SELECT fv.id AS file_version_id, fv.lock_version, fv.review_state, fv.version_number,
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
                       WHERE inf.file_version_id = fv.id AND inf.waived_at IS NULL), '[]'::json) AS findings
       FROM pmp.file_versions fv
       JOIN pmp.files f ON f.id = fv.file_id
       JOIN pmp.slots s ON s.id = f.slot_id
       JOIN pmp.sessions se ON se.id = s.session_id
       LEFT JOIN pmp.rooms r ON r.id = se.room_id
      WHERE fv.event_id = $1 AND fv.review_state IN ('awaiting_review','in_review')
      ORDER BY fv.created_at ASC`,
    [eventId],
  );
  return rows;
}

export type FleetRoom = {
  room_id: string;
  room: string;
  readiness: "ready" | "attention" | "agent_offline";
  files_current: number;
  files_total: number;
  heartbeat_age: number | null;
  agent_version: string | null;
};

/** Room sync fleet view (screen 14, OBJ-6). */
export async function syncFleet(tx: pg.PoolClient, eventId: string): Promise<FleetRoom[]> {
  const { rows: talkRows } = await tx.query<TalkAggRow>(TALK_AGG, [eventId]);
  const { rows: roomRows } = await tx.query<{
    room_id: string;
    room: string;
    heartbeat_age: number | null;
    agent_version: string | null;
  }>(
    `SELECT r.id AS room_id, r.name AS room,
            EXTRACT(EPOCH FROM (now() - ra.last_heartbeat_at))::int AS heartbeat_age,
            ra.agent_version
       FROM pmp.rooms r
       LEFT JOIN pmp.room_agents ra ON ra.room_id = r.id AND ra.revoked_at IS NULL
      WHERE r.event_id = $1
      ORDER BY r.name`,
    [eventId],
  );

  return roomRows.map((room) => {
    const talks = talkRows.filter((row) => row.room_id === room.room_id);
    const snapshots = talks.map(snapshotOf);
    return {
      room_id: room.room_id,
      room: room.room,
      readiness: deriveRoomReadiness({
        heartbeatAgeSeconds: room.heartbeat_age ?? Number.MAX_SAFE_INTEGER,
        upcomingTalks: snapshots,
      }),
      files_current: snapshots.filter((talk) => deriveTalkStatus(talk) === "synchronized_onsite").length,
      files_total: snapshots.length,
      heartbeat_age: room.heartbeat_age,
      agent_version: room.agent_version,
    };
  });
}
