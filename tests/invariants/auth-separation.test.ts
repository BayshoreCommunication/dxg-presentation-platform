import { test, describe, before, after } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";

/**
 * I-4 at the authentication layer: the two principals the product has must stay
 * apart. A presenter session must never resolve to a staff actor — the bug this
 * pins was exactly that, a presenter silently inheriting a staff role through a
 * development fallback.
 *
 * Runs against the local API when it is up; skipped otherwise so `npm test`
 * stays runnable without the stack.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const EVENT = "22222222-2222-4222-8222-222222222222";

let up = false;
let presenterCookie = "";
let staffCookie = "";

const cookieFrom = (response: Response): string =>
  (response.headers.getSetCookie?.() ?? [])
    .map((entry) => entry.split(";")[0])
    .filter(Boolean)
    .join("; ");

before(async () => {
  try {
    const health = await fetch(`${API.replace("/api/v1", "")}/ops/health`);
    up = health.ok;
  } catch {
    up = false;
  }
  if (!up) return;

  const staff = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "m.vega@example.invalid", password: "dxg-development-password" }),
  });
  if (staff.ok) staffCookie = cookieFrom(staff);

  // A presenter credential is issued by staff, exactly as DXG would.
  const speakers = await fetch(`${API}/events/${EVENT}/speakers?q=Raman`, {
    headers: { cookie: staffCookie },
  }).then((response) => response.json() as Promise<{ items: { id: string }[] }>);
  const speakerId = speakers.items?.[0]?.id;
  if (!speakerId) return;

  const credential = await fetch(`${API}/speakers/${speakerId}/credentials`, {
    method: "POST",
    headers: { cookie: staffCookie },
  }).then((response) => response.json() as Promise<{ access_code?: string }>);
  if (!credential.access_code) return;

  const presenter = await fetch(`${API}/portal/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "p.raman@example.invalid", code: credential.access_code }),
  });
  if (presenter.ok) presenterCookie = cookieFrom(presenter);
});

after(async () => {
  if (presenterCookie) {
    await fetch(`${API}/auth/logout`, { method: "POST", headers: { cookie: presenterCookie } });
  }
  if (staffCookie) await fetch(`${API}/auth/logout`, { method: "POST", headers: { cookie: staffCookie } });
});

describe("a presenter session is not a staff session", () => {
  const staffOnly = [
    "/events",
    `/events/${EVENT}/review-queue`,
    `/events/${EVENT}/summary`,
    `/events/${EVENT}/speakers`,
    `/events/${EVENT}/archive/scope`,
    `/client/events/${EVENT}`,
  ];

  for (const path of staffOnly) {
    test(`presenter is refused ${path}`, async (t: TestContext) => {
      if (!up || !presenterCookie) return t.skip("API not running");
      const response = await fetch(`${API}${path}`, { headers: { cookie: presenterCookie } });
      assert.ok(
        response.status === 401 || response.status === 403,
        `${path} returned ${response.status} to a presenter session`,
      );
    });
  }

  test("a presenter reaches only their own talks", async (t: TestContext) => {
    if (!up || !presenterCookie) return t.skip("API not running");
    const talks = (await fetch(`${API}/portal/talks`, {
      headers: { cookie: presenterCookie },
    }).then((response) => response.json())) as { items: { title: string }[] };
    assert.equal(talks.items.length, 1);
  });

  test("no session at all is refused everywhere", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    for (const path of ["/portal/talks", "/portal/session"]) {
      const response = await fetch(`${API}${path}`);
      assert.equal(response.status, 401, `${path} should need a session`);
    }
  });
});

describe("credentials behave as credentials", () => {
  test("sign-in failures do not reveal whether an account exists", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const attempt = (email: string) =>
      fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "definitely-not-the-password" }),
      }).then(async (response) => ({ status: response.status, body: await response.json() }));

    const known = await attempt("t.okafor@example.invalid");
    const unknown = await attempt("nobody-at-all@example.invalid");
    assert.equal(known.status, unknown.status);
    assert.deepEqual(known.body, unknown.body);
  });

  test("an access code alone is not enough without the matching email", async (t: TestContext) => {
    if (!up || !staffCookie) return t.skip("API not running");
    const speakers = (await fetch(`${API}/events/${EVENT}/speakers?q=Osei`, {
      headers: { cookie: staffCookie },
    }).then((response) => response.json())) as { items: { id: string }[] };
    const credential = (await fetch(`${API}/speakers/${speakers.items[0]!.id}/credentials`, {
      method: "POST",
      headers: { cookie: staffCookie },
    }).then((response) => response.json())) as { access_code: string };

    const wrongEmail = await fetch(`${API}/portal/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "p.raman@example.invalid", code: credential.access_code }),
    });
    assert.equal(wrongEmail.status, 401);
  });
});
