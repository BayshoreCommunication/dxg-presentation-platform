import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { removeTestAccounts } from "../helpers/cleanup.ts";

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

  test("an admin can list accounts", async (t: TestContext) => {
    if (!up || !admin) return t.skip("API not running");
    const response = await fetch(`${API}/admin/users`, { headers: { cookie: admin } });
    assert.equal(response.status, 200);
    const body = (await json(response)) as { items: unknown[] };
    assert.ok(body.items.length > 0);
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

  test("the last platform admin role cannot be revoked", async (t: TestContext) => {
    if (!up || !admin) return t.skip("API not running");
    const session = (await json(await fetch(`${API}/auth/session`, { headers: { cookie: admin } }))) as {
      principal: { user_id: string };
    };
    const response = await fetch(`${API}/admin/users/${session.principal.user_id}/roles`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ event_id: EVENT, role: "platform_admin", grant: false }),
    });
    assert.equal(response.status, 422);
    assert.equal((await json(response)).code, "admin.last_admin");
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
        body: JSON.stringify({ email, display_name: "Roleless" }),
      }),
    )) as { temporary_password: string };

    const login = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: created.temporary_password }),
    });
    const cookie = (login.headers.getSetCookie?.() ?? []).map((entry) => entry.split(";")[0]).join("; ");
    const blocked = await fetch(`${API}/events`, { headers: { cookie } });
    assert.equal(blocked.status, 403);
    assert.equal((await json(blocked)).code, "auth.not_staff");
  });

  test("a staff account must change its password and enrol before doing anything", async (t: TestContext) => {
    if (!up || !admin) return t.skip("API not running");
    const email = `probe-${Date.now()}@example.invalid`;
    const created = (await json(
      await fetch(`${API}/admin/users`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: admin },
        body: JSON.stringify({ email, display_name: "Probe" }),
      }),
    )) as { temporary_password: string; user_id: string };

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
      body: JSON.stringify({ email, password: created.temporary_password }),
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

/*
 * The accounts this suite created are its own, so it takes them away again. Without
 * this every run left another `probe-…` row in Staff accounts, and the only way to
 * clear them was wiping the database — which took real work with it.
 */
after(async () => {
  if (!up) return;
  await removeTestAccounts(["roleless-", "probe-"]);
});
