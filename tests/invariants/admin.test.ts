import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { removeTestAccounts, removeTestEvents } from "../helpers/cleanup.ts";

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
    assert.equal(body.items.find((user) => user.email === "m.vega@example.invalid")?.account_type, "staff");
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
    const blocked = await fetch(`${API}/events`, { headers: { cookie } });
    assert.equal(blocked.status, 403);
    assert.equal((await json(blocked)).code, "auth.not_staff");
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
    assert.equal(body.account_type, "staff");
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
    assert.equal(list.items.find((user) => user.id === created.user_id)?.account_type, "staff");
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
  await removeTestAccounts(["roleless-", "probe-admin-"]);
  await removeTestEvents(["probe-admin-event-"]);
});
