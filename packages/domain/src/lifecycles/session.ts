import type { Lifecycle } from "../transition.ts";
import { atLeast } from "../roles.ts";

/** WORKFLOW_STATES §5 — schedule operations (M03). */
export const SESSION_STATES = ["scheduled", "moved", "replaced", "canceled", "completed"] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export type SessionAction = "move" | "reroute_complete" | "replace_speaker" | "cancel" | "uncancel" | "complete";

const MANAGERS = atLeast("presentation_manager");

export const sessionLifecycle: Lifecycle<SessionState, SessionAction> = {
  name: "session",
  states: SESSION_STATES,
  labels: {
    scheduled: "Scheduled",
    moved: "Moved",
    replaced: "Replacement speaker",
    canceled: "Canceled",
    completed: "Completed",
  },
  terminal: ["completed"],
  rules: [
    { from: "scheduled", action: "move", to: "moved", authority: MANAGERS, requiresReason: true },
    { from: "moved", action: "reroute_complete", to: "scheduled", authority: "machine" },
    { from: "scheduled", action: "replace_speaker", to: "replaced", authority: MANAGERS, requiresReason: true },
    { from: "replaced", action: "reroute_complete", to: "scheduled", authority: "machine" },
    { from: "scheduled", action: "cancel", to: "canceled", authority: MANAGERS, requiresReason: true },
    { from: "canceled", action: "uncancel", to: "scheduled", authority: MANAGERS, requiresReason: true },
    { from: "scheduled", action: "complete", to: "completed", authority: "machine" },
  ],
  overrideRoles: MANAGERS,
};
