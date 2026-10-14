import { after, before, describe, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { withSystemScope, verifyAuditChain } from "@pmp/db";
import { createStaffAccount, signInWithSecret } from "../helpers/account.ts";
import { removeTestAccounts } from "../helpers/cleanup.ts";
import { signInStaff } from "../helpers/signIn.ts";

const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const EVENT = "22222222-2222-4222-8222-222222222222";
const PREFIX = `probe-name-${Date.now()}-${process.pid}-`;
const PASSWORD = `Name-${Date.now()}-Kq7wZ`;
let up = false;
let admin = "";
let technician = "";
let support = "";
let userId = "";
let userCookie = "";

const rename = (target: string, displayName: unknown, cookie = admin) => fetch(`${API}/admin/users/${target}/name`, {
  method: "POST",
  headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  body: JSON.stringify({ display_name: displayName }),
});

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", "dxg-development-password");
  technician = await signInStaff(API, "c.delgado@example.invalid", "dxg-development-password");
  support = await signInStaff(API, "m.vega@example.invalid", "dxg-development-password");
  const account = await createStaffAccount(API, admin, {
    email: `${PREFIX}staff@example.invalid`, displayName: "Name Before", password: PASSWORD,
  });
  userId = account.userId;
  userCookie = account.cookie;
  const placed = await fetch(`${API}/admin/users/${userId}/events`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: admin },
    body: JSON.stringify({ event_id: EVENT, assign: true }),
  });
  assert.equal(placed.status, 200, "the synthetic account has event access to preserve");
});

after(async () => {
  if (!up) return;
  try {
    const accounts = await withSystemScope(async (tx) => (await tx.query<{ id: string }>(
      `SELECT id FROM pmp.users WHERE deleted_at IS NULL AND email::text LIKE $1`, [`${PREFIX}%`],
    )).rows);
    for (const account of accounts) {
      const removed = await fetch(`${API}/admin/users/${account.id}`, { method: "DELETE", headers: { cookie: admin } });
      assert.equal(removed.status, 200, "soft-delete this run's test account before removing temporary state");
    }
  } finally {
    // Self-rename audit records keep their actor; soft deletion hides that preserved history row.
    await removeTestAccounts([PREFIX]);
  }
});

const unchangedState = () => withSystemScope(async (tx) => ({
  user: (await tx.query<{ state: Record<string, unknown> }>(
    `SELECT to_jsonb(u) - 'display_name' - 'updated_at' AS state FROM pmp.users u WHERE id = $1`, [userId],
  )).rows[0]!.state,
  roles: (await tx.query(`SELECT event_id, role FROM pmp.event_roles WHERE user_id = $1 ORDER BY event_id, role`, [userId])).rows,
  sessions: (await tx.query(`SELECT id, revoked_at FROM pmp.auth_sessions WHERE user_id = $1 ORDER BY id`, [userId])).rows,
}));

