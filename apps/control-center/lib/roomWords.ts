/**
 * How a room's presentation computer is described to staff (D-108): one place, so the
 * command centre and Room sync say the same thing. It replaced "heartbeat 529368s ago ·
 * agent 1.4.2", "no agent registered" and a room "Attention" chip that borrowed the talk
 * tooltip about failed virus scans.
 */
export const ROOM_LABEL = { ready: "Ready", attention: "Not ready", agent_offline: "Room PC not reporting" } as const;

/** "6 days" / "3 hours" / "12 minutes" — how long ago, in words. */
export function ago(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.round(hours / 24)} days`;
}

/** The room computer's state in a sentence a technician can act on. */
export function roomPcState(room: { heartbeat_age: number | null; key_issued_at?: string | null }): string {
  if (room.heartbeat_age !== null) {
    return room.heartbeat_age > 300
      ? `room PC last seen ${ago(room.heartbeat_age)} ago — check it is on and online`
      : "room PC connected";
  }
  return room.key_issued_at ? "room PC hasn't reported in yet" : "room PC not connected yet — issue a connection code on Room sync";
}
