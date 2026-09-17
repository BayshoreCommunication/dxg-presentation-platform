import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { deriveTalkStatus, deriveRoomReadiness, TALK_STATUS_LABEL } from "./derive.ts";
import type { TalkSnapshot, VersionSnapshot } from "./derive.ts";

const version = (over: Partial<VersionSnapshot> = {}): VersionSnapshot => ({
  processing: "stored",
  inspection: "passed",
  review: "awaiting_review",
  ...over,
});

const talk = (over: Partial<TalkSnapshot> = {}): TalkSnapshot => ({
  sessionState: "scheduled",
  eventArchived: false,
  versions: [version()],
  roomCopies: [],
  ...over,
});

describe("derived talk status — WORKFLOW_STATES §8 priority order", () => {
  test("no version at all is Missing", () => {
    assert.equal(deriveTalkStatus(talk({ versions: [] })), "missing");
  });

  test("a canceled session is Canceled even with no file", () => {
    assert.equal(deriveTalkStatus(talk({ versions: [], sessionState: "canceled" })), "canceled");
  });

  test("an archived event wins over everything", () => {
    assert.equal(
      deriveTalkStatus(talk({ eventArchived: true, versions: [version({ review: "approved" })] })),
      "archived",
    );
  });

  test("quarantine and checksum failure raise Attention", () => {
    for (const processing of ["quarantined", "checksum_failed"] as const) {
      assert.equal(deriveTalkStatus(talk({ versions: [version({ processing })] })), "attention");
    }
  });

  test("intake and inspection read as Processing", () => {
    for (const processing of ["uploading", "uploaded", "scanning"] as const) {
      assert.equal(deriveTalkStatus(talk({ versions: [version({ processing })] })), "processing");
    }
    for (const inspection of ["pending", "inspecting"] as const) {
      assert.equal(deriveTalkStatus(talk({ versions: [version({ inspection })] })), "processing");
    }
  });

  test("changes requested or failed inspection is Needs revision", () => {
    assert.equal(
      deriveTalkStatus(talk({ versions: [version({ review: "changes_requested" })] })),
      "needs_revision",
    );
    assert.equal(
      deriveTalkStatus(talk({ versions: [version({ inspection: "failed" })] })),
      "needs_revision",
    );
  });

  test("a version in the queue is Submitted", () => {
    for (const review of ["awaiting_review", "in_review"] as const) {
      assert.equal(deriveTalkStatus(talk({ versions: [version({ review })] })), "submitted");
    }
  });

  test("the status follows the newest version, not the best one", () => {
    const t = talk({
      versions: [version({ review: "superseded" }), version({ review: "changes_requested" })],
    });
    assert.equal(deriveTalkStatus(t), "needs_revision");
  });
});

describe("derived talk status — approval to room readiness (the causal chain)", () => {
  const approved = version({ review: "approved" });

  test("approved with no room copies yet is Approved", () => {
    assert.equal(deriveTalkStatus(talk({ versions: [approved] })), "approved");
  });

  test("approved and still delivering is Approved — delivering", () => {
    const t = talk({
      versions: [approved],
      roomCopies: [{ state: "syncing", requiresAck: false, acknowledged: false }],
    });
    assert.equal(deriveTalkStatus(t), "approved_delivering");
  });

  test("delivered but unacknowledged is Update pending ack", () => {
    const t = talk({
      versions: [approved],
      roomCopies: [{ state: "synced", requiresAck: true, acknowledged: false }],
    });
    assert.equal(deriveTalkStatus(t), "update_pending_ack");
  });

  test("acknowledged and active in every room is Synchronized onsite", () => {
    const t = talk({
      versions: [approved],
      roomCopies: [
        { state: "active", requiresAck: true, acknowledged: true },
        { state: "active", requiresAck: false, acknowledged: false },
      ],
    });
    assert.equal(deriveTalkStatus(t), "synchronized_onsite");
  });

  test("one lagging room holds the whole talk back", () => {
    const t = talk({
      versions: [approved],
      roomCopies: [
        { state: "active", requiresAck: false, acknowledged: false },
        { state: "sync_failed", requiresAck: false, acknowledged: false },
      ],
    });
    assert.equal(deriveTalkStatus(t), "approved_delivering");
  });
});

describe("room readiness (OBJ-6)", () => {
  const ready: TalkSnapshot = {
    sessionState: "scheduled",
    eventArchived: false,
    versions: [{ processing: "stored", inspection: "passed", review: "approved" }],
    roomCopies: [{ state: "active", requiresAck: false, acknowledged: false }],
  };

  test("a stale heartbeat means the agent is offline, whatever the files say", () => {
    assert.equal(
      deriveRoomReadiness({ heartbeatAgeSeconds: 301, upcomingTalks: [ready] }),
      "agent_offline",
    );
  });

  test("fresh heartbeat and every talk synchronized is Ready", () => {
    assert.equal(deriveRoomReadiness({ heartbeatAgeSeconds: 12, upcomingTalks: [ready] }), "ready");
  });

  test("an unacknowledged update keeps the room out of Ready", () => {
    const pending: TalkSnapshot = {
      ...ready,
      roomCopies: [{ state: "synced", requiresAck: true, acknowledged: false }],
    };
    assert.equal(
      deriveRoomReadiness({ heartbeatAgeSeconds: 12, upcomingTalks: [ready, pending] }),
      "attention",
    );
  });
});

describe("status labels are the baseline's words (VISUAL_ACCEPTANCE §2.2)", () => {
  test("the labels the prototype shows exist verbatim", () => {
    assert.equal(TALK_STATUS_LABEL.update_pending_ack, "Update pending ack");
    assert.equal(TALK_STATUS_LABEL.synchronized_onsite, "Synchronized onsite");
    assert.equal(TALK_STATUS_LABEL.approved_delivering, "Approved — delivering");
    assert.equal(TALK_STATUS_LABEL.missing, "Missing");
  });
});

describe("rollback (FR-REV-005)", () => {
  test("a rolled-back latest version reports the restored copy, not Missing", () => {
    const t = talk({
      versions: [version({ review: "approved" }), version({ review: "rolled_back" })],
      roomCopies: [{ state: "active", requiresAck: false, acknowledged: false }],
    });
    assert.equal(deriveTalkStatus(t), "synchronized_onsite");
  });

  test("a rollback with no room copies yet still reads as Approved", () => {
    const t = talk({
      versions: [version({ review: "approved" }), version({ review: "rolled_back" })],
    });
    assert.equal(deriveTalkStatus(t), "approved");
  });

  test("a rolled-back version with nothing approved behind it is Missing", () => {
    assert.equal(deriveTalkStatus(talk({ versions: [version({ review: "rolled_back" })] })), "missing");
  });
});