describe("DXG Admin changes a Staff account's display name", () => {
  test("trims and saves the name, keeps authentication/access, and records before/after", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const beforeState = await unchangedState();
    const response = await rename(userId, "  Name After  ");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { display_name: "Name After" });
    assert.deepEqual(await unchangedState(), beforeState, "email, password, MFA, sessions and event roles stay unchanged");

    const session = await fetch(`${API}/auth/session`, { headers: { cookie: userCookie } });
    assert.equal(session.status, 200, "the existing session still works");
    const { principal } = await session.json() as { principal: { user_id: string; display_name: string } };
    assert.equal(principal.user_id, userId);
    assert.equal(principal.display_name, "Name After", "an existing session reads the current name");
    assert.equal((await fetch(`${API}/events/${EVENT}/summary`, { headers: { cookie: userCookie } })).status, 200);

    const audit = await withSystemScope(async (tx) => ({
      record: (await tx.query<{ action: string; subject_type: string; detail: unknown }>(
        `SELECT action, subject_type, detail FROM pmp.audit_records
          WHERE partition_id = $1 AND action = 'admin.name_changed' ORDER BY seq DESC LIMIT 1`, [userId],
      )).rows[0],
      chain: await verifyAuditChain(tx, userId),
    }));
    assert.equal(audit.record?.subject_type, "user");
    assert.deepEqual(audit.record?.detail, {
      before: { display_name: "Name Before" }, after: { display_name: "Name After" },
    });
    assert.deepEqual(audit.chain, { intact: true });
  });

  test("requires a string containing 1–200 characters after trimming", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const invalid = [undefined, null, 12, true, [], {}, "", " \n\t ", "x".repeat(201)];
    for (const value of invalid) {
      const response = await rename(userId, value);
      assert.equal(response.status, 400, `invalid display name ${JSON.stringify(value)}`);
      assert.equal((await response.json() as { code: string }).code, "admin.bad_name");
    }
    const boundary = await rename(userId, `  ${"x".repeat(200)}  `);
    assert.equal(boundary.status, 200);
    assert.deepEqual(await boundary.json(), { display_name: "x".repeat(200) });
  });

  test("refuses technicians, support staff and unsigned callers", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    for (const cookie of [technician, support]) assert.equal((await rename(userId, "Not allowed", cookie)).status, 403);
    assert.equal((await rename(userId, "Not allowed", "")).status, 401);
  });

  test("does not rename missing or deleted accounts", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const malformed = await rename("not-a-user-id", "Missing");
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json() as { code: string }).code, "request.invalid");
    assert.equal((await rename("00000000-0000-4000-8000-000000000000", "Missing")).status, 404);
    const created = await fetch(`${API}/admin/users`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ email: `${PREFIX}deleted@example.invalid`, display_name: "Deleted Probe", password: PASSWORD }),
    });
    assert.equal(created.status, 201);
    const { user_id } = await created.json() as { user_id: string };
    assert.equal((await fetch(`${API}/admin/users/${user_id}`, { method: "DELETE", headers: { cookie: admin } })).status, 200);
    assert.equal((await rename(user_id, "Removed")).status, 404);
  });

  test("speaker accounts are outside the Staff accounts scope", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const speaker = await withSystemScope(async (tx) => (await tx.query<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM pmp.users WHERE account_kind = 'speaker' AND deleted_at IS NULL LIMIT 1`,
    )).rows[0]);
    if (!speaker) return t.skip("seeded speaker account missing");
    assert.equal((await rename(speaker.id, "Not staff")).status, 404);
    const name = await withSystemScope(async (tx) => (await tx.query<{ display_name: string }>(
      `SELECT display_name FROM pmp.users WHERE id = $1`, [speaker.id],
    )).rows[0]!.display_name);
    assert.equal(name, speaker.display_name);
  });

  test("an admin can rename their own account without losing admin access", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const self = await createStaffAccount(API, admin, {
      email: `${PREFIX}self@example.invalid`, displayName: "Own Name Before", password: PASSWORD,
    });
    const promoted = await fetch(`${API}/admin/users/${self.userId}/account-type`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ account_type: "root_admin" }),
    });
    assert.equal(promoted.status, 200);
    // An access-level change intentionally ends existing sessions; sign in as the new admin.
    const selfCookie = await signInWithSecret(API, `${PREFIX}self@example.invalid`, PASSWORD, self.secret);
    assert.equal((await rename(self.userId, "Own Name After", selfCookie)).status, 200);
    const session = await fetch(`${API}/auth/session`, { headers: { cookie: selfCookie } });
    assert.equal(session.status, 200);
    const { principal } = await session.json() as { principal: { display_name: string; is_root_admin: boolean } };
    assert.equal(principal.display_name, "Own Name After");
    assert.equal(principal.is_root_admin, true);
    assert.equal((await fetch(`${API}/admin/users`, { headers: { cookie: selfCookie } })).status, 200);
  });
});
