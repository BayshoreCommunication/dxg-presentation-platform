import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { withSystemScope } from "@pmp/db";
import { signInStaff } from "../helpers/signIn.ts";
import { removeTestAccounts, removeTestEvents } from "../helpers/cleanup.ts";
import { createStaffAccount } from "../helpers/account.ts";

/**
 * Account administration is the one place an account can be created or handed
 * back to someone, so it has to refuse the wrong caller and refuse the actions
 * that would leave nobody able to administer anything.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const EVENT = "22222222-2222-4222-8222-222222222222";
const PASSWORD = "dxg-development-password";

let up = false;
let admin = "";
let manager = "";
let presentationManager = "";
/** Temporary passwords are emailed, never returned (D-100); suites that sign in supply one. */
const ISSUED = `Temp-${Date.now()}-Kq7wZ`;

const json = async (response: Response) => (await response.json()) as Record<string, unknown>;

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);
  manager = await signInStaff(API, "c.delgado@example.invalid", PASSWORD);
  presentationManager = await signInStaff(API, "m.vega@example.invalid", PASSWORD);
});

const me = async (cookie: string) =>
  ((await json(await fetch(`${API}/auth/session`, { headers: { cookie } }))) as { principal: { user_id: string } })
    .principal.user_id;

const create = (body: Record<string, unknown>) =>
  fetch(`${API}/admin/users`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: admin },
    body: JSON.stringify(body),
  });

