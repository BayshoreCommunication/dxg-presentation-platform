import type { Lifecycle } from "../transition.ts";
import { atLeast } from "../roles.ts";

/** WORKFLOW_STATES §1 — intake and quarantine (FR-FILE-002/003, NFR-SEC-04). */
export const PROCESSING_STATES = [
  "uploading",
  "uploaded",
  "checksum_failed",
  "scanning",
  "quarantined",
  "stored",
] as const;
export type ProcessingState = (typeof PROCESSING_STATES)[number];

export type ProcessingAction =
  | "complete_upload"
  | "fail_checksum"
  | "start_scan"
  | "quarantine"
  | "store"
  | "release_quarantine";

export const processingLifecycle: Lifecycle<ProcessingState, ProcessingAction> = {
  name: "processing",
  states: PROCESSING_STATES,
  labels: {
    uploading: "Uploading",
    uploaded: "Uploaded",
    checksum_failed: "Checksum failed",
    scanning: "Scanning",
    quarantined: "Quarantined",
    stored: "Stored",
  },
  terminal: ["checksum_failed", "quarantined", "stored"],
  rules: [
    { from: "uploading", action: "complete_upload", to: "uploaded", authority: "machine" },
    { from: "uploaded", action: "fail_checksum", to: "checksum_failed", authority: "machine" },
    { from: "uploaded", action: "start_scan", to: "scanning", authority: "machine" },
    // I-2: `stored` is reachable only from `scanning`. There is deliberately no
    // uploaded→stored rule, so an unscanned file can never enter the library.
    { from: "scanning", action: "store", to: "stored", authority: "machine" },
    { from: "scanning", action: "quarantine", to: "quarantined", authority: "machine" },
    {
      from: "quarantined",
      action: "release_quarantine",
      to: "scanning",
      authority: ["platform_admin"],
      requiresReason: true,
    },
  ],
  overrideRoles: ["platform_admin"],
};

/** Scan errors fail closed (WORKFLOW_STATES §1): engine down or timeout ⇒ quarantine. */
export const scanVerdictToAction = (verdict: "clean" | "infected" | "error"): ProcessingAction =>
  verdict === "clean" ? "store" : "quarantine";

export const canEnterLibrary = (state: ProcessingState): boolean => state === "stored";

export const PROCESSING_OVERRIDE_ROLES = atLeast("platform_admin");
