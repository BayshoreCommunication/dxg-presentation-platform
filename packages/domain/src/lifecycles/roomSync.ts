import type { Lifecycle } from "../transition.ts";
import { atLeast } from "../roles.ts";

/** WORKFLOW_STATES §4 — per (file_version × room) delivery (FR-SYNC-001..003). */
export const ROOM_SYNC_STATES = [
  "assigned",
  "syncing",
  "synced",
  "acknowledged",
  "active",
  "obsolete",
  "sync_failed",
] as const;
export type RoomSyncState = (typeof ROOM_SYNC_STATES)[number];

export type RoomSyncAction =
  | "start_download"
  | "verify"
  | "fail"
  | "retry"
  | "acknowledge"
  | "activate"
  | "obsolete"
  | "restore"
  | "mark_loaded"
  | "unmark_loaded";

const MANAGERS = atLeast("presentation_manager");

/**
 * D-125: who may tick a talk "Loaded on the room PC". DXG staff copy each approved file
 * onto the room's PC by hand, so this is the onsite crew — the room technician (off the
 * ladder, named explicitly) and the Speaker Ready Room technician and above. A content
 * reviewer never touches a room PC.
 */
const LOADERS = ["room_technician", ...atLeast("srr_technician")] as const;

/** D-125: every not-yet-played state a copy can be ticked loaded from. */
const LOADABLE: readonly RoomSyncState[] = ["assigned", "syncing", "synced", "sync_failed", "acknowledged"];

export const roomSyncLifecycle: Lifecycle<RoomSyncState, RoomSyncAction> = {
  name: "room_sync",
  states: ROOM_SYNC_STATES,
  labels: {
    assigned: "Queued for the room",
    syncing: "Syncing",
    synced: "Synchronized onsite",
    acknowledged: "Acknowledged",
    active: "Current copy",
    obsolete: "Obsolete",
    sync_failed: "Sync failed",
  },
  terminal: ["obsolete"],
  rules: [
    { from: "assigned", action: "start_download", to: "syncing", authority: "machine" },
    // I-3: `synced` requires a full-file checksum match — no partial file is ever visible.
    { from: "syncing", action: "verify", to: "synced", authority: "machine" },
    { from: "syncing", action: "fail", to: "sync_failed", authority: "machine" },
    { from: "sync_failed", action: "retry", to: "syncing", authority: "machine" },
    // I-1: a post-delivery change waits for the room technician.
    { from: "synced", action: "acknowledge", to: "acknowledged", authority: ["room_technician", ...MANAGERS] },
    { from: "acknowledged", action: "activate", to: "active", authority: "machine" },
    // First delivery for a slot needs no acknowledgment.
    { from: "synced", action: "activate", to: "active", authority: "machine" },
    { from: "active", action: "obsolete", to: "obsolete", authority: "machine" },
    // Rollback flips the previously active copy back (audited, rooms notified).
    // A roll-back brings the earlier copy back as "not loaded" (D-125): nobody has checked
    // it is still on the room PC, so a person loads it and ticks it — never a silent "loaded".
    { from: "obsolete", action: "restore", to: "assigned", authority: MANAGERS, requiresReason: true },
    // D-125: room PCs are loaded and checked by hand. A person copies the approved file
    // onto the room's PC and ticks it; the copy is then the one the room plays. The
    // machine rules above stay for later room software, which may tick "loaded" itself.
    ...LOADABLE.map((from) => ({
      from,
      action: "mark_loaded" as const,
      to: "active" as const,
      authority: LOADERS,
    })),
    // A tick made by mistake is taken back; the copy is simply "not loaded yet" again.
    { from: "active", action: "unmark_loaded", to: "assigned", authority: LOADERS },
  ],
  overrideRoles: MANAGERS,
};

/**
 * I-1 + BUILD_SPEC §6.9 launch guard: a room may only play its `active` copy,
 * and only once any required acknowledgment has happened.
 */
export function canLaunch(input: {
  state: RoomSyncState;
  requiresAck: boolean;
  acknowledged: boolean;
}): boolean {
  if (input.state !== "active") return false;
  return input.requiresAck ? input.acknowledged : true;
}

/** A delivery that replaces an already-approved copy in the room needs acknowledgment. */
export const requiresAcknowledgment = (hasPreviousActiveCopy: boolean): boolean =>
  hasPreviousActiveCopy;
