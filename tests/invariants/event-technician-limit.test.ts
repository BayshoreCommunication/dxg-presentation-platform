import { after, before, describe, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { withSystemScope } from "@pmp/db";
import { createStaffAccount } from "../helpers/account.ts";
import { removeTestAccounts, removeTestEvents } from "../helpers/cleanup.ts";
import { signInStaff } from "../helpers/signIn.ts";

const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const RUN = `${Date.now()}-${process.pid}`;
const ACCOUNT_PREFIX = `probe-technician-limit-${RUN}-`;
const EVENT_PREFIX = `Technician Limit Probe ${RUN} `;
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
    email: `${ACCOUNT_PREFIX}${label}@example.invalid`, display_name: `Limit ${label}`, account_type: accountType,
  });
  assert.equal(response.status, 201);
  return (await response.json() as { user_id: string }).user_id;
}

const occupants = (eventId: string) => withSystemScope(async (tx) => (await tx.query<{ id: string }>(
  `SELECT u.id FROM pmp.users u
    WHERE u.account_kind = 'staff' AND u.staff_kind = 'technician' AND NOT u.is_root_admin AND u.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM pmp.event_roles er WHERE er.user_id = u.id AND er.event_id = $1 AND er.role <> 'platform_admin')
    ORDER BY u.id`, [eventId],
)).rows.map((row) => row.id));

const accountState = (userId: string) => withSystemScope(async (tx) => ({
  user: (await tx.query<{ state: unknown }>(`SELECT to_jsonb(u) AS state FROM pmp.users u WHERE id = $1`, [userId])).rows[0]!.state,
  roles: (await tx.query(`SELECT event_id, role FROM pmp.event_roles WHERE user_id = $1 ORDER BY event_id, role`, [userId])).rows,
  sessions: (await tx.query(`SELECT id, revoked_at FROM pmp.auth_sessions WHERE user_id = $1 ORDER BY id`, [userId])).rows,
  audits: (await tx.query(`SELECT seq, action FROM pmp.audit_records WHERE partition_id = $1 ORDER BY seq`, [userId])).rows,
}));

async function conflict(response: Response): Promise<{ detail: { event_id: string; technician_id: string }; message: string }> {
  assert.equal(response.status, 409);
  const body = await response.json() as { code: string; message: string; detail: { event_id: string; technician_id: string } };
  assert.equal(body.code, "admin.event_technician_conflict");
  assert.match(body.message, /Only one technician/);
  return body;
}

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

