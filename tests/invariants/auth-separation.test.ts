import { test, describe, before, after } from "node:test";
import type { TestContext } from "node:test";
import { signInStaff, cookieFrom } from "../helpers/signIn.ts";
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
let clientCookie = "";

before(async () => {
  try {
    const health = await fetch(`${API.replace("/api/v1", "")}/ops/health`);
    up = health.ok;
  } catch {
    up = false;
  }
  if (!up) return;

  // Staff sign-in is two steps now: password, then the second factor.
  staffCookie = await signInStaff(API, "m.vega@example.invalid", "dxg-development-password");
  clientCookie = await signInStaff(API, "j.ellis@example.invalid", "dxg-development-password");

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
    await fetch(`${API}/portal/logout`, { method: "POST", headers: { cookie: presenterCookie } });
  }
  if (staffCookie) await fetch(`${API}/auth/logout`, { method: "POST", headers: { cookie: staffCookie } });
  if (clientCookie) await fetch(`${API}/auth/logout`, { method: "POST", headers: { cookie: clientCookie } });
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

describe("staff and presenter sessions live side by side (D-088)", () => {
  /** The token alone, whatever cookie name it arrived under. */
  const tokenOf = (cookie: string) => cookie.split(";")[0]!.split("=").slice(1).join("=");

  test("a presenter signs in under their own cookie, not the staff one", (t: TestContext) => {
    if (!up || !presenterCookie) return t.skip("API not running");
    assert.match(presenterCookie, /^pmp_presenter=/);
    assert.doesNotMatch(presenterCookie, /pmp_session=/);
  });

  test("one browser holding both cookies is staff on staff routes and the presenter on the portal", async (t: TestContext) => {
    if (!up || !presenterCookie) return t.skip("API not running");
    const both = `${staffCookie}; ${presenterCookie}`;
    const staff = await fetch(`${API}/auth/session`, { headers: { cookie: both } });
    assert.equal(staff.status, 200, "signing into the portal did not end the staff session");
    const who = (await staff.json()) as { principal: { kind: string } };
    assert.equal(who.principal.kind, "staff");
    const portal = await fetch(`${API}/portal/talks`, { headers: { cookie: both } });
    assert.equal(portal.status, 200);
  });

  test("a staff session is not a presenter session on the portal", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await fetch(`${API}/portal/talks`, { headers: { cookie: staffCookie } })).status, 401);
  });

  test("a presenter token under the staff cookie's name is ignored", async (t: TestContext) => {
    if (!up || !presenterCookie) return t.skip("API not running");
    const smuggled = `pmp_session=${tokenOf(presenterCookie)}`;
    assert.equal((await fetch(`${API}/auth/session`, { headers: { cookie: smuggled } })).status, 401);
    assert.equal((await fetch(`${API}/events`, { headers: { cookie: smuggled } })).status, 401);
  });

  test("a staff token under the presenter cookie's name is ignored", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const smuggled = `pmp_presenter=${tokenOf(staffCookie)}`;
    assert.equal((await fetch(`${API}/portal/talks`, { headers: { cookie: smuggled } })).status, 401);
  });
});

