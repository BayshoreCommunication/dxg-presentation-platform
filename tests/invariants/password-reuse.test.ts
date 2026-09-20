import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff, cookieFrom } from "../helpers/signIn.ts";
import { removeTestAccounts } from "../helpers/cleanup.ts";

/**
 * A password change that lands on the same password is not a change.
 *
 * It matters most on the path that reaches it first. A new staff account signs in
 * with a temporary password chosen by an administrator, handed over out of band,
 * and now sitting in whatever chat or email carried it. Re-entering that as the
 * "new" password clears `must_change_password` — the account looks resolved while
 * remaining exactly as exposed as the day it was created.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";

let up = false;
let TARGET = "";
let TEMPORARY = "";

const json = async (response: Response) => (await response.json()) as Record<string, unknown>;

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;

  // Its own account, created the way DXG creates one, so this suite cannot break
  // whichever other suite signs in as a shared fixture.
  const admin = await signInStaff(API, "admin@example.invalid", "dxg-development-password");
  if (!admin) {
    up = false;
    return;
  }
  TARGET = `reuse-probe-${Date.now()}@example.invalid`;
  const created = (await (
    await fetch(`${API}/admin/users`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ email: TARGET, display_name: "Reuse Probe" }),
    })
  ).json()) as { temporary_password: string };
  TEMPORARY = created.temporary_password;
});

/** Signs in on the temporary password; no MFA yet, so this yields a session. */
async function sessionOnTemporary(password: string): Promise<string> {
  const response = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: TARGET, password }),
  });
  return cookieFrom(response);
}

const changePassword = (cookie: string, current: string, next: string) =>
  fetch(`${API}/auth/password`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ current_password: current, new_password: next }),
  });

describe("a forced password change must actually change it", () => {
  test("the temporary password cannot be re-used as the new one", async (t: TestContext) => {
    if (!up) return t.skip("API not running");

    const cookie = await sessionOnTemporary(TEMPORARY);
    assert.notEqual(cookie, "", "expected a session on the temporary password");

    const response = await changePassword(cookie, TEMPORARY, TEMPORARY);
    const body = await json(response);

    assert.equal(response.status, 422, "a value that breaks a rule is unprocessable, not malformed");
    assert.equal(body.code, "auth.same_as_old");
    assert.match(
      String(body.message),
      /temporary/i,
      "the refusal should say why the temporary password in particular is not private",
    );
  });

  test("the account is still forced to change — the refusal did not resolve it", async (t: TestContext) => {
    if (!up) return t.skip("API not running");

    const cookie = await sessionOnTemporary(TEMPORARY);
    const session = await json(await fetch(`${API}/auth/session`, { headers: { cookie } }));
    const principal = session.principal as { must_change_password?: boolean } | undefined;
    assert.equal(principal?.must_change_password, true);
  });

  test("a genuinely different password is accepted", async (t: TestContext) => {
    if (!up) return t.skip("API not running");

    const cookie = await sessionOnTemporary(TEMPORARY);
    const chosen = `probe-chosen-${Date.now()}-passphrase`;
    const response = await changePassword(cookie, TEMPORARY, chosen);

    assert.equal(response.status, 200, await response.text());
    TEMPORARY = chosen; // subsequent tests work from the password that now exists
  });

  test("and afterwards the same password still cannot be set again", async (t: TestContext) => {
    if (!up) return t.skip("API not running");

    const cookie = await sessionOnTemporary(TEMPORARY);
    const response = await changePassword(cookie, TEMPORARY, TEMPORARY);
    const body = await json(response);

    assert.equal(response.status, 422);
    assert.equal(body.code, "auth.same_as_old");
    assert.doesNotMatch(
      String(body.message),
      /temporary/i,
      "once it is the person's own password, the wording should not still call it temporary",
    );
  });

  test("the length rule is still enforced, and reported separately", async (t: TestContext) => {
    if (!up) return t.skip("API not running");

    const cookie = await sessionOnTemporary(TEMPORARY);
    const response = await changePassword(cookie, TEMPORARY, "short");
    const body = await json(response);

    assert.equal(response.status, 422);
    assert.equal(body.code, "auth.too_short", "reuse must not mask an ordinary policy failure");
  });
});

/*
 * The accounts this suite created are its own, so it takes them away again. Without
 * this every run left another `probe-…` row in Staff accounts, and the only way to
 * clear them was wiping the database — which took real work with it.
 */
after(async () => {
  if (!up) return;
  await removeTestAccounts(["reuse-probe-"]);
});
