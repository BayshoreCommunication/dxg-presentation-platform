import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff, cookieFrom } from "../helpers/signIn.ts";
import { createStaffAccount, grantRole } from "../helpers/account.ts";
import { removeTestAccounts } from "../helpers/cleanup.ts";
import { writeZip } from "@pmp/files";

/**
 * The event header and slide template (D-093).
 *
 * Both are files staff put in front of every speaker on the event, so what is checked is
 * what could hurt them: the bytes must be what they claim (an image, a PowerPoint deck),
 * a macro-enabled or infected file is refused, only a presentation manager or above may
 * set them, and a speaker reaches their own event's files — nothing else.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const NAME = "Brand Assets Probe";
const RUN = Date.now();
const SPEAKER_EMAIL = `brand.speaker.${RUN}@example.invalid`;
const REVIEWER_EMAIL = `probe-brand-reviewer-${RUN}@example.invalid`;

let up = false;
let staff = "";
let reviewer = "";
let presenter = "";
let eventId = "";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(`probe header ${RUN}`),
]);
const deck = (extra: { name: string; body: Buffer }[] = []) =>
  writeZip([
    { name: "[Content_Types].xml", body: Buffer.from("<Types/>") },
    { name: "ppt/presentation.xml", body: Buffer.from("<p:presentation/>") },
    ...extra,
  ]);
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

const upload = (kind: string, body: Buffer, fileName: string, cookie = staff) =>
  fetch(`${API}/events/${eventId}/assets/${kind}`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(fileName), cookie },
    body,
  });
const codeOf = async (response: Response) => ((await response.json()) as { code: string }).code;

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  staff = await signInStaff(API, "admin@example.invalid", PASSWORD);
  const json = { "content-type": "application/json", cookie: staff };

  /*
   * Reused, not created each run: a speaker who signed in leaves sign-in records, which
   * are history, so the event can only be archived — one left behind per run otherwise.
   * Every speaker is new each run, and each run replaces the header and template.
   */
  const existing = (await (await fetch(`${API}/events`, { headers: json })).json()) as {
    items: { id: string; name: string; status: string }[];
  };
  const probe = existing.items.find((item) => item.name === NAME);
  if (probe) {
    eventId = probe.id;
    if (probe.status === "archived") {
      assert.equal((await fetch(`${API}/events/${eventId}/restore`, { method: "POST", headers: json })).status, 200);
    }
  } else {
    const created = (await (
      await fetch(`${API}/events`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          client_id: CLIENT,
          name: NAME,
          venue: "Probe Venue",
          timezone: "America/New_York",
          starts_on: "2027-11-01",
          ends_on: "2027-11-01",
        }),
      })
    ).json()) as { event_id: string };
    eventId = created.event_id;
  }

  // A speaker on this event, signed in to the portal.
  await fetch(`${API}/events/${eventId}/sessions`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ title: `Brand Probe Talk ${RUN}`, room: "Probe Room", track: "", date: "2027-11-01", start: "09:00", end: "10:00" }),
  });
  const agenda = (await (await fetch(`${API}/events/${eventId}/agenda`, { headers: json })).json()) as {
    items: { presentations: { slot_id: string; title: string }[] }[];
  };
  const talk = agenda.items.flatMap((item) => item.presentations).find((item) => item.title === `Brand Probe Talk ${RUN}`)!;
  const added = (await (
    await fetch(`${API}/events/${eventId}/speakers`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        name: `Brand Speaker ${RUN}`,
        email: SPEAKER_EMAIL,
        organization: "",
        slot_id: talk.slot_id,
      }),
    })
  ).json()) as { speaker_id: string };
  const { access_code } = (await (
    await fetch(`${API}/speakers/${added.speaker_id}/credentials`, { method: "POST", headers: json })
  ).json()) as { access_code: string };
  const login = await fetch(`${API}/portal/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: SPEAKER_EMAIL, code: access_code }),
  });
  presenter = cookieFrom(login);

  const account = await createStaffAccount(API, staff, {
    email: REVIEWER_EMAIL,
    displayName: "Brand Probe Reviewer",
    password: "probe-brand-password",
  });
  reviewer = account.cookie;
  await grantRole(API, staff, account.userId, eventId, "content_reviewer");
});

after(async () => {
  if (!up) return;
  await removeTestAccounts(["probe-brand-reviewer-"]);
  // Left archived between runs, out of the portfolio; the next run restores it.
  if (eventId) await fetch(`${API}/events/${eventId}/archive`, { method: "POST", headers: { cookie: staff } });
});

describe("the event header", () => {
  test("an image is stored and served inline, as an image", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await upload("header", PNG, "banner.png");
    assert.equal(response.status, 201);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.file_name, "banner.png");
    assert.equal(body.content_type, "image/png");
    assert.equal(body.key, undefined, "the storage key never leaves the server");

    const served = await fetch(`${API}/events/${eventId}/assets/header`, { headers: { cookie: staff } });
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");
    assert.match(served.headers.get("content-disposition") ?? "", /^inline/);
    assert.equal(served.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), PNG);
  });

  test("a file that is not an image is refused, whatever it is called", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await upload("header", Buffer.from("<svg onload=alert(1)>"), "banner.png");
    assert.equal(response.status, 422);
    assert.equal(await codeOf(response), "events.bad_asset");
  });

  test("an image over 5 MB is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    const response = await upload("header", big, "huge.png");
    assert.equal(response.status, 422);
  });
});

describe("the slide template", () => {
  test("a PowerPoint deck is stored and served as a download", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const body = deck();
    const response = await upload("template", body, "Event Template.pptx");
    assert.equal(response.status, 201);
    const served = await fetch(`${API}/events/${eventId}/assets/template`, { headers: { cookie: staff } });
    assert.equal(served.status, 200);
    assert.match(served.headers.get("content-disposition") ?? "", /^attachment; filename="Event Template\.pptx"/);
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), body);
  });

  test("anything that is not a PowerPoint deck is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await upload("template", PNG, "template.pptx")).status, 422);
    const notSlides = writeZip([{ name: "[Content_Types].xml", body: Buffer.from("<Types/>") }, { name: "word/document.xml", body: Buffer.from("<w/>") }]);
    assert.equal((await upload("template", notSlides, "template.pptx")).status, 422);
  });

  test("a macro-enabled deck is refused, by name or by content", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await upload("template", deck(), "template.pptm")).status, 422);
    const withMacros = deck([{ name: "ppt/vbaProject.bin", body: Buffer.from("macro") }]);
    const response = await upload("template", withMacros, "template.pptx");
    assert.equal(response.status, 422);
    assert.match(((await response.json()) as { message: string }).message, /macros/);
  });

  test("an infected file is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const infected = deck([{ name: "ppt/notes.txt", body: Buffer.from(EICAR) }]);
    // Stored uncompressed by writeZip, so the signature is in the bytes the scanner reads.
    const response = await upload("template", infected, "template.pptx");
    assert.equal(response.status, 422);
    assert.match(((await response.json()) as { message: string }).message, /security scan/);
  });
});

describe("who may set them, and who may see them", () => {
  test("staff below presentation manager cannot upload or remove", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await upload("header", PNG, "banner.png", reviewer)).status, 403);
    const removed = await fetch(`${API}/events/${eventId}/assets/header`, { method: "DELETE", headers: { cookie: reviewer } });
    assert.equal(removed.status, 403);
  });

  test("they cannot be smuggled in through the branding settings", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await fetch(`${API}/events/${eventId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: staff },
      body: JSON.stringify({ branding: { header: { key: "../../etc/passwd" } } }),
    });
    assert.equal(response.status, 422);
  });

  test("the event's speaker sees both in their portal", async (t: TestContext) => {
    if (!up || !presenter) return t.skip("API not running");
    const session = (await (await fetch(`${API}/portal/session`, { headers: { cookie: presenter } })).json()) as {
      event: { header: { file_name: string } | null; template: { file_name: string; key?: string } | null };
    };
    assert.equal(session.event.header?.file_name, "banner.png");
    assert.equal(session.event.template?.file_name, "Event Template.pptx");
    assert.equal(session.event.template?.key, undefined);
    const template = await fetch(`${API}/portal/assets/template`, { headers: { cookie: presenter } });
    assert.equal(template.status, 200);
  });

  test("a staff session is not a speaker session on the portal route, and no session reaches neither", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await fetch(`${API}/portal/assets/template`, { headers: { cookie: staff } })).status, 401);
    assert.equal((await fetch(`${API}/portal/assets/template`)).status, 401);
    assert.equal((await fetch(`${API}/events/${eventId}/assets/template`)).status, 401);
  });

  test("removing one takes it off the portal", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const removed = await fetch(`${API}/events/${eventId}/assets/header`, { method: "DELETE", headers: { cookie: staff } });
    assert.equal(removed.status, 200);
    assert.equal((await fetch(`${API}/events/${eventId}/assets/header`, { headers: { cookie: staff } })).status, 404);
    const session = (await (await fetch(`${API}/portal/session`, { headers: { cookie: presenter } })).json()) as {
      event: { header: unknown };
    };
    assert.equal(session.event.header, null);
  });
});
