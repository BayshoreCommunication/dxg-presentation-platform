import type { Lifecycle } from "../transition.ts";
import { atLeast } from "../roles.ts";

/**
 * WORKFLOW_STATES §2 — automated tier-1 inspection (FR-INSP-001..004). There is no
 * "technician review" (D-114): nothing ever referred a file to it, and it would have
 * blocked approval with no way out. Judgement calls are warnings a reviewer reads.
 */
export const INSPECTION_STATES = [
  "pending",
  "inspecting",
  "passed",
  "passed_with_warnings",
  "failed",
] as const;
export type InspectionState = (typeof INSPECTION_STATES)[number];

export type InspectionAction =
  | "start"
  | "pass"
  | "pass_with_warnings"
  | "fail";

export const inspectionLifecycle: Lifecycle<InspectionState, InspectionAction> = {
  name: "inspection",
  states: INSPECTION_STATES,
  labels: {
    pending: "Queued for checks",
    inspecting: "Checks running",
    passed: "Checks passed",
    passed_with_warnings: "Warning",
    failed: "Failed",
  },
  terminal: ["passed", "passed_with_warnings", "failed"],
  rules: [
    { from: "pending", action: "start", to: "inspecting", authority: "machine" },
    { from: "inspecting", action: "pass", to: "passed", authority: "machine" },
    { from: "inspecting", action: "pass_with_warnings", to: "passed_with_warnings", authority: "machine" },
    { from: "inspecting", action: "fail", to: "failed", authority: "machine" },
  ],
  overrideRoles: atLeast("presentation_manager"),
};

/**
 * Review eligibility (WORKFLOW_STATES §3): a terminal, non-failed inspection —
 * or a failed one whose blocking findings are all waived (FR-INSP-003).
 */
export const isReviewEligible = (
  state: InspectionState,
  allBlockingFindingsWaived: boolean,
): boolean =>
  state === "passed" ||
  state === "passed_with_warnings" ||
  (state === "failed" && allBlockingFindingsWaived);

/** Waivers annotate a finding; they never move the lifecycle. */
export const WAIVER_ROLES = atLeast("presentation_manager");