describe("a client account reads the control centre and changes nothing (D-194)", () => {
  // Signing in is not authorisation: Client access holds a real session and sees the
  // control centre of its events — read-only, and without the team's own screens (D-196).
  // Every write is refused by kind.
  const reads = [
    "/events",
    `/events/${EVENT}/summary`,
    `/events/${EVENT}/speakers`,
    `/events/${EVENT}/agenda`,
    `/events/${EVENT}/files`,
    `/events/${EVENT}/sync/fleet`,
  ];

  for (const path of reads) {
    test(`client access reads ${path}`, async (t: TestContext) => {
      if (!up || !clientCookie) return t.skip("API not running");
      const response = await fetch(`${API}${path}`, { headers: { cookie: clientCookie } });
      assert.equal(response.status, 200, `${path} returned ${response.status} to client access`);
    });
  }

  // DXG's working screens (D-196): emails, the Speaker Ready Room, Manage presentations, inspection
  // findings, agenda imports, speaker housekeeping and the archive are not the client's.
  const notOffered = [
    `/events/${EVENT}/comms`,
    `/events/${EVENT}/srr`,
    `/events/${EVENT}/srr/report.csv`,
    `/events/${EVENT}/review-queue`,
    `/events/${EVENT}/approved`,
    `/events/${EVENT}/archive/scope`,
    `/events/${EVENT}/speaker-duplicates`,
    `/events/${EVENT}/agenda-template`,
    `/events/${EVENT}/sync/approved.zip`,
    "/import-fields",
    "/admin/users",
  ];

  for (const path of notOffered) {
    test(`client access is refused ${path}`, async (t: TestContext) => {
      if (!up || !clientCookie) return t.skip("API not running");
      const response = await fetch(`${API}${path}`, { headers: { cookie: clientCookie } });
      assert.equal(response.status, 403, `${path} returned ${response.status} to client access`);
      assert.equal(((await response.json()) as { code: string }).code, "auth.kind_forbidden");
    });
  }

  test("client access reads a file's comments in the client lane only, and no findings", async (t: TestContext) => {
    if (!up || !clientCookie) return t.skip("API not running");
    const files = (await fetch(`${API}/events/${EVENT}/files?limit=50`, { headers: { cookie: clientCookie } }).then(
      (response) => response.json(),
    )) as { items: { version_id: string }[] };
    assert.ok(files.items.length > 0, "the seeded event has files");
    // Staff see every lane; the same request from the client holds client-lane notes alone.
    let checked = 0;
    for (const file of files.items) {
      const [mine, theirs] = await Promise.all([
        fetch(`${API}/file-versions/${file.version_id}/comments`, { headers: { cookie: clientCookie } }),
        fetch(`${API}/file-versions/${file.version_id}/comments`, { headers: { cookie: staffCookie } }),
      ]);
      assert.equal(mine.status, 200);
      const client = ((await mine.json()) as { items: { lane: string }[] }).items;
      const staff = ((await theirs.json()) as { items: { lane: string }[] }).items;
      assert.ok(client.every((comment) => comment.lane === "client_visible"), "a non-client lane reached client access");
      assert.equal(client.length, staff.filter((comment) => comment.lane === "client_visible").length);
      if (staff.some((comment) => comment.lane !== "client_visible")) checked += 1;
      const findings = await fetch(`${API}/file-versions/${file.version_id}/findings`, { headers: { cookie: clientCookie } });
      assert.equal(findings.status, 403);
    }
    assert.ok(checked > 0, "the seed has at least one internal or speaker note to hold back");
  });

  test("client access cannot write, whatever the route", async (t: TestContext) => {
    if (!up || !clientCookie) return t.skip("API not running");
    const headers = { "content-type": "application/json", cookie: clientCookie };
    for (const [method, path, body] of [
      ["POST", `/events/${EVENT}/speakers`, { name: "Probe", email: "", organization: "", slot_id: "" }],
      ["PATCH", `/events/${EVENT}`, { name: "Renamed" }],
      ["POST", `/events/${EVENT}/comms/send`, { template_id: "x" }],
    ] as const) {
      const response = await fetch(`${API}${path}`, { method, headers, body: JSON.stringify(body) });
      assert.equal(response.status, 403, `${method} ${path} returned ${response.status}`);
      assert.equal(((await response.json()) as { code: string }).code, "auth.kind_forbidden");
    }
  });

  test("the client admin still reaches their own portal", async (t: TestContext) => {
    if (!up || !clientCookie) return t.skip("API not running");
    const response = await fetch(`${API}/client/events/${EVENT}`, { headers: { cookie: clientCookie } });
    assert.equal(response.status, 200);
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
