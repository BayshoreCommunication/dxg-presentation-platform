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
  | "restore";

const MANAGERS = atLeast("presentation_manager");

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
    { from: "obsolete", action: "restore", to: "active", authority: MANAGERS, requiresReason: true },
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