describe("only an admin administers accounts", () => {
  const paths = ["/admin/users"];

  for (const path of paths) {
    test(`a content reviewer is refused ${path}`, async (t: TestContext) => {
      if (!up || !manager) return t.skip("API not running");
      const response = await fetch(`${API}${path}`, { headers: { cookie: manager } });
      assert.equal(response.status, 403);
    });
  }

  test("a content reviewer cannot create an account", async (t: TestContext) => {
    if (!up || !manager) return t.skip("API not running");
    const response = await fetch(`${API}/admin/users`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: manager },
      body: JSON.stringify({ email: "sneaky@example.invalid", display_name: "Sneaky" }),
    });
    assert.equal(response.status, 403);
  });

  test("a manager who is staff cannot see the account list (D-100)", async (t: TestContext) => {
    if (!up || !presentationManager) return t.skip("API not running");
    const response = await fetch(`${API}/admin/users`, { headers: { cookie: presentationManager } });
    assert.equal(response.status, 403, "staff must not see root admins or other staff");
  });

  test("a manager who is staff cannot create, delete or promote accounts", async (t: TestContext) => {
    if (!up || !presentationManager) return t.skip("API not running");
    const headers = { "content-type": "application/json", cookie: presentationManager };
    const adminId = await me(admin);
    const created = await fetch(`${API}/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email: "sneaky-pm@example.invalid", display_name: "Sneaky", account_type: "root_admin" }),
    });
    assert.equal(created.status, 403);
    const removed = await fetch(`${API}/admin/users/${adminId}`, { method: "DELETE", headers });
    assert.equal(removed.status, 403);
    const promoted = await fetch(`${API}/admin/users/${await me(presentationManager)}/account-type`, {
      method: "POST",
      headers,
      body: JSON.stringify({ account_type: "root_admin" }),
    });
    assert.equal(promoted.status, 403);
  });

  test("the session says whether the account is a root admin", async (t: TestContext) => {
    if (!up || !admin || !presentationManager) return t.skip("API not running");
    const read = async (cookie: string) =>
      ((await json(await fetch(`${API}/auth/session`, { headers: { cookie } }))) as {
        principal: { is_root_admin: boolean };
      }).principal.is_root_admin;
    assert.equal(await read(admin), true);
    assert.equal(await read(presentationManager), false);
  });

  test("an admin can list accounts", async (t: TestContext) => {
    if (!up || !admin) return t.skip("API not running");
    const response = await fetch(`${API}/admin/users`, { headers: { cookie: admin } });
    assert.equal(response.status, 200);
    const body = (await json(response)) as { items: { email: string; account_type: string }[] };
    assert.ok(body.items.length > 0);
    assert.equal(body.items.find((user) => user.email === "admin@example.invalid")?.account_type, "root_admin");
    // "staff" became "support" (D-151): the old name is still accepted on the way in.
    assert.equal(body.items.find((user) => user.email === "m.vega@example.invalid")?.account_type, "support");
  });
});

describe("administration cannot lock everyone out", () => {
  test("an admin cannot deactivate themselves", async (t: TestContext) => {
    if (!up || !admin) return t.skip("API not running");
    const session = (await json(await fetch(`${API}/auth/session`, { headers: { cookie: admin } }))) as {
      principal: { user_id: string };
    };
    const response = await fetch(`${API}/admin/users/${session.principal.user_id}/active`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ active: false }),
    });
    assert.equal(response.status, 422);
    assert.equal((await json(response)).code, "admin.self_lockout");
  });

  test("a root admin cannot delete themselves or make themselves staff", async (t: TestContext) => {
    if (!up || !admin) return t.skip("API not running");
    const self = await me(admin);
    const removed = await fetch(`${API}/admin/users/${self}`, { method: "DELETE", headers: { cookie: admin } });
    assert.equal(removed.status, 422);
    assert.equal((await json(removed)).code, "admin.self_lockout");
    const demoted = await fetch(`${API}/admin/users/${self}/account-type`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ account_type: "staff" }),
    });
    assert.equal(demoted.status, 422);
    assert.equal((await json(demoted)).code, "admin.self_lockout");
  });

  test("root admin is not handed out as an event role", async (t: TestContext) => {
    if (!up || !admin) return t.skip("API not running");
    const target = await me(presentationManager);
    const response = await fetch(`${API}/admin/users/${target}/roles`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ event_id: EVENT, role: "platform_admin", grant: true }),
    });
    assert.equal((await json(response)).code, "admin.unknown_role");
  });

  test("resetting an authenticator needs a reason", async (t: TestContext) => {
    if (!up || !admin) return t.skip("API not running");
    const users = (await json(await fetch(`${API}/admin/users`, { headers: { cookie: admin } }))) as {
      items: { id: string; email: string; mfa_enrolled: boolean }[];
    };
    const target = users.items.find((user) => user.email === "t.okafor@example.invalid");
    if (!target) return t.skip("fixture account missing");

    const withoutReason = await fetch(`${API}/admin/users/${target.id}/reset-mfa`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ reason: "   " }),
    });
    assert.equal(withoutReason.status, 422);
    assert.equal((await json(withoutReason)).code, "admin.reason_required");
  });
});

describe("a created account starts locked down", () => {
  test("an account with no roles at all is refused the staff surface", async (t: TestContext) => {
    if (!up || !admin) return t.skip("API not running");
    const email = `roleless-${Date.now()}@example.invalid`;
    const created = (await json(
      await fetch(`${API}/admin/users`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ email, display_name: "Roleless", password: ISSUED }),
      }),
    )) as { user_id: string };

    const login = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: ISSUED }),
    });
    assert.ok(created.user_id);
    const cookie = (login.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; ");
    // The sign-in app comes first (D-108): a new account is sent to set it up, not told
    // it has no access.
    const first = await fetch(`${API}/events`, { headers: { cookie } });
    assert.equal(first.status, 403);
    assert.equal((await json(first)).code, "auth.mfa_required");

    // Set up, but on no event yet: now it is told so.
    const enrolled = await createStaffAccount(API, admin, {
      email: `roleless-enrolled-${Date.now()}@example.invalid`,
      displayName: "Roleless Enrolled",
      password: `Roleless-${Date.now()}-Kq7wZ`,
    });
    const blocked = await fetch(`${API}/events`, { headers: { cookie: enrolled.cookie } });
    assert.equal(blocked.status, 403);
    assert.equal((await json(blocked)).code, "auth.not_staff");
  });

  test("changing the password keeps the session that changed it (D-108)", async (t: TestContext) => {
    if (!up || !admin) return t.skip("API not running");
    const email = `roleless-pw-${Date.now()}@example.invalid`;
    await fetch(`${API}/admin/users`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ email, display_name: "Password Keeper", password: ISSUED }),
    });
    const login = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: ISSUED }),
    });
    const cookie = (login.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; ");
    const changed = await fetch(`${API}/auth/password`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ current_password: ISSUED, new_password: `Kept-${Date.now()}-Zq8wX` }),
    });
    assert.equal(changed.status, 200);
    const session = await fetch(`${API}/auth/session`, { headers: { cookie } });
    assert.equal(session.status, 200, "still signed in, ready for sign-in app setup");
  });

  test("a staff account must change its password and enrol before doing anything", async (t: TestContext) => {
    if (!up || !admin) return t.skip("API not running");
    const email = `probe-admin-${Date.now()}@example.invalid`;
    const created = (await json(
      await fetch(`${API}/admin/users`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ email, display_name: "Probe", password: ISSUED }),
      }),
    )) as { user_id: string };

    // Give it a staff role, so what is being tested is the MFA gate rather than
    // the earlier "this account has no staff role" refusal.
    await fetch(`${API}/admin/users/${created.user_id}/roles`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ event_id: EVENT, role: "content_reviewer" }),
    });

    const login = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: ISSUED }),
    });
    const body = (await json(login)) as { principal: { must_change_password: boolean; mfa_enrolled: boolean } };
    assert.equal(body.principal.must_change_password, true);
    assert.equal(body.principal.mfa_enrolled, false);

    const cookie = (login.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; ");
    const blocked = await fetch(`${API}/events`, { headers: { cookie } });
    assert.equal(blocked.status, 403, "an unenrolled account should reach nothing but enrolment");
    assert.equal((await json(blocked)).code, "auth.mfa_required");
  });
});

describe("temporary passwords are emailed, not shown (D-100)", () => {
  test("creating an account emails the password and returns none", async (t: TestContext) => {
    if (!up || !admin) return t.skip("API not running");
    const email = `probe-admin-mail-${Date.now()}@example.invalid`;
    const response = await create({ email, display_name: "Mail Probe", account_type: "staff" });
    assert.equal(response.status, 201);
    const body = await json(response);
    assert.equal(body.emailed_to, email);
    assert.equal(body.account_type, "support");
    assert.equal("temporary_password" in body, false, "the password must never come back to the administrator");
  });

  test("resetting a password emails it and returns none", async (t: TestContext) => {
    if (!up || !admin) return t.skip("API not running");
    const email = `probe-admin-reset-${Date.now()}@example.invalid`;
    const created = (await json(await create({ email, display_name: "Reset Mail Probe", password: ISSUED }))) as {
      user_id: string;
    };
    const response = await fetch(`${API}/admin/users/${created.user_id}/reset-password`, {
      method: "POST",
      headers: { cookie: admin },
    });
    assert.equal(response.status, 200);
    const body = await json(response);
    assert.equal(body.emailed_to, email);
    assert.equal("temporary_password" in body, false);
  });
});

describe("root admins and staff (D-100)", () => {
  test("a root admin can be created, and can make another account a root admin and back", async (t: TestContext) => {
    if (!up || !admin) return t.skip("API not running");
    const email = `probe-admin-root-${Date.now()}@example.invalid`;
    const created = (await json(await create({ email, display_name: "Root Probe", account_type: "root_admin", password: ISSUED }))) as {
      user_id: string;
      account_type: string;
    };
    assert.equal(created.account_type, "root_admin");

    const demoted = await fetch(`${API}/admin/users/${created.user_id}/account-type`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ account_type: "staff" }),
    });
    assert.equal(demoted.status, 200, "another root admin exists, so this one may become staff");
    const list = (await json(await fetch(`${API}/admin/users`, { headers: { cookie: admin } }))) as {
      items: { id: string; account_type: string }[];
    };
    assert.equal(list.items.find((user) => user.id === created.user_id)?.account_type, "support");
  });

  test("an unknown account type is refused", async (t: TestContext) => {
    if (!up || !admin) return t.skip("API not running");
    const response = await create({ email: `probe-admin-bad-${Date.now()}@example.invalid`, account_type: "god" });
    assert.equal((await json(response)).code, "auth.bad_account_type");
  });

  test("a deleted account disappears, cannot sign in, and frees its address", async (t: TestContext) => {
    if (!up || !admin) return t.skip("API not running");
    const email = `probe-admin-del-${Date.now()}@example.invalid`;
    const created = (await json(await create({ email, display_name: "Delete Probe", password: ISSUED }))) as {
      user_id: string;
    };
    await fetch(`${API}/admin/users/${created.user_id}/roles`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ event_id: EVENT, role: "content_reviewer" }),
    });

    const removed = await fetch(`${API}/admin/users/${created.user_id}`, {
      method: "DELETE",
      headers: { cookie: admin },
    });
    assert.equal(removed.status, 200);

    const list = (await json(await fetch(`${API}/admin/users`, { headers: { cookie: admin } }))) as {
      items: { id: string }[];
    };
    assert.equal(list.items.some((user) => user.id === created.user_id), false, "deleted accounts are not listed");

    const login = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: ISSUED }),
    });
    assert.equal(login.ok, false, "a deleted account cannot sign in");

    const again = await create({ email, display_name: "Delete Probe Again", password: ISSUED });
    assert.equal(again.status, 201, "the address can be invited again");

    const twice = await fetch(`${API}/admin/users/${created.user_id}`, { method: "DELETE", headers: { cookie: admin } });
    assert.equal(twice.status, 404);
  });

  test("a staff member who creates an event becomes its project manager", async (t: TestContext) => {
    if (!up || !presentationManager) return t.skip("API not running");
    const created = await fetch(`${API}/events`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: presentationManager },
      body: JSON.stringify({
        client_id: "11111111-1111-4111-8111-111111111111",
        name: `probe-admin-event-${Date.now()}`,
        starts_on: "2027-01-10",
        ends_on: "2027-01-11",
        timezone: "America/New_York",
      }),
    });
    if (created.status !== 201) return t.skip(`could not create an event (${created.status})`);
    const { event_id } = (await json(created)) as { event_id: string };
    const opened = await fetch(`${API}/events/${event_id}/draft`, { headers: { cookie: presentationManager } });
    assert.equal(opened.status, 200, "the creator must be able to open their own new event");
  });
});

/*
 * The accounts this suite created are its own, so it takes them away again. Without
 * this every run left another `probe-…` row in Staff accounts, and the only way to
 * clear them was wiping the database — which took real work with it.
 */
after(async () => {
  if (!up) return;
  // Its own prefixes only. `"probe-"` also matched other suites' accounts
  // (`probe-brand-reviewer-…`, `probe-outsider-…`) and deleted them mid-setup whenever the
  // suites ran at the same time — which they do once sign-in no longer queues them.
  await removeTestAccounts(["roleless-", "probe-admin-", "probe-kind-"]);
  await removeTestEvents(["probe-admin-event-"]);
});

describe("three kinds of DXG account (D-151)", () => {
  const EVENT_ID = "22222222-2222-4222-8222-222222222222";

  test("support staff run the Speaker Ready Room and review on Manage presentations; technicians open nothing else", async (t: TestContext) => {
    if (!up || !presentationManager) return t.skip("API not running");
    const technician = await signInStaff(API, "c.delgado@example.invalid", PASSWORD);
    // m.vega is support staff (seed): the event is theirs, the Speaker Ready Room too (D-164) —
    // but not taking a speaker's file in (D-162).
    assert.equal((await fetch(`${API}/events/${EVENT_ID}/srr`, { headers: { cookie: presentationManager } })).status, 200);
    const upload = await fetch(`${API}/srr/uploads`, { method: "POST", headers: { "content-type": "application/json", cookie: presentationManager }, body: "{}" });
    assert.equal(upload.status, 403);
    assert.equal(((await json(upload)) as { code: string }).code, "auth.technician_only");
    // Since D-163 they review on Manage presentations: the queue opens, and a decision reaches the
    // review rules rather than being refused by kind.
    assert.equal((await fetch(`${API}/events/${EVENT_ID}/review-queue`, { headers: { cookie: presentationManager } })).status, 200);
    // A real version of the event, so a refusal would be the kind rule and not "not found". The
    // stale lock version (0) means nothing changes whoever asks.
    const anyVersion = await withSystemScope(async (tx) =>
      (await tx.query<{ id: string }>(`SELECT id FROM pmp.file_versions WHERE event_id = $1 AND lock_version > 0 LIMIT 1`, [EVENT_ID])).rows[0]!.id,
    );
    const sendBack = await fetch(`${API}/file-versions/${anyVersion}:transition`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: presentationManager },
      body: JSON.stringify({ action: "request_changes", lock_version: 0, note: "probe" }),
    });
    assert.notEqual(((await json(sendBack)) as { code: string }).code, "auth.kind_forbidden", "support staff may ask for changes");
    assert.equal((await fetch(`${API}/events/${EVENT_ID}/speakers`, { headers: { cookie: presentationManager } })).status, 200);
    // Support staff may look at a talk (the Files screen and the agenda open one) but not decide on it.
    const talks = (await json(await fetch(`${API}/events/${EVENT_ID}/talks`, { headers: { cookie: presentationManager } }))) as {
      items: { slot_id: string }[];
    };
    const slot = talks.items[0]!.slot_id;
    assert.equal((await fetch(`${API}/slots/${slot}`, { headers: { cookie: presentationManager } })).status, 200);
    const decide = await fetch(`${API}/slots/${slot}/roll-back`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: presentationManager },
      body: JSON.stringify({ target_version_id: "00000000-0000-4000-8000-000000000000", reason: "probe" }),
    });
    assert.equal(decide.status, 403);
    assert.equal(((await json(decide)) as { code: string }).code, "auth.kind_forbidden");
    // c.delgado is a technician (seed): the two screens and the way to them, nothing else.
    assert.equal((await fetch(`${API}/events/${EVENT_ID}/srr`, { headers: { cookie: technician } })).status, 200);
    assert.equal((await fetch(`${API}/events/${EVENT_ID}/summary`, { headers: { cookie: technician } })).status, 200);
    // Looking at a file in review asks for its slide preview (a POST): that is their job too.
    const queue = (await json(await fetch(`${API}/events/${EVENT_ID}/review-queue`, { headers: { cookie: admin } }))) as {
      items: { file_version_id: string }[];
    };
    if (queue.items[0]) {
      const preview = await fetch(`${API}/file-versions/${queue.items[0].file_version_id}/preview`, { method: "POST", headers: { cookie: technician } });
      assert.notEqual(preview.status, 403, "a technician may ask for a preview");
    }
    // The approved presentations are listed for them on Manage presentations (D-163) …
    assert.equal((await fetch(`${API}/events/${EVENT_ID}/approved`, { headers: { cookie: technician } })).status, 200);
    // … but they don't review (D-165): no queue, no approving, asking for changes or rejecting.
    const noQueue = await fetch(`${API}/events/${EVENT_ID}/review-queue`, { headers: { cookie: technician } });
    assert.equal(noQueue.status, 403, "the queue");
    for (const action of ["approve", "request_changes", "reject"]) {
      const refused = await fetch(`${API}/file-versions/${anyVersion}:transition`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: technician },
        body: JSON.stringify({ action, lock_version: 0, note: "probe", reason: "probe" }),
      });
      assert.equal(refused.status, 403, action);
      assert.equal(((await json(refused)) as { code: string }).code, "auth.kind_forbidden", action);
    }
    const revision = await fetch(`${API}/file-versions/${anyVersion}/request-revision`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: technician },
      body: JSON.stringify({ finding_id: "x", note: "probe" }),
    });
    assert.equal(revision.status, 403, "nor ask from a finding");
    // Room sync is no longer theirs (D-163).
    for (const path of [`/events/${EVENT_ID}/speakers`, `/events/${EVENT_ID}/comms`, `/events/${EVENT_ID}/files`, `/events/${EVENT_ID}/sync/fleet`, `/events/${EVENT_ID}/sync/approved.zip`]) {
      const refused = await fetch(`${API}${path}`, { headers: { cookie: technician } });
      assert.equal(refused.status, 403, path);
      assert.equal(((await json(refused)) as { code: string }).code, "auth.kind_forbidden");
    }
  });

  test("placing someone on an event grants their kind's roles; a kind change swaps them", async (t: TestContext) => {
    if (!up || !admin) return t.skip("API not running");
    const email = `probe-kind-${Date.now()}@example.invalid`;
    const made = (await json(await create({ email, display_name: "Kind Probe", account_type: "technician" }))) as { user_id: string };
    const headers = { "content-type": "application/json", cookie: admin };
    const placed = (await json(
      await fetch(`${API}/admin/users/${made.user_id}/events`, { method: "POST", headers, body: JSON.stringify({ event_id: EVENT_ID, assign: true }) }),
    )) as { assigned: boolean; roles: string[] };
    assert.equal(placed.assigned, true);
    assert.deepEqual([...placed.roles].sort(), ["content_reviewer", "room_technician", "srr_technician"]);

    const rolesOf = async () => {
      const list = (await json(await fetch(`${API}/admin/users`, { headers: { cookie: admin } }))) as {
        items: { id: string; account_type: string; roles: { event_id: string; role: string }[] }[];
      };
      const row = list.items.find((user) => user.id === made.user_id)!;
      return { type: row.account_type, roles: row.roles.filter((held) => held.event_id === EVENT_ID).map((held) => held.role).sort() };
    };
    assert.deepEqual(await rolesOf(), { type: "technician", roles: ["content_reviewer", "room_technician", "srr_technician"] });

    const changed = await fetch(`${API}/admin/users/${made.user_id}/account-type`, { method: "POST", headers, body: JSON.stringify({ account_type: "support" }) });
    assert.equal(changed.status, 200);
    assert.deepEqual(await rolesOf(), { type: "support", roles: ["presentation_manager", "project_manager"] });

    const removed = (await json(
      await fetch(`${API}/admin/users/${made.user_id}/events`, { method: "POST", headers, body: JSON.stringify({ event_id: EVENT_ID, assign: false }) }),
    )) as { assigned: boolean };
    assert.equal(removed.assigned, false);
    assert.deepEqual((await rolesOf()).roles, []);
  });
});

