import type { ProcessingState } from "../lifecycles/processing.ts";
import type { InspectionState } from "../lifecycles/inspection.ts";
import type { ReviewState } from "../lifecycles/review.ts";
import type { RoomSyncState } from "../lifecycles/roomSync.ts";
import type { SessionState } from "../lifecycles/session.ts";

/**
 * WORKFLOW_STATES §8 — the overall presentation status. It is never stored:
 * it is derived here, once, and used by the API, both web apps and reports
 * (BUILD_SPEC §5). The prototype's `derived()` is the behavioural reference.
 */
export const TALK_STATUSES = [
  "archived",
  "canceled",
  "attention",
  "missing",
  "processing",
  "needs_revision",
  "submitted",
  "update_pending_ack",
  "approved_delivering",
  "synchronized_onsite",
  "approved",
] as const;
export type TalkStatus = (typeof TALK_STATUSES)[number];

/** Fixed UI copy (VISUAL_ACCEPTANCE §2.2) — the baseline's words are the product's words. */
export const TALK_STATUS_LABEL: Readonly<Record<TalkStatus, string>> = {
  archived: "Archived",
  canceled: "Canceled",
  attention: "Attention",
  missing: "Missing",
  processing: "Processing",
  needs_revision: "Needs revision",
  submitted: "Submitted",
  update_pending_ack: "Update pending ack",
  approved_delivering: "Approved — delivering",
  synchronized_onsite: "Synchronized onsite",
  approved: "Approved",
};

export type VersionSnapshot = {
  readonly processing: ProcessingState;
  readonly inspection: InspectionState;
  readonly review: ReviewState;
};

export type RoomCopySnapshot = {
  readonly state: RoomSyncState;
  readonly requiresAck: boolean;
  readonly acknowledged: boolean;
};

export type TalkSnapshot = {
  readonly sessionState: SessionState;
  readonly eventArchived: boolean;
  /** Oldest first; the last entry is the current version. */
  readonly versions: readonly VersionSnapshot[];
  /** Room copies of the approved version. Empty until a version is approved. */
  readonly roomCopies: readonly RoomCopySnapshot[];
};

const IN_PIPELINE: readonly ProcessingState[] = ["uploading", "uploaded", "scanning"];

export function deriveTalkStatus(talk: TalkSnapshot): TalkStatus {
  // Rules 1–7 of WORKFLOW_STATES §8. Canceled and archived are evaluated first:
  // they are facts about the session, and a canceled slot must not be reported
  // as "Missing" merely because nobody uploaded to it.
  if (talk.eventArchived) return "archived";
  if (talk.sessionState === "canceled") return "canceled";

  const current = talk.versions.at(-1);
  if (!current) return "missing";

  if (current.processing === "quarantined" || current.processing === "checksum_failed") {
    return "attention";
  }
  if (IN_PIPELINE.includes(current.processing)) return "processing";
  if (current.inspection === "pending" || current.inspection === "inspecting") return "processing";

  if (current.review === "changes_requested" || current.inspection === "failed") {
    return "needs_revision";
  }
  if (current.review === "awaiting_review" || current.review === "in_review") return "submitted";

  // FR-REV-005: a rollback restores an earlier approved version byte-identically.
  // The latest version is then `rolled_back`, but the talk is not "missing" — it
  // is running whatever copy the rooms now hold.
  const restored =
    current.review === "rolled_back"
      ? talk.versions.findLast((version) => version.review === "approved")
      : undefined;
  const effective = restored ?? current;

  if (effective.review === "approved") {
    if (talk.roomCopies.length === 0) return "approved";
    const pendingAck = talk.roomCopies.some((copy) => copy.requiresAck && !copy.acknowledged);
    if (pendingAck) return "update_pending_ack";
    const allActive = talk.roomCopies.every((copy) => copy.state === "active");
    return allActive ? "synchronized_onsite" : "approved_delivering";
  }

  return "missing";
}

export type RoomReadiness = "ready" | "attention" | "agent_offline";

/**
 * Room readiness (OBJ-6): every upcoming talk delivered and current, a fresh
 * agent heartbeat, and nothing waiting on acknowledgment. Computed, never asserted.
 */
export function deriveRoomReadiness(input: {
  readonly heartbeatAgeSeconds: number;
  readonly upcomingTalks: readonly TalkSnapshot[];
  readonly heartbeatStaleAfterSeconds?: number;
}): RoomReadiness {
  const staleAfter = input.heartbeatStaleAfterSeconds ?? 300;
  if (input.heartbeatAgeSeconds > staleAfter) return "agent_offline";
  const everyTalkReady = input.upcomingTalks.every(
    (talk) => deriveTalkStatus(talk) === "synchronized_onsite" || deriveTalkStatus(talk) === "canceled",
  );
  return everyTalkReady ? "ready" : "attention";
}
