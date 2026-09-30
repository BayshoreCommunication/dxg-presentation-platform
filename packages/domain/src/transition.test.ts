import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { transition, allowedActions } from "./transition.ts";
import type { Lifecycle } from "./transition.ts";
import type { Actor } from "./roles.ts";
import { processingLifecycle } from "./lifecycles/processing.ts";
import { inspectionLifecycle } from "./lifecycles/inspection.ts";
import { reviewLifecycle } from "./lifecycles/review.ts";
import { roomSyncLifecycle } from "./lifecycles/roomSync.ts";
import { sessionLifecycle } from "./lifecycles/session.ts";
import { archiveLifecycle } from "./lifecycles/archive.ts";

const admin: Actor = { id: "u-admin", roles: ["platform_admin"] };
const reviewer: Actor = { id: "u-cr", roles: ["content_reviewer"] };
const manager: Actor = { id: "u-pm", roles: ["presentation_manager"] };
const roomTech: Actor = { id: "u-rt", roles: ["room_technician"] };
const client: Actor = { id: "u-cea", roles: ["client_event_admin"] };

// Every lifecycle, every (state × action) pair — legal ones succeed for an
// authorised actor, and every other pair is refused with an explanation.
const ALL = [
  processingLifecycle,
  inspectionLifecycle,
  reviewLifecycle,
  roomSyncLifecycle,
  sessionLifecycle,
  archiveLifecycle,
] as unknown as Lifecycle<string, string>[];

describe("transition engine — exhaustive table", () => {
  for (const lifecycle of ALL) {
    const actions = [...new Set(lifecycle.rules.map((rule) => rule.action))];

    test(`${lifecycle.name}: every state × action pair is decided`, () => {
      for (const from of lifecycle.states) {
        const legal = new Set(allowedActions(lifecycle, from));
        for (const action of actions) {
          const result = transition(lifecycle, { from, action, actor: admin, reason: "because" });
          if (legal.has(action)) {
            const rule = lifecycle.rules.find((r) => r.from === from && r.action === action);
            assert.ok(rule, "rule must exist for a legal pair");
            if (rule.authority === "machine") {
              assert.equal(result.ok, false, `${from}/${action} is machine-only`);
            } else {
              assert.equal(result.ok, true, `${from}/${action} should be allowed for an admin`);
            }
          } else {
            assert.equal(result.ok, false, `${from}/${action} must be refused`);
            if (!result.ok) {
              assert.equal(result.error.code, `${lifecycle.name}.illegal_transition`);
              assert.equal(result.error.current_state, from);
              assert.match(result.error.message, /Allowed:/);
            }
          }
        }
      }
    });

    test(`${lifecycle.name}: terminal states allow nothing (except documented re-entry)`, () => {
      for (const state of lifecycle.terminal) {
        const allowed = allowedActions(lifecycle, state);
        // Terminal states with a documented, audited way back in.
        const documented = ["quarantined", "obsolete", "expired", "delivered", "superseded"];
        if (!documented.includes(state)) {
          assert.deepEqual(allowed, [], `${state} should be terminal`);
        }
      }
    });
  }
});

