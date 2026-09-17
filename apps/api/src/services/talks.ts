import type pg from "pg";
import { deriveTalkStatus, TALK_STATUS_LABEL } from "@pmp/domain";
import type { TalkSnapshot, TalkStatus, VersionSnapshot, RoomCopySnapshot } from "@pmp/domain";

export type TalkRow = {
  slot_id: string;
  title: string;
  room_id: string;
  room_name: string;
  starts_at: string;
  session_state: string;
  speaker_name: string | null;
  event_archived: boolean;
  versions: VersionSnapshot[] | null;
  room_copies: RoomCopySnapshot[] | null;
};

export type TalkView = {
  slot_id: string;
  title: string;
  room: string;
  starts_at: string;
  speaker: string | null;
  version_count: number;
  status: TalkStatus;
  status_label: string;
};

/**
 * One query, then the status is derived in the domain package — never in SQL and
 * never in a component, so every surface agrees (BUILD_SPEC §5).
 */
export async function listTalks(tx: pg.PoolClient, eventId: string): Promise<TalkView[]> {
  const { rows } = await tx.query<TalkRow>(
    `SELECT s.id                        AS slot_id,
            s.title                     AS title,
            r.id                        AS room_id,
            r.name                      AS room_name,
            se.starts_at                AS starts_at,
            se.session_state            AS session_state,
            sp.full_name                AS speaker_name,
            (e.status = 'archived')     AS event_archived,
            (SELECT json_agg(json_build_object(
                      'processing', fv.processing_state,
                      'inspection', fv.inspection_state,
                      'review',     fv.review_state)
                    ORDER BY fv.version_number)
               FROM pmp.file_versions fv
               JOIN pmp.files f ON f.id = fv.file_id
              WHERE f.slot_id = s.id)   AS versions,
            (SELECT json_agg(json_build_object(
                      'state',        rf.sync_state,
                      'requiresAck',  (rf.acknowledged_at IS NULL AND rf.sync_state = 'synced'),
                      'acknowledged', (rf.acknowledged_at IS NOT NULL)))
               FROM pmp.room_files rf
               JOIN pmp.file_versions fv2 ON fv2.id = rf.file_version_id
               JOIN pmp.files f2 ON f2.id = fv2.file_id
              WHERE f2.slot_id = s.id
                AND fv2.review_state = 'approved') AS room_copies
       FROM pmp.slots s
       JOIN pmp.sessions se ON se.id = s.session_id
       JOIN pmp.events e    ON e.id = s.event_id
       LEFT JOIN pmp.rooms r ON r.id = se.room_id
       LEFT JOIN pmp.speaker_assignments sa ON sa.slot_id = s.id
       LEFT JOIN pmp.speakers sp ON sp.id = sa.speaker_id
      WHERE s.event_id = $1
      ORDER BY se.starts_at`,
    [eventId],
  );

  return rows.map((row) => {
    const snapshot: TalkSnapshot = {
      sessionState: row.session_state as TalkSnapshot["sessionState"],
      eventArchived: row.event_archived,
      versions: row.versions ?? [],
      roomCopies: row.room_copies ?? [],
    };
    const status = deriveTalkStatus(snapshot);
    return {
      slot_id: row.slot_id,
      title: row.title,
      room: row.room_name,
      starts_at: row.starts_at,
      speaker: row.speaker_name,
      version_count: snapshot.versions.length,
      status,
      status_label: TALK_STATUS_LABEL[status],
    };
  });
}
