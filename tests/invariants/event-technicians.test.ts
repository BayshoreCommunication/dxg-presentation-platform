import { after, before, describe, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { withSystemScope } from "@pmp/db";
import { createStaffAccount } from "../helpers/account.ts";
import { removeTestAccounts, removeTestEvents } from "../helpers/cleanup.ts";
import { signInStaff } from "../helpers/signIn.ts";

/**
 * An event has as many DXG Technicians as its rooms need — one per room plus backups
 * (D-192, from the client's review of 2026-10-15). The one-technician limit of D-189 is gone.
 */

const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const RUN = `${Date.now()}-${process.pid}`;
const ACCOUNT_PREFIX = `probe-technicians-${RUN}-`;
const EVENT_PREFIX = `Technicians Probe ${RUN} `;
let up = false;
let admin = "";

const call = (method: string, path: string, body?: unknown, cookie = admin) => fetch(`${API}${path}`, {
  method,
  headers: { "content-type": "application/json", cookie },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const assign = (userId: string, eventId: string, assigned = true) =>
  call("POST", `/admin/users/${userId}/events`, { event_id: eventId, assign: assigned });
const convert = (userId: string, accountType: string) =>
  call("POST", `/admin/users/${userId}/account-type`, { account_type: accountType });
const grant = (userId: string, eventId: string, role = "content_reviewer") =>
  call("POST", `/admin/users/${userId}/roles`, { event_id: eventId, role, grant: true });

async function event(label: string): Promise<string> {
  const response = await call("POST", "/events", {
    client_id: CLIENT, name: `${EVENT_PREFIX}${label}`, venue: "", timezone: "America/New_York",
    starts_on: "2031-11-11", ends_on: "2031-11-12",
  });
  assert.equal(response.status, 201);
  return (await response.json() as { event_id: string }).event_id;
}

async function account(label: string, accountType = "technician"): Promise<string> {
  const response = await call("POST", "/admin/users", {
    email: `${ACCOUNT_PREFIX}${label}@example.invalid`, display_name: `Tech ${label}`, account_type: accountType,
  });
  assert.equal(response.status, 201);
  return (await response.json() as { user_id: string }).user_id;
}

const technicians = (eventId: string) => withSystemScope(async (tx) => (await tx.query<{ id: string }>(
  `SELECT u.id FROM pmp.users u
    WHERE u.account_kind = 'staff' AND u.staff_kind = 'technician' AND NOT u.is_root_admin AND u.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM pmp.event_roles er WHERE er.user_id = u.id AND er.event_id = $1 AND er.role <> 'platform_admin')
    ORDER BY u.id`, [eventId],
)).rows.map((row) => row.id));

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (up) admin = await signInStaff(API, "admin@example.invalid", "dxg-development-password");
});

after(async () => {
  if (!up) return;
  const live = await withSystemScope(async (tx) => (await tx.query<{ id: string }>(
    `SELECT id FROM pmp.users WHERE deleted_at IS NULL AND email::text LIKE $1`, [`${ACCOUNT_PREFIX}%`],
  )).rows);
  for (const row of live) assert.equal((await call("DELETE", `/admin/users/${row.id}`)).status, 200);
  await removeTestAccounts([ACCOUNT_PREFIX]);
  await removeTestEvents([EVENT_PREFIX]);
});

describe("an event takes as many DXG Technicians as its rooms need (D-192)", () => {
  test("a second and third technician join; each holds the full technician set; one leaves without disturbing the rest", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const eventId = await event("several");
    const first = await account("several-first");
    const second = await account("several-second");
    const third = await account("several-third");
    for (const who of [first, second, third]) {
      const placed = await assign(who, eventId);
      assert.equal(placed.status, 200);
      const body = await placed.json() as { assigned: boolean; roles: string[] };
      assert.equal(body.assigned, true);
      assert.deepEqual([...body.roles].sort(), ["content_reviewer", "room_technician", "srr_technician"]);
    }
    assert.deepEqual(await technicians(eventId), [first, second, third].sort());
    // Repeating an assignment adds nobody.
    assert.equal((await assign(second, eventId)).status, 200);
    assert.deepEqual(await technicians(eventId), [first, second, third].sort());
    assert.equal((await assign(second, eventId, false)).status, 200);
    assert.deepEqual(await technicians(eventId), [first, third].sort());
  });

  test("legacy role grants add a technician beside an existing one", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const eventId = await event("legacy grants");
    const first = await account("legacy-first");
    const second = await account("legacy-second");
    assert.equal((await grant(first, eventId, "srr_technician")).status, 200);
    assert.equal((await grant(second, eventId, "room_technician")).status, 200);
    assert.deepEqual(await technicians(eventId), [first, second].sort());
    // Archived events still refuse staffing (D-181).
    assert.equal((await call("POST", `/events/${eventId}/archive`)).status, 200);
    const archived = await grant(await account("legacy-third"), eventId);
    assert.equal(archived.status, 409);
    assert.equal((await archived.json() as { code: string }).code, "admin.event_archived_conflict");
  });

  test("support staff become a technician on events that already have one", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const events = [await event("conversion a"), await event("conversion b")];
    const occupant = await account("conversion-occupant");
    for (const eventId of events) assert.equal((await assign(occupant, eventId)).status, 200);
    const candidate = await createStaffAccount(API, admin, {
      email: `${ACCOUNT_PREFIX}conversion-candidate@example.invalid`, displayName: "Conversion candidate", password: `Tech-${RUN}-Kq7wZ`,
    });
    for (const eventId of events) assert.equal((await assign(candidate.userId, eventId)).status, 200);
    assert.equal((await convert(candidate.userId, "technician")).status, 200);
    for (const eventId of events) assert.deepEqual(await technicians(eventId), [occupant, candidate.userId].sort());
  });

  test("simultaneous assignments both land", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const eventId = await event("concurrent");
    const first = await account("race-a");
    const second = await account("race-b");
    const responses = await Promise.all([assign(first, eventId), assign(second, eventId)]);
    assert.deepEqual(responses.map((response) => response.status), [200, 200]);
    assert.deepEqual(await technicians(eventId), [first, second].sort());
  });

  test("the Speaker Ready Room offers every technician on the event for a check-in", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const eventId = await event("srr choices");
    const first = await account("srr-first");
    const second = await account("srr-second");
    for (const who of [first, second]) assert.equal((await assign(who, eventId)).status, 200);
    const room = await call("GET", `/events/${eventId}/srr`);
    assert.equal(room.status, 200);
    const { technicians: choices } = await room.json() as { technicians: { id: string }[] };
    assert.deepEqual(choices.map((choice) => choice.id).sort(), [first, second].sort());
  });
});
