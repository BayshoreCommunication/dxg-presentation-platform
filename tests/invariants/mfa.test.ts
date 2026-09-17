import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { cookieFrom, freshCode, DEV_MFA_SECRET } from "../helpers/signIn.ts";

/**
 * NFR-SEC-02 end to end: a password alone is not a sign-in for an enrolled
 * staff account, and the second factor cannot be replayed or reused.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
/**
 * Its own account: replay protection is per user, and test files run in separate
 * processes, so sharing an account across files makes them invalidate each
 * other's codes within the same 30-second step.
 */
const STAFF = { email: "t.okafor@example.invalid", password: "dxg-development-password" };

let up = false;

const password = () =>
  fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(STAFF),
  });

const verify = (cookie: string, code: string) =>
  fetch(`${API}/auth/mfa/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ code }),
  });

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
});

void DEV_MFA_SECRET;

describe("a password is not a sign-in", () => {
  test("an enrolled account gets a challenge, not a session", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await password();
    const body = (await response.json()) as { step?: string; principal?: unknown };
    assert.equal(body.step, "mfa_required");
    assert.equal(body.principal, undefined, "no principal before the second factor");
  });

  test("the challenge cookie opens nothing", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const cookie = cookieFrom(await password());
    for (const path of ["/events", "/auth/session"]) {
      const response = await fetch(`${API}${path}`, { headers: { cookie } });
      assert.equal(response.status, 401, `${path} accepted a half-finished sign-in`);
    }
  });

  test("a wrong code is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const cookie = cookieFrom(await password());
    const response = await verify(cookie, "000000");
    assert.equal(response.status, 422);
  });

  test("the correct code completes the sign-in", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const cookie = cookieFrom(await password());
    const response = await verify(cookie, await freshCode());
    assert.equal(response.status, 200);

    const session = cookieFrom(response);
    const events = await fetch(`${API}/events`, { headers: { cookie: session } });
    assert.equal(events.status, 200);
    await fetch(`${API}/auth/logout`, { method: "POST", headers: { cookie: session } });
  });

  test("the same code cannot be used twice", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const code = await freshCode();

    const first = await verify(cookieFrom(await password()), code);
    assert.equal(first.status, 200, "first use should succeed");
    await fetch(`${API}/auth/logout`, { method: "POST", headers: { cookie: cookieFrom(first) } });

    const second = await verify(cookieFrom(await password()), code);
    const body = (await second.json()) as { code?: string };
    assert.equal(second.status, 422);
    assert.equal(body.code, "mfa.code_reused");
  });

  test("a wrong password never reaches the second factor", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: STAFF.email, password: "not-the-password" }),
    });
    assert.equal(response.status, 401);
    const body = (await response.json()) as { step?: string };
    assert.equal(body.step, undefined);
  });
});
