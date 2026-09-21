import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { createStaffAccount, grantRole } from "../helpers/account.ts";
import { removeTestAccounts, removeTestEvents } from "../helpers/cleanup.ts";
import { withSystemScope } from "@pmp/db";

/**
 * BUILD_SPEC I-4: "Cross-event access is blocked, logged and alerted."
 *
 * D-025 enforced this at `scopeFor`, which every `/events/{eventId}/…` route passes
 * through — and left every route that names its resource directly untouched, because
 * those call `scopeFor(req)` with no event to check against. `GET /slots/{id}` does not
 * mention an event in its path; the event is a property of the slot, and nothing was
 * looking it up.
 *
 * The second half is subtler. `rolesFor` selected `DISTINCT role` with no event filter,
 * so the principal carried a flat set and `scopeFor` could only ask *whether* the
 * account held a role on the event, never *which*. A room technician on this event who
 * is a content reviewer on any other reviewed presentations here.
 *
 * Both are proved against an account that genuinely holds no role on the event the
 * resources belong to, because every seeded account holds one on the event that carries
 * all the content.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const MEDTECH = "22222222-2222-4222-8222-222222222222";
/*
 * A fresh identity each run. The account is refused things on purpose, and each
 * refusal writes `security.cross_event_attempt` against it — so `removeTestAccounts`
 * deactivates it rather than deleting it, which is the right call (history stays) and
 * means the address is taken by the time the suite runs again.
 */
const OUTSIDER_EMAIL = `probe-outsider-${Date.now()}@example.invalid`;
const UNDERSTUDY_EMAIL = `probe-understudy-${Date.now()}@example.invalid`;
const OUTSIDER_PASSWORD = "probe-outsider-password";
const PROBE_EVENT = "Cross Event Probe";

let up = false;
let admin = "";
let outsider = "";
/** On MedTech Forward, but only as a room technician — and a manager elsewhere. */
let understudy = "";
let outsiderId = "";
let probeEventId = "";

/** MedTech Forward's own resources, which the outsider must not reach. */
let slotId = "";
let versionId = "";
let roomId = "";
let speakerId = "";

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;

  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);

  const events = (await (await fetch(`${API}/events`, { headers: { cookie: admin } })).json()) as {
    items: { id: string; name: string }[];
  };
  probeEventId =
    events.items.find((event) => event.name === PROBE_EVENT)?.id ??
    (
      (await (
        await fetch(`${API}/events`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie: admin },
          body: JSON.stringify({
            name: PROBE_EVENT,
            venue: "Elsewhere",
            timezone: "America/New_York",
            starts_on: "2027-06-01",
            ends_on: "2027-06-02",
          }),
        })
      ).json()) as { event_id: string }
    ).event_id;

  // A real staff account holding a real role — on the wrong event.
  const account = await createStaffAccount(API, admin, {
    email: OUTSIDER_EMAIL,
    displayName: "Probe Outsider",
    password: OUTSIDER_PASSWORD,
  });
  outsider = account.cookie;
  outsiderId = account.userId;
  await grantRole(API, admin, account.userId, probeEventId, "presentation_manager");

  /*
   * The decisive actor for the second half. They hold a role on MedTech Forward, so
   * the path resolver lets them through — and the role they hold there is
   * `room_technician`, while on the probe event they are a `project_manager`.
   * Anything requiring a manager on MedTech must therefore be refused.
   */
  const second = await createStaffAccount(API, admin, {
    email: UNDERSTUDY_EMAIL,
    displayName: "Probe Understudy",
    password: OUTSIDER_PASSWORD,
  });
  understudy = second.cookie;
  await grantRole(API, admin, second.userId, MEDTECH, "room_technician");
  await grantRole(API, admin, second.userId, probeEventId, "project_manager");

  // Resources belonging to MedTech Forward, found the way the app finds them.
  const talks = (await (
    await fetch(`${API}/events/${MEDTECH}/talks`, { headers: { cookie: admin } })
  ).json()) as { items: { slot_id: string }[] };
  slotId = talks.items[0]?.slot_id ?? "";

  const queue = (await (
    await fetch(`${API}/events/${MEDTECH}/review-queue`, { headers: { cookie: admin } })
  ).json()) as { items: { file_version_id: string }[] };
  versionId = queue.items[0]?.file_version_id ?? "";

  const fleet = (await (
    await fetch(`${API}/events/${MEDTECH}/sync/fleet`, { headers: { cookie: admin } })
  ).json()) as { items: { room_id: string }[] };
  roomId = fleet.items[0]?.room_id ?? "";

  const speakers = (await (
    await fetch(`${API}/events/${MEDTECH}/speakers`, { headers: { cookie: admin } })
  ).json()) as { items: { id: string }[] };
  speakerId = speakers.items[0]?.id ?? "";
});

const asOutsider = (path: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie: outsider, ...(init.headers ?? {}) },
  });

