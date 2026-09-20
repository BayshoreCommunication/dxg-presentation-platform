import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { totp } from "@pmp/auth";
import { signInStaff, cookieFrom } from "../helpers/signIn.ts";
import { removeTestAccounts } from "../helpers/cleanup.ts";

/**
 * Self-service reset. The properties that matter: it cannot be used to find out
 * who has an account, a link works once, and it does not replace the second
 * factor — a hijacked mailbox alone must not open an account.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const MAIL = path.join(process.env.FILE_ROOT ?? ".data", "mail");

/**
 * These tests change a password, so they work on an account they create rather
 * than a shared fixture — otherwise they quietly break whichever other suite
 * signs in as that person.
 */
let TARGET = "";
let TARGET_PASSWORD = "";
let up = false;
let dispatcherRunning = false;
let targetEnrolled = false;

const json = async (response: Response) => (await response.json()) as Record<string, unknown>;

const requestReset = (email: string) =>
  fetch(`${API}/auth/password-reset/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });

/**
 * Waits for a message written *after* `since` and addressed to `to`. Matching on
 * the newest file alone races with mail that was already queued.
 */
async function linkFor(to: string, since: number): Promise<string | null> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const files = (await readdir(MAIL).catch(() => [] as string[])).filter((file) => file.endsWith(".json"));
    for (const file of files.sort().reverse()) {
      const full = path.join(MAIL, file);
      const written = await stat(full).catch(() => null);
      if (!written || written.mtimeMs < since) continue;
      const message = JSON.parse(await readFile(full, "utf8")) as { to: string; body: string };
      if (message.to !== to) continue;
      const line = message.body.split("\n").find((entry) => entry.includes("reset-password?token="));
      if (line) return line.trim();
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

/** Lets anything already queued drain, so a count can mean something. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 2500));

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;

  // Its own account, created the way DXG creates one.
  const admin = await signInStaff(API, "admin@example.invalid", "dxg-development-password");
  if (!admin) return;
  TARGET = `reset-probe-${Date.now()}@example.invalid`;
  const created = (await (
    await fetch(`${API}/admin/users`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify({ email: TARGET, display_name: "Reset Probe" }),
    })
  ).json()) as { temporary_password: string };
  TARGET_PASSWORD = created.temporary_password;

  // Enrol it, so "a reset does not stand in for the second factor" is actually
  // being tested rather than asserted against an account with no second factor.
  const login = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: TARGET, password: TARGET_PASSWORD }),
  });
  const session = cookieFrom(login);
  const enrolment = (await (
    await fetch(`${API}/auth/mfa/start`, { method: "POST", headers: { cookie: session } })
  ).json()) as { secret?: string };
  if (enrolment.secret) {
    const confirmed = await fetch(`${API}/auth/mfa/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: session },
      body: JSON.stringify({ code: totp(enrolment.secret) }),
    });
    targetEnrolled = confirmed.ok;
  }

  const since = Date.now();
  await requestReset(TARGET);
  dispatcherRunning = (await linkFor(TARGET, since)) !== null;
});

describe("requesting a reset reveals nothing", () => {
  test("a known and an unknown address answer identically", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const known = await requestReset(TARGET);
    const unknown = await requestReset("definitely-nobody@example.invalid");
    assert.equal(known.status, unknown.status);
    assert.deepEqual(await json(known), await json(unknown));
  });

  test("an unknown address produces no email at all", async (t: TestContext) => {
    if (!up || !dispatcherRunning) return t.skip("dispatcher not running");
    await settle();
    const before = (await readdir(MAIL).catch(() => [] as string[])).length;
    await requestReset("definitely-nobody@example.invalid");
    await settle();
    const after = (await readdir(MAIL).catch(() => [] as string[])).length;
    assert.equal(after, before, "no message should have been sent");
  });
});

describe("a reset link is single use and does not defeat MFA", () => {
  test("the link resets the password, and MFA is still required", async (t: TestContext) => {
    if (!up || !dispatcherRunning) return t.skip("dispatcher not running");
    const since = Date.now();
    await requestReset(TARGET);
    const link = await linkFor(TARGET, since);
    assert.ok(link, "a reset email should have been delivered");

    const token = decodeURIComponent(link.split("token=")[1]!);
    const password = `reset-probe-${Date.now()}-passphrase`;

    const first = await fetch(`${API}/auth/password-reset/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, new_password: password }),
    });
    assert.equal(first.status, 200);
    const body = (await json(first)) as { mfa_still_required: boolean };
    assert.equal(
      body.mfa_still_required,
      targetEnrolled,
      "resetting a password must not stand in for the second factor",
    );

    // The same link again is refused.
    const second = await fetch(`${API}/auth/password-reset/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, new_password: "another passphrase entirely" }),
    });
    assert.equal(second.status, 422);
    assert.equal((await json(second)).code, "auth.reset_invalid");

    // The new password signs in but still only reaches the challenge.
    const login = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: TARGET, password }),
    });
    assert.equal(login.status, 200);
    assert.equal((await json(login)).step, targetEnrolled ? "mfa_required" : "signed_in");
  });

  test("a made-up token is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await fetch(`${API}/auth/password-reset/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "not-a-real-token", new_password: "a perfectly fine passphrase" }),
    });
    assert.equal(response.status, 422);
  });

  test("the new password still has to meet the policy", async (t: TestContext) => {
    if (!up || !dispatcherRunning) return t.skip("dispatcher not running");
    const since = Date.now();
    await requestReset(TARGET);
    const link = await linkFor(TARGET, since);
    if (!link) return t.skip("no reset email");
    const token = decodeURIComponent(link.split("token=")[1]!);

    const response = await fetch(`${API}/auth/password-reset/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, new_password: "short" }),
    });
    assert.equal(response.status, 422);
    assert.equal((await json(response)).code, "auth.too_short");
  });
});

/*
 * The accounts this suite created are its own, so it takes them away again. Without
 * this every run left another `probe-…` row in Staff accounts, and the only way to
 * clear them was wiping the database — which took real work with it.
 */
after(async () => {
  if (!up) return;
  await removeTestAccounts(["reset-probe-"]);
});
