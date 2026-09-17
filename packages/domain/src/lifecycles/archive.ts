import type { Lifecycle } from "../transition.ts";
import { atLeast } from "../roles.ts";

/** WORKFLOW_STATES §6 — archive packages (FR-ARCH-001..003). */
export const ARCHIVE_STATES = ["draft", "building", "ready", "delivered", "expired", "deleted"] as const;
export type ArchiveState = (typeof ARCHIVE_STATES)[number];

export type ArchiveAction = "build" | "built" | "build_failed" | "deliver" | "expire" | "reissue" | "delete";

const MANAGERS = atLeast("presentation_manager");

export const archiveLifecycle: Lifecycle<ArchiveState, ArchiveAction> = {
  name: "archive",
  states: ARCHIVE_STATES,
  labels: {
    draft: "Not built",
    building: "Building",
    ready: "Built",
    delivered: "Delivered to client portal",
    expired: "Link expired",
    deleted: "Deleted",
  },
  terminal: ["deleted"],
  rules: [
    { from: "draft", action: "build", to: "building", authority: MANAGERS },
    { from: "building", action: "built", to: "ready", authority: "machine" },
    { from: "building", action: "build_failed", to: "draft", authority: "machine" },
    { from: "ready", action: "deliver", to: "delivered", authority: MANAGERS },
    { from: "delivered", action: "expire", to: "expired", authority: "machine" },
    { from: "expired", action: "reissue", to: "delivered", authority: MANAGERS, requiresReason: true },
    // Certified deletion is irreversible by design and blocked by a legal hold
    // (checked by the service before it calls this transition).
    { from: "expired", action: "delete", to: "deleted", authority: ["platform_admin"], requiresReason: true },
    { from: "delivered", action: "delete", to: "deleted", authority: ["platform_admin"], requiresReason: true },
  ],
  overrideRoles: ["platform_admin"],
};
