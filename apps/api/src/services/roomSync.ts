import type pg from "pg";
import { appendAudit } from "@pmp/db";
import type { Actor, DomainError, Result } from "@pmp/domain";
import { err, ok } from "@pmp/domain";
import { writeZip } from "@pmp/files";
import { storage } from "./ingest.ts";

/*
 * Room sync for DXG Technician staff (client review, D-153): a technician works the rooms
 * they are assigned to — sees only those, ticks only those, and downloads every approved
 * file of a room (or of all their rooms) in one zip.
 */

/** DXG Technician staff placed on the event: the people a room can be given to. */
export async function eventTechnicians(tx: pg.PoolClient, eventId: string): Promise<{ user_id: string; name: string; email: string }[]> {
  const { rows } = await tx.query<{ user_id: string; name: string; email: string }>(
    `SELECT DISTINCT u.id AS user_id, u.display_name AS name, u.email::text AS email
       FROM pmp.users u JOIN pmp.event_roles er ON er.user_id = u.id
      WHERE er.event_id = $1 AND u.staff_kind = 'technician' AND NOT u.is_root_admin
        AND u.account_kind = 'staff' AND u.is_active
      ORDER BY u.display_name`,
    [eventId],
  );
  return rows;
}

/** Whether this technician is assigned to the room. */
export async function assignedTo(tx: pg.PoolClient, userId: string, roomId: string): Promise<boolean> {
  const { rows } = await tx.query(`SELECT 1 FROM pmp.room_assignments WHERE user_id = $1 AND room_id = $2`, [userId, roomId]);
  return rows.length > 0;
}

/** The room a room-file row belongs to, for the technician's own-room check. */
export async function roomOfRoomFile(tx: pg.PoolClient, roomFileId: string): Promise<string | null> {
  const { rows } = await tx.query<{ room_id: string }>(`SELECT room_id FROM pmp.room_files WHERE id = $1`, [roomFileId]);
  return rows[0]?.room_id ?? null;
}

/**
 * Sets who works a room: the list replaces the room's current technicians. Everyone named
 * must be DXG Technician staff on the event.
 */
