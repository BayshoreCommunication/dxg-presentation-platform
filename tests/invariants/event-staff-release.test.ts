import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { withSystemScope } from "@pmp/db";
import { releaseEndedEvents, releasingEndedEvents } from "../../apps/api/src/services/eventStaff.ts";
import { signInStaff } from "../helpers/signIn.ts";
import { DELGADO_ID } from "../helpers/technician.ts";

/**
 * D-181: support staff and technicians are freed from an event when it is archived, and the day
 * after it ends — their event roles go (they no longer reach it) and who worked it is kept.
 * Clients and DXG Admins are not released; restoring an event puts nobody back; an archived event
 * takes no new staff.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const VEGA_ID = "33333333-3333-4333-8333-333333333331"; // support staff (seed)
const RUN = Date.now();

let up = false;
let admin = "";
let archivedEvent = "";
let endedEvent = "";

const call = (method: string, path: string, body?: unknown, cookie = admin) =>
  fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const newEvent = async (name: string) =>
  ((await (
    await call("POST", "/events", { client_id: CLIENT, name, venue: "Probe", timezone: "America/New_York", starts_on: "2031-11-11", ends_on: "2031-11-11" })
  ).json()) as { event_id: string }).event_id;
const place = (userId: string, eventId: string, assign = true) =>
  call("POST", `/admin/users/${userId}/events`, { event_id: eventId, assign });
const staffOn = async (eventId: string): Promise<string[]> =>
  withSystemScope(async (tx) =>
    (await tx.query<{ user_id: string }>(
      `SELECT DISTINCT user_id FROM pmp.event_roles WHERE event_id = $1 ORDER BY user_id`,
      [eventId],
    )).rows.map((row) => row.user_id),
  );
const history = async (eventId: string) =>
  withSystemScope(async (tx) =>
    (await tx.query<{ user_id: string; reason: string }>(
      `SELECT DISTINCT user_id, reason FROM pmp.event_staff_history WHERE event_id = $1 ORDER BY user_id`,
      [eventId],
    )).rows,
  );

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);
  archivedEvent = await newEvent(`Staff Release Archive Probe ${RUN}`);
  endedEvent = await newEvent(`Staff Release Ended Probe ${RUN}`);
  for (const eventId of [archivedEvent, endedEvent]) {
    assert.ok((await place(DELGADO_ID, eventId)).ok, "fixture: the technician on the event");
    assert.ok((await place(VEGA_ID, eventId)).ok, "fixture: support staff on the event");
  }
});

after(async () => {
  if (!up) return;
  for (const eventId of [archivedEvent, endedEvent]) if (eventId) await call("POST", `/events/${eventId}/archive`);
});

describe("staff are freed from a finished event (D-181)", () => {
  test("archiving frees support staff and technicians, keeps who worked it, and cuts their access", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const technician = await signInStaff(API, "c.delgado@example.invalid", PASSWORD);
    assert.equal((await call("GET", `/events/${archivedEvent}/srr`, undefined, technician)).status, 200, "on the event, they reach it");

    assert.equal((await call("POST", `/events/${archivedEvent}/archive`)).status, 200);
    assert.deepEqual(await staffOn(archivedEvent), [], "nobody is assigned any more");
    assert.deepEqual(
      (await history(archivedEvent)).map((row) => [row.user_id, row.reason]),
      [[VEGA_ID, "archived"], [DELGADO_ID, "archived"]].sort(),
      "both kept as having worked it",
    );
    assert.notEqual((await call("GET", `/events/${archivedEvent}/srr`, undefined, technician)).status, 200, "and they no longer reach it");

    const audited = await withSystemScope(async (tx) =>
      (await tx.query(`SELECT 1 FROM pmp.audit_records WHERE action = 'events.staff_released' AND subject_id = $1`, [archivedEvent])).rows.length,
    );
    assert.equal(audited, 1);
  });

  test("an archived event takes no new staff; restoring it puts nobody back", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const refused = await place(DELGADO_ID, archivedEvent);
    assert.equal(refused.status, 409);
    assert.equal(((await refused.json()) as { code: string }).code, "admin.event_archived_conflict");

    assert.equal((await call("POST", `/events/${archivedEvent}/restore`)).status, 200);
    assert.deepEqual(await staffOn(archivedEvent), [], "restored, it has nobody until someone is assigned");
    assert.ok((await place(DELGADO_ID, archivedEvent)).ok, "restored, staff can be assigned again");
  });

  test("the day after an event's last day, its staff are freed", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    // Its last day moved to yesterday, on the event's own clock.
    await withSystemScope((tx) =>
      tx.query(
        `UPDATE pmp.events SET starts_on = (now() AT TIME ZONE timezone)::date - 2, ends_on = (now() AT TIME ZONE timezone)::date - 1 WHERE id = $1`,
        [endedEvent],
      ),
    );
    const done = await withSystemScope((tx) => releaseEndedEvents(tx, [endedEvent]));
    assert.deepEqual(done, [{ event_id: endedEvent, released: 2 }]);
    assert.deepEqual(await staffOn(endedEvent), []);
    assert.ok((await history(endedEvent)).every((row) => row.reason === "ended"));
    // Nothing more to do on the next run.
    assert.deepEqual(await withSystemScope((tx) => releaseEndedEvents(tx, [endedEvent])), []);
  });

  test("an event that hasn't ended keeps its staff", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    // archivedEvent was restored and its technician assigned again; its last day is in 2031.
    assert.deepEqual(await withSystemScope((tx) => releaseEndedEvents(tx, [archivedEvent])), []);
    assert.deepEqual(await staffOn(archivedEvent), [DELGADO_ID]);
  });

  test("the history is for DXG Admins", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const rows = (await (await call("GET", "/admin/assignments/history")).json()) as { items: { event_id: string }[] };
    assert.ok(rows.items.some((row) => row.event_id === endedEvent));
    const support = await signInStaff(API, "m.vega@example.invalid", PASSWORD);
    assert.equal((await call("GET", "/admin/assignments/history", undefined, support)).status, 403);
  });

  test("the worker frees ended events in production, and elsewhere only when asked", () => {
    assert.equal(releasingEndedEvents({ NODE_ENV: "production" }), true);
    assert.equal(releasingEndedEvents({ NODE_ENV: "development" }), false);
    assert.equal(releasingEndedEvents({ NODE_ENV: "development", RELEASE_ENDED_EVENTS: "1" }), true);
    assert.equal(releasingEndedEvents({ NODE_ENV: "production", RELEASE_ENDED_EVENTS: "0" }), false);
  });
});
