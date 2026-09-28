import { agoWords, ROOM_PC_SILENT_AFTER_SECONDS, talkRoomNote } from "@pmp/format";

/**
 * How a room's presentation computer is described to staff (D-108): one place, so the
 * command centre and Room sync say the same thing. It replaced "heartbeat 529368s ago ·
 * agent 1.4.2", "no agent registered" and a room "Attention" chip that borrowed the talk
 * tooltip about failed virus scans.
 */
export const ROOM_LABEL = { ready: "Ready", attention: "Not ready", agent_offline: "Room PC not reporting" } as const;

/** The room computer's state in a sentence a technician can act on. */
export function roomPcState(room: { heartbeat_age: number | null; key_issued_at?: string | null }): string {
  if (room.heartbeat_age !== null) {
    return room.heartbeat_age > ROOM_PC_SILENT_AFTER_SECONDS
      ? `room PC last seen ${agoWords(room.heartbeat_age)} ago — check it is on and online`
      : "room PC connected";
  }
  return room.key_issued_at ? "room PC hasn't reported in yet" : "room PC not connected yet — issue a connection code on Room sync";
}

/**
 * "3 of 4 files on the room PC" — and, once the room PC has gone quiet, only as of its
 * last report (R7, D-110): the count is what it last confirmed, not what is there now.
 */
export function roomFilesLine(room: { files_current: number; files_total: number; heartbeat_age: number | null }): string {
  if (room.files_total === 0) return "no presentations for this room yet";
  const count = `${room.files_current} of ${room.files_total} ${room.files_total === 1 ? "file" : "files"} on the room PC`;
  return room.heartbeat_age !== null && room.heartbeat_age > ROOM_PC_SILENT_AFTER_SECONDS
    ? `${count} when it last reported`
    : count;
}

/**
 * R7 (D-110): the amber note for a talk whose room PC has gone quiet, looked up in the
 * room list (Room sync's `heartbeat_age`) by the talk's room name — the talk lists name
 * their room, and room names are unique within an event. Null when the status stands.
 */
export function staleNoteFor(
  status: string,
  room: string | null | undefined,
  rooms: readonly { room: string; heartbeat_age: number | null }[],
): string | null {
  const match = room ? rooms.find((entry) => entry.room === room) : undefined;
  return talkRoomNote(status, match ? match.heartbeat_age : undefined);
}