export async function setRoomTechnicians(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  roomId: string,
  userIds: string[],
): Promise<Result<{ technicians: { user_id: string; name: string }[] }, DomainError>> {
  const { rows: rooms } = await tx.query<{ client_id: string; name: string }>(
    `SELECT client_id, name FROM pmp.rooms WHERE id = $1 AND event_id = $2`,
    [roomId, eventId],
  );
  const room = rooms[0];
  if (!room) return err({ code: "room.not_found", message: "This room no longer exists at this event. Refresh the page." });

  const wanted = [...new Set(userIds)];
  const technicians = await eventTechnicians(tx, eventId);
  const allowed = new Map(technicians.map((person) => [person.user_id, person.name]));
  const stranger = wanted.find((id) => !allowed.has(id));
  if (stranger) {
    return err({
      code: "room.not_a_technician",
      message: "Only DXG Technician staff placed on this event can be given a room. Place them on the event under Event assignments first.",
    });
  }

  await tx.query(`DELETE FROM pmp.room_assignments WHERE room_id = $1 AND NOT (user_id = ANY($2::uuid[]))`, [roomId, wanted]);
  for (const userId of wanted) {
    await tx.query(
      `INSERT INTO pmp.room_assignments (user_id, room_id, event_id, client_id, assigned_by)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [userId, roomId, eventId, room.client_id, actor.id],
    );
  }
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: room.client_id,
    actorUserId: actor.id,
    action: "room.technicians_set",
    subjectType: "room",
    subjectId: roomId,
    detail: { room: room.name, technicians: wanted.map((id) => allowed.get(id)) },
  });
  return ok({ technicians: wanted.map((id) => ({ user_id: id, name: allowed.get(id)! })).sort((a, b) => a.name.localeCompare(b.name)) });
}

/** Big enough for a day of a busy room; past it, download room by room. */
export const ROOM_ZIP_MAX_BYTES = 1024 * 1024 * 1024;

/** "03-11 1030": month-day and 24-hour time on the event's clock, so files sort in order. */
function stamp(iso: string, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.month}-${parts.day} ${parts.hour}${parts.minute}`;
}

const safe = (name: string) => name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "file";

/**
 * Every approved presentation of the given rooms as one zip (D-153), one folder per room
 * when there is more than one, each file named by start time and talk so a technician can
 * copy them onto the room PC in order. Cancelled sessions are left out. Each file is logged
 * as a download.
 */
export async function approvedRoomsZip(
  tx: pg.PoolClient,
  actorUserId: string,
  eventId: string,
  roomIds: string[] | null,
): Promise<Result<{ filename: string; body: Buffer; count: number }, DomainError>> {
  const { rows } = await tx.query<{
    room: string;
    room_id: string;
    timezone: string;
    starts_at: string;
    title: string;
    version_id: string;
    version_number: number;
    filename: string;
    s3_key: string;
    client_id: string;
  }>(
    `SELECT r.name AS room, r.id AS room_id, e.timezone, se.starts_at, s.title,
            fv.id AS version_id, fv.version_number, fv.original_filename AS filename, fv.s3_key, fv.client_id
       FROM pmp.slots s
       JOIN pmp.sessions se ON se.id = s.session_id
       JOIN pmp.rooms r ON r.id = se.room_id
       JOIN pmp.events e ON e.id = s.event_id
       JOIN LATERAL (
         SELECT fva.* FROM pmp.file_versions fva JOIN pmp.files fa ON fa.id = fva.file_id
          WHERE fa.slot_id = s.id AND fva.review_state = 'approved' AND fva.processing_state = 'stored'
          ORDER BY fva.version_number DESC LIMIT 1
       ) fv ON true
      WHERE s.event_id = $1 AND se.session_state <> 'canceled'
        AND ($2::uuid[] IS NULL OR r.id = ANY($2::uuid[]))
      ORDER BY r.name, se.starts_at, s.title`,
    [eventId, roomIds],
  );
  if (rows.length === 0) {
    return err({ code: "room.nothing_approved", message: "There are no approved presentations to download yet." });
  }

  const byRoom = new Set(rows.map((row) => row.room_id)).size > 1;
  const used = new Set<string>();
  const entries: { name: string; body: Buffer }[] = [];
  let bytes = 0;
  for (const row of rows) {
    const body = await storage.read(row.s3_key);
    bytes += body.length;
    if (bytes > ROOM_ZIP_MAX_BYTES) {
      return err({
        code: "room.zip_too_large",
        message: "These presentations add up to more than 1 GB. Download them room by room instead.",
      });
    }
    const time = stamp(row.starts_at, row.timezone);
    const dot = row.filename.lastIndexOf(".");
    const ext = dot > 0 ? row.filename.slice(dot) : "";
    let name = `${time} ${safe(row.title)} (v${row.version_number})${ext}`;
    if (byRoom) name = `${safe(row.room)}/${name}`;
    while (used.has(name.toLowerCase())) name = name.replace(ext, ` ${row.version_id.slice(0, 4)}${ext}`);
    used.add(name.toLowerCase());
    entries.push({ name, body });
  }

  for (const row of rows) {
    await appendAudit(tx, {
      partitionId: eventId,
      clientId: row.client_id,
      actorUserId,
      action: "file.downloaded",
      subjectType: "file_version",
      subjectId: row.version_id,
      detail: { filename: row.filename, bulk: true, room_sync: true, files_in_bundle: rows.length },
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const label = byRoom || !rows[0] ? "rooms" : safe(rows[0].room).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return ok({ filename: `approved-${label}-${today}.zip`, body: writeZip(entries), count: entries.length });
}