describe("transition engine — authority and reasons", () => {
  test("machine-only transitions refuse a human actor", () => {
    const result = transition(processingLifecycle, {
      from: "scanning",
      action: "store",
      actor: admin,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "processing.forbidden");
  });

  test("a role below the bar is refused and told what is required", () => {
    const result = transition(reviewLifecycle, {
      from: "approved",
      action: "roll_back",
      actor: reviewer,
      reason: "wrong deck",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "review.forbidden");
      assert.match(result.error.message, /presentation_manager/);
    }
  });

  test("a client role can never act on the review lifecycle", () => {
    for (const action of ["claim", "approve", "request_changes", "reject"] as const) {
      const result = transition(reviewLifecycle, {
        from: action === "claim" ? "awaiting_review" : "in_review",
        action,
        actor: client,
        reason: "no",
      });
      assert.equal(result.ok, false, `${action} must be refused for a client admin`);
    }
  });

  test("transitions that require a reason refuse an empty one", () => {
    const blank = transition(reviewLifecycle, {
      from: "in_review",
      action: "reject",
      actor: reviewer,
      reason: "   ",
    });
    assert.equal(blank.ok, false);
    if (!blank.ok) assert.equal(blank.error.code, "review.reason_required");

    const given = transition(reviewLifecycle, {
      from: "in_review",
      action: "reject",
      actor: reviewer,
      reason: "off-topic content",
    });
    assert.equal(given.ok, true);
  });
});

describe("transition engine — overrides are audited escape hatches", () => {
  test("an override needs an authorised role", () => {
    const result = transition(reviewLifecycle, {
      from: "awaiting_review",
      action: "approve",
      actor: reviewer,
      reason: "client insisted",
      override: { to: "approved" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "review.override_forbidden");
  });

  test("an override needs a reason", () => {
    const result = transition(reviewLifecycle, {
      from: "awaiting_review",
      action: "approve",
      actor: manager,
      override: { to: "approved" },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "review.reason_required");
  });

  test("an authorised override with a reason succeeds and is marked overridden", () => {
    const result = transition(reviewLifecycle, {
      from: "awaiting_review",
      action: "approve",
      actor: manager,
      reason: "reviewed offline with the client",
      override: { to: "approved" },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.to, "approved");
      assert.equal(result.value.overridden, true);
      assert.equal(result.value.reason, "reviewed offline with the client");
    }
  });

  test("an override cannot invent a state", () => {
    const result = transition(reviewLifecycle, {
      from: "awaiting_review",
      action: "approve",
      actor: manager,
      reason: "typo",
      override: { to: "published" as never },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "review.unknown_state");
  });
});

describe("room sync authority", () => {
  test("the room technician acknowledges; a reviewer cannot", () => {
    const byTech = transition(roomSyncLifecycle, {
      from: "synced",
      action: "acknowledge",
      actor: roomTech,
    });
    assert.equal(byTech.ok, true);

    const byReviewer = transition(roomSyncLifecycle, {
      from: "synced",
      action: "acknowledge",
      actor: reviewer,
    });
    assert.equal(byReviewer.ok, false);
  });
});

describe("D-125 — room PCs are loaded and ticked by hand", () => {
  const srrTech: Actor = { id: "u-srr", roles: ["srr_technician"] };

  test("any not-yet-played copy can be ticked loaded, becoming the copy the room plays", () => {
    for (const from of ["assigned", "syncing", "synced", "sync_failed", "acknowledged"] as const) {
      for (const actor of [roomTech, srrTech, manager]) {
        const result = transition(roomSyncLifecycle, { from, action: "mark_loaded", actor });
        assert.equal(result.ok, true, `${from} by ${actor.roles.join()}`);
        if (result.ok) assert.equal(result.value.to, "active");
      }
    }
  });

  test("no reason is needed to tick or untick", () => {
    const loaded = transition(roomSyncLifecycle, { from: "assigned", action: "mark_loaded", actor: roomTech });
    assert.equal(loaded.ok, true);
    const undone = transition(roomSyncLifecycle, { from: "active", action: "unmark_loaded", actor: roomTech });
    assert.equal(undone.ok, true);
    if (undone.ok) assert.equal(undone.value.to, "assigned");
  });

  test("a content reviewer can neither tick nor untick", () => {
    const tick = transition(roomSyncLifecycle, { from: "assigned", action: "mark_loaded", actor: reviewer });
    assert.equal(tick.ok, false);
    if (!tick.ok) assert.equal(tick.error.code, "room_sync.forbidden");
    const untick = transition(roomSyncLifecycle, { from: "active", action: "unmark_loaded", actor: reviewer });
    assert.equal(untick.ok, false);
  });

  test("a replaced copy cannot be ticked, and a loaded one cannot be ticked twice", () => {
    for (const from of ["obsolete", "active"] as const) {
      const result = transition(roomSyncLifecycle, { from, action: "mark_loaded", actor: manager });
      assert.equal(result.ok, false, from);
      if (!result.ok) assert.equal(result.error.code, "room_sync.illegal_transition");
    }
    const notLoaded = transition(roomSyncLifecycle, { from: "assigned", action: "unmark_loaded", actor: manager });
    assert.equal(notLoaded.ok, false);
  });
});
