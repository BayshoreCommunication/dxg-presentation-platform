import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { transition, allowedActions } from "../transition.ts";
import type { Actor } from "../roles.ts";
import { processingLifecycle, canEnterLibrary, scanVerdictToAction } from "./processing.ts";
import { reviewLifecycle, isDeliverable } from "./review.ts";
import { roomSyncLifecycle, canLaunch, requiresAcknowledgment } from "./roomSync.ts";
import { isReviewEligible } from "./inspection.ts";

const machine: Actor = { id: "system", roles: [], isMachine: true };
const roomTech: Actor = { id: "u-rt", roles: ["room_technician"] };

describe("I-2 — unscanned files never enter the library", () => {
  test("there is no path to `stored` that skips `scanning`", () => {
    const intoStored = processingLifecycle.rules.filter((rule) => rule.to === "stored");
    assert.equal(intoStored.length, 1);
    assert.equal(intoStored[0]?.from, "scanning");
  });

  test("`uploaded` cannot be stored directly", () => {
    const result = transition(processingLifecycle, { from: "uploaded", action: "store", actor: machine });
    assert.equal(result.ok, false);
  });

  test("a scan error fails closed to quarantine", () => {
    assert.equal(scanVerdictToAction("error"), "quarantine");
    assert.equal(scanVerdictToAction("infected"), "quarantine");
    assert.equal(scanVerdictToAction("clean"), "store");
  });

  test("only `stored` may enter the library", () => {
    for (const state of processingLifecycle.states) {
      assert.equal(canEnterLibrary(state), state === "stored");
    }
  });

  test("releasing a quarantined file re-scans it rather than storing it", () => {
    const release = processingLifecycle.rules.find((rule) => rule.action === "release_quarantine");
    assert.equal(release?.to, "scanning");
    assert.equal(release?.requiresReason, true);
  });
});

describe("I-1 — an approved room copy is never silently replaced", () => {
  test("only an approved version is deliverable", () => {
    for (const state of reviewLifecycle.states) {
      assert.equal(isDeliverable(state), state === "approved");
    }
  });

  test("a version that replaces an active copy requires acknowledgment", () => {
    assert.equal(requiresAcknowledgment(true), true);
    assert.equal(requiresAcknowledgment(false), false);
  });

  test("an unacknowledged copy can never be launched", () => {
    assert.equal(canLaunch({ state: "synced", requiresAck: true, acknowledged: false }), false);
    assert.equal(canLaunch({ state: "active", requiresAck: true, acknowledged: false }), false);
    assert.equal(canLaunch({ state: "active", requiresAck: true, acknowledged: true }), true);
    assert.equal(canLaunch({ state: "active", requiresAck: false, acknowledged: false }), true);
  });

  test("no non-active state is ever launchable", () => {
    for (const state of roomSyncLifecycle.states) {
      if (state === "active") continue;
      assert.equal(
        canLaunch({ state, requiresAck: false, acknowledged: true }),
        false,
        `${state} must not be launchable`,
      );
    }
  });

  test("the SRR path: a new version leaves the room copy alone until it is approved", () => {
    // A USB version arrives and is accepted; the room's copy of v2 stays active.
    const roomCopyOfV2 = "active" as const;
    assert.equal(canLaunch({ state: roomCopyOfV2, requiresAck: false, acknowledged: false }), true);
    // v3 is only queued for the room once review reaches `approved`.
    assert.equal(isDeliverable("awaiting_review"), false);
    // and when it arrives it lands as `synced`, awaiting the technician.
    const ack = transition(roomSyncLifecycle, { from: "synced", action: "acknowledge", actor: roomTech });
    assert.equal(ack.ok, true);
  });
});

describe("I-6 — illegal transitions are rejected with an explanation", () => {
  test("a fully terminal state says so", () => {
    const result = transition(reviewLifecycle, {
      from: "rejected",
      action: "approve",
      actor: { id: "u", roles: ["presentation_manager"] },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.current_state, "rejected");
      assert.match(result.error.message, /Rejected/);
      assert.match(result.error.message, /terminal/);
    }
  });

  test("a state with one legal way out names it", () => {
    const result = transition(reviewLifecycle, {
      from: "superseded",
      action: "approve",
      actor: { id: "u", roles: ["presentation_manager"] },
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error.message, /Superseded/);
      assert.match(result.error.message, /Allowed: restore/);
    }
  });

  test("every state reports its allowed actions", () => {
    for (const state of reviewLifecycle.states) {
      assert.ok(Array.isArray(allowedActions(reviewLifecycle, state)));
    }
  });
});

describe("inspection gates review eligibility (FR-INSP-003)", () => {
  test("a failed inspection blocks review unless every blocking finding is waived", () => {
    assert.equal(isReviewEligible("failed", false), false);
    assert.equal(isReviewEligible("failed", true), true);
    assert.equal(isReviewEligible("technician_review", true), false);
    assert.equal(isReviewEligible("passed_with_warnings", false), true);
  });
});

describe("launch guard input semantics (regression)", () => {
  test("a first delivery that never needed acknowledgment is launchable once active", () => {
    // `acknowledged` is false for a first delivery; that must not block launch.
    assert.equal(canLaunch({ state: "active", requiresAck: false, acknowledged: false }), true);
  });

  test("a replacement sitting in `synced` is not launchable until acknowledged", () => {
    assert.equal(canLaunch({ state: "synced", requiresAck: true, acknowledged: false }), false);
    assert.equal(canLaunch({ state: "acknowledged", requiresAck: true, acknowledged: true }), false);
    assert.equal(canLaunch({ state: "active", requiresAck: true, acknowledged: true }), true);
  });
});

describe("rollback restore (FR-REV-005)", () => {
  test("a superseded version can only be restored by a manager, with a reason", () => {
    const reviewer: Actor = { id: "u-cr", roles: ["content_reviewer"] };
    const manager: Actor = { id: "u-pm", roles: ["presentation_manager"] };

    const byReviewer = transition(reviewLifecycle, {
      from: "superseded",
      action: "restore",
      actor: reviewer,
      reason: "put it back",
    });
    assert.equal(byReviewer.ok, false);

    const noReason = transition(reviewLifecycle, {
      from: "superseded",
      action: "restore",
      actor: manager,
    });
    assert.equal(noReason.ok, false);
    if (!noReason.ok) assert.equal(noReason.error.code, "review.reason_required");

    const good = transition(reviewLifecycle, {
      from: "superseded",
      action: "restore",
      actor: manager,
      reason: "wrong deck approved",
    });
    assert.equal(good.ok, true);
    if (good.ok) assert.equal(good.value.to, "approved");
  });

  test("restore is not a way to revive a rejected or rolled-back version", () => {
    const manager: Actor = { id: "u-pm", roles: ["presentation_manager"] };
    for (const from of ["rejected", "rolled_back"] as const) {
      const result = transition(reviewLifecycle, { from, action: "restore", actor: manager, reason: "x" });
      assert.equal(result.ok, false, `${from} must not be restorable`);
    }
  });
});