describe("at most one DXG Technician staff is assigned to each event", () => {
  test("accepts the first, rejects a second, permits same-user reassignment and replacement after removal", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const eventId = await event("normal assignment");
    const first = await account("normal-first");
    const second = await account("normal-second");
    assert.equal((await assign(first, eventId)).status, 200);
    const refused = await conflict(await assign(second, eventId));
    assert.equal(refused.detail.event_id, eventId);
    assert.equal(refused.detail.technician_id, first);
    assert.match(refused.message, /Limit normal-first/);
    assert.deepEqual(await occupants(eventId), [first]);
    assert.equal((await assign(first, eventId)).status, 200);
    assert.equal((await assign(first, eventId, false)).status, 200);
    assert.equal((await assign(second, eventId)).status, 200);
    assert.deepEqual(await occupants(eventId), [second]);
  });

  test("inactive technicians reserve the slot; deletion releases it", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const eventId = await event("inactive reservation");
    const inactive = await account("inactive-first");
    const next = await account("inactive-next");
    assert.equal((await assign(inactive, eventId)).status, 200);
    assert.equal((await call("POST", `/admin/users/${inactive}/active`, { active: false })).status, 200);
    await conflict(await assign(next, eventId));
    assert.deepEqual(await occupants(eventId), [inactive]);
    assert.equal((await call("DELETE", `/admin/users/${inactive}`)).status, 200);
    assert.equal((await assign(next, eventId)).status, 200);
    assert.deepEqual(await occupants(eventId), [next]);
  });

  test("support, clients and root admins with a retained technician kind do not consume the slot", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const eventId = await event("other access levels");
    const root = await account("other-root");
    assert.equal((await convert(root, "root_admin")).status, 200);
    assert.equal((await grant(root, eventId, "project_manager")).status, 200);
    const client = await account("other-client", "client");
    const supportA = await account("other-support-a", "support");
    const supportB = await account("other-support-b", "support");
    for (const userId of [client, supportA, supportB]) assert.equal((await assign(userId, eventId)).status, 200);
    assert.deepEqual(await occupants(eventId), []);
    const technician = await account("other-technician");
    assert.equal((await assign(technician, eventId)).status, 200);
    assert.deepEqual(await occupants(eventId), [technician]);
  });

  test("legacy role grants cannot bypass the limit, even with a non-technician role", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const eventId = await event("legacy grants");
    const first = await account("legacy-first");
    const second = await account("legacy-second");
    assert.equal((await grant(first, eventId, "project_manager")).status, 200);
    await conflict(await grant(second, eventId, "client_event_admin"));
    assert.equal((await grant(first, eventId, "content_reviewer")).status, 200);
    assert.deepEqual(await occupants(eventId), [first]);
    assert.equal((await call("POST", `/events/${eventId}/archive`)).status, 200);
    const archived = await grant(second, eventId);
    assert.equal(archived.status, 409);
    assert.equal((await archived.json() as { code: string }).code, "admin.event_archived_conflict");
  });

  test("conversion checks every membership before changing any kind, role, session or audit", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const events = [await event("conversion empty"), await event("conversion occupied")].sort();
    const occupied = events[1]!;
    const first = await account("conversion-occupant");
    assert.equal((await assign(first, occupied)).status, 200);
    const candidate = await createStaffAccount(API, admin, {
      email: `${ACCOUNT_PREFIX}conversion-candidate@example.invalid`, displayName: "Conversion candidate", password: `Limit-${RUN}-Kq7wZ`,
    });
    for (const eventId of events) assert.equal((await assign(candidate.userId, eventId)).status, 200);
    const beforeState = await accountState(candidate.userId);
    const refused = await conflict(await convert(candidate.userId, "technician"));
    assert.equal(refused.detail.event_id, occupied);
    assert.deepEqual(await accountState(candidate.userId), beforeState, "a refused conversion must commit no partial changes");
    assert.equal((await call("GET", "/auth/session", undefined, candidate.cookie)).status, 200, "refusal must not revoke the session");
    assert.deepEqual(await occupants(events[0]!), []);
    assert.equal((await assign(first, occupied, false)).status, 200);
    assert.equal((await convert(candidate.userId, "technician")).status, 200);
    for (const eventId of events) assert.deepEqual(await occupants(eventId), [candidate.userId]);
  });

  test("two simultaneous assignments cannot both claim the empty slot", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const eventId = await event("concurrent assignments");
    const first = await account("assign-race-a");
    const second = await account("assign-race-b");
    const responses = await Promise.all([assign(first, eventId), assign(second, eventId)]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    await conflict(responses.find((response) => response.status === 409)!);
    assert.equal((await occupants(eventId)).length, 1);
  });

  test("concurrent conversions serialize their shared events in the same order", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const events = [await event("conversion race a"), await event("conversion race b")];
    const first = await account("convert-race-a", "support");
    const second = await account("convert-race-b", "support");
    for (const eventId of events) assert.equal((await assign(first, eventId)).status, 200);
    for (const eventId of [...events].reverse()) assert.equal((await assign(second, eventId)).status, 200);
    const responses = await Promise.all([convert(first, "technician"), convert(second, "technician")]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    await conflict(responses.find((response) => response.status === 409)!);
    const winner = responses[0]!.status === 200 ? first : second;
    for (const eventId of events) assert.deepEqual(await occupants(eventId), [winner]);
  });

  test("historical duplicates remain; reassigning an existing person adds nobody and a third is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const eventId = await event("historical duplicates");
    const first = await account("history-first");
    const second = await account("history-second");
    const third = await account("history-third");
    // A synthetic pre-rule snapshot, never a rewrite of existing event data.
    await withSystemScope((tx) => tx.query(
      `INSERT INTO pmp.event_roles (user_id, event_id, role) VALUES ($1, $3, 'content_reviewer'), ($2, $3, 'content_reviewer')`,
      [first, second, eventId],
    ));
    assert.equal((await assign(first, eventId)).status, 200);
    assert.deepEqual(await occupants(eventId), [first, second].sort());
    await conflict(await assign(third, eventId));
    assert.deepEqual(await occupants(eventId), [first, second].sort());
  });
});
