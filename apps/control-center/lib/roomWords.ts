/**
 * How a room is described to staff (D-108): one place, so the command centre, Room sync
 * and Room Agent say the same thing.
 *
 * D-125 (Travis's call): room PCs are loaded and checked by hand, so nothing here talks
 * about whether a room PC is set up, connected or reporting. A room is Ready when every
 * talk's approved version has been ticked "loaded" on Room sync.
 */
export const ROOM_LABEL = { ready: "Ready", attention: "Not ready" } as const;

/** "1 of 2 talks loaded" — the room's ticks, in one line. */
export function roomLoadedLine(room: { files_current: number; files_total: number }): string {
  if (room.files_total === 0) return "no presentations for this room yet";
  return `${room.files_current} of ${room.files_total} ${room.files_total === 1 ? "talk" : "talks"} loaded`;
}