describe("a resource named directly still belongs to its event", () => {
  test("the outsider can reach the event they are actually on", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await fetch(`${API}/events/${probeEventId}/summary`, {
      headers: { cookie: outsider },
    });
    assert.equal(response.status, 200, "holding a role somewhere must still work");
  });

  test("reading another event's talk is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.ok(slotId, "fixture: MedTech has a talk");
    const response = await asOutsider(`/slots/${slotId}`);
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    assert.equal(response.status, 403, `got ${response.status}`);
    assert.equal(body.code, "auth.not_on_this_event");
  });

  test("reading another event's inspection findings is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.ok(versionId, "fixture: MedTech has a file version in review");
    const response = await asOutsider(`/file-versions/${versionId}/findings`);
    assert.equal(response.status, 403);
  });

  test("reading another event's comments is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await asOutsider(`/file-versions/${versionId}/comments`);
    assert.equal(response.status, 403);
  });

  test("writing an internal comment on another event is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await asOutsider(`/file-versions/${versionId}/comments`, {
      method: "POST",
      body: JSON.stringify({ lane: "internal", body: "cross-event probe" }),
    });
    assert.equal(response.status, 403, "this one succeeded with 201 before the fix");
  });

  test("deciding another event's review is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await asOutsider(`/file-versions/${versionId}:transition`, {
      method: "POST",
      body: JSON.stringify({ action: "claim", lock_version: 0 }),
    });
    assert.equal(response.status, 403, "approving another client's presentation");
  });

  test("another event's room and speakers are refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.ok(roomId && speakerId, "fixture: MedTech has a room and a speaker");
    assert.equal((await asOutsider(`/rooms/${roomId}/agent-view`)).status, 403);
    assert.equal(
      (await asOutsider(`/speakers/${speakerId}/credentials`, { method: "POST" })).status,
      403,
      "issuing a speaker credential is issuing access to their material",
    );
  });

  test("a resource that does not exist is not confirmed to exist", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await asOutsider(`/slots/00000000-0000-4000-8000-000000000000`);
    assert.equal(response.status, 404, "a made-up id is not found, not forbidden");
  });

  test("the attempt is written to the audit (I-4: blocked, logged)", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await asOutsider(`/slots/${slotId}`);
    /*
     * Read from the database rather than over HTTP: `audit:verify` answers whether the
     * chain is intact and exposes no entries, and a security record nobody can read is
     * not a record. Asserted here until there is a surface for it.
     */
    const found = await withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pmp.audit_records
          WHERE partition_id = $1 AND action = 'security.cross_event_attempt'`,
        [MEDTECH],
      );
      return Number(rows[0]?.n ?? 0);
    });
    assert.ok(found > 0, "a refused cross-event reach must leave a record");
  });
});

describe("a role is held on an event, not on the platform", () => {
  test("a role held elsewhere does not confer its powers here", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    /*
     * The understudy IS on MedTech Forward, so the path check above lets them past —
     * this is the case that check cannot see. They are a room technician here and a
     * presentation manager on the probe event; waiving a finding requires a manager.
     *
     * With the flat role set the question asked was "is this account a presentation
     * manager anywhere?", and the answer was yes.
     */
    const findings = (await (
      await fetch(`${API}/file-versions/${versionId}/findings`, { headers: { cookie: admin } })
    ).json()) as { items: { id: string }[] };
    const findingId = findings.items[0]?.id;
    assert.ok(findingId, "fixture: the version has a finding");

    const response = await fetch(`${API}/findings/${findingId}/waive`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: understudy },
      body: JSON.stringify({ reason: "cross-event probe" }),
    });
    const body = (await response.json().catch(() => ({}))) as { code?: string };
    assert.equal(response.status, 403, `a room technician here must not waive; got ${response.status}`);
    assert.notEqual(body.code, "auth.not_on_this_event", "refused for the right reason, not the path check");
  });

  test("the role they do hold here still works", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    // The control: scoping roles to the event must not lock people out of their own.
    const response = await fetch(`${API}/events/${MEDTECH}/sync/fleet`, {
      headers: { cookie: understudy },
    });
    assert.equal(response.status, 200, "a room technician reads the room fleet");
  });

  test("a manager on one event cannot grant roles on another", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    /*
     * The event is in the body, not the path, so the resolver cannot see it — and the
     * flat role set answered "is this account a project manager anywhere?". Granting
     * yourself a role on another event is the escalation that makes every other check
     * on this page moot.
     */
    const response = await fetch(`${API}/admin/users/${outsiderId}/roles`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: understudy },
      body: JSON.stringify({ event_id: MEDTECH, role: "presentation_manager", grant: true }),
    });
    assert.equal(response.status, 403, `a room technician here must not grant roles; got ${response.status}`);
  });

  test("a platform admin still crosses events, because bootstrapping depends on it", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await fetch(`${API}/slots/${slotId}`, { headers: { cookie: admin } });
    assert.equal(response.status, 200);
  });
});

after(async () => {
  if (!up) return;
  await removeTestAccounts(["probe-outsider-", "probe-understudy-"]);
  await removeTestEvents([PROBE_EVENT]);
});
