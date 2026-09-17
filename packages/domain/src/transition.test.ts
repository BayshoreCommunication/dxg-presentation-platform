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
        const documented = ["quarantined", "obsolete", "expired", "delivered"];
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
