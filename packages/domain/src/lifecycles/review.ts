import type { Lifecycle } from "../transition.ts";
import { atLeast } from "../roles.ts";

/** WORKFLOW_STATES §3 — review and approval (FR-REV-001..005). */
export const REVIEW_STATES = [
  "awaiting_review",
  "in_review",
  "changes_requested",
  "approved",
  "superseded",
  "rejected",
  "rolled_back",
] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export type ReviewAction =
  | "claim"
  | "release"
  | "approve"
  | "request_changes"
  | "reject"
  | "supersede"
  | "roll_back"
  | "restore";

const REVIEWERS = atLeast("content_reviewer");
const MANAGERS = atLeast("presentation_manager");

export const reviewLifecycle: Lifecycle<ReviewState, ReviewAction> = {
  name: "review",
  states: REVIEW_STATES,
  labels: {
    awaiting_review: "Submitted",
    in_review: "In review",
    changes_requested: "Revision requested",
    approved: "Approved",
    superseded: "Superseded",
    rejected: "Rejected",
    rolled_back: "Rolled back",
  },
  // `superseded` is terminal except for the audited rollback restore below.
  terminal: ["superseded", "rejected", "rolled_back"],
  rules: [
    { from: "awaiting_review", action: "claim", to: "in_review", authority: REVIEWERS },
    { from: "in_review", action: "release", to: "awaiting_review", authority: REVIEWERS },
    { from: "in_review", action: "approve", to: "approved", authority: REVIEWERS },
    { from: "in_review", action: "request_changes", to: "changes_requested", authority: REVIEWERS },
    { from: "in_review", action: "reject", to: "rejected", authority: REVIEWERS, requiresReason: true },
    // Automatic once a newer version is approved.
    { from: "approved", action: "supersede", to: "superseded", authority: "machine" },
    // FR-REV-005: byte-identical restore of an earlier approved version. The
    // current version is rolled back and the earlier one is restored; both halves
    // need a manager and a reason, and both are audited.
    { from: "approved", action: "roll_back", to: "rolled_back", authority: MANAGERS, requiresReason: true },
    { from: "superseded", action: "restore", to: "approved", authority: MANAGERS, requiresReason: true },
  ],
  overrideRoles: MANAGERS,
};

/** I-1: only an independently approved version may be delivered to a room. */
export const isDeliverable = (state: ReviewState): boolean => state === "approved";
