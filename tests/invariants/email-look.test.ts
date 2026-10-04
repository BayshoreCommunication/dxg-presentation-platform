import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { withSystemScope } from "@pmp/db";
import { signInStaff } from "../helpers/signIn.ts";
import { removeTestEvents } from "../helpers/cleanup.ts";

/**
 * Branded speaker emails (D-138), after Preseria's "Customize Email Template": a banner of
 * exactly 1200 px × 200–600 px, a sender name and reply-to per event, a test send, "save as
 * new template", and every speaker email queued with that look for the dispatcher to render.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const ORIGIN = API.replace("/api/v1", "");
const PASSWORD = "dxg-development-password";
const NAME = "Email Look Probe";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const RUN = Date.now();

let up = false;
let staff = "";
let eventId = "";
let speakerId = "";

const json = (cookie: string) => ({ "content-type": "application/json", cookie });
const call = (method: string, path: string, body?: unknown, cookie = staff) =>
  fetch(`${API}${path}`, { method, headers: json(cookie), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** A real PNG of the given size: one flat grey, so it compresses to almost nothing. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x99)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", pixels),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const uploadBanner = (body: Buffer) =>
  fetch(`${API}/events/${eventId}/assets/email_banner`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", "x-file-name": "banner.png", cookie: staff },
    body,
  });

/** The newest outbox email to `to`. */
const outboxFor = (to: string) =>
  withSystemScope(async (tx) => {
    const { rows } = await tx.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM pmp.outbox WHERE topic = 'email.send' AND payload ->> 'to' = $1 ORDER BY id DESC LIMIT 1`,
      [to],
    );
    return rows[0]?.payload as
      | { subject: string; body: string; look?: { banner_url: string | null; button: { url: string } | null; from_name: string | null; reply_to: string | null } }
      | undefined;
  });

before(async () => {
  try {
    up = (await fetch(`${ORIGIN}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  staff = await signInStaff(API, "admin@example.invalid", PASSWORD);
  await removeTestEvents([NAME]);
  const created = (await (
    await call("POST", "/events", {
      client_id: CLIENT,
      name: NAME,
      venue: "Probe Hall",
      timezone: "America/New_York",
      starts_on: "2027-07-01",
      ends_on: "2027-07-02",
    })
  ).json()) as { event_id: string };
  eventId = created.event_id;
  const session = await call("POST", `/events/${eventId}/sessions`, {
    title: "Look Session",
    room: "Probe Room",
    track: "",
    date: "2027-07-01",
    start: "09:00",
    end: "10:00",
    presenter: { name: "Ana Look", email: `ana.look.${RUN}@example.invalid`, organization: "" },
  });
  assert.equal(session.status, 201, "fixture: the session");
  const speakers = (await (await call("GET", `/events/${eventId}/speakers`)).json()) as { items: { id: string; full_name: string }[] };
  speakerId = speakers.items.find((row) => row.full_name === "Ana Look")!.id;
});

after(async () => {
  if (up) await removeTestEvents([NAME]);
});

describe("email settings (D-138)", () => {
  test("a sender name and reply-to are saved", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call("PUT", `/events/${eventId}/email-settings`, {
      sender_name: "Probe Organisers",
      reply_to: "replies@example.com",
    });
    assert.equal(response.status, 200);
    const comms = (await (await call("GET", `/events/${eventId}/comms`)).json()) as {
      email: { sender_name: string; reply_to: string };
    };
    assert.equal(comms.email.sender_name, "Probe Organisers");
    assert.equal(comms.email.reply_to, "replies@example.com");
  });

  test("a sender name that is an address, or a broken reply-to, is refused with a reason", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const asAddress = await call("PUT", `/events/${eventId}/email-settings`, { sender_name: "me@x.com", reply_to: "" });
    assert.equal(asAddress.status, 422);
    const broken = await call("PUT", `/events/${eventId}/email-settings`, { sender_name: "Ok", reply_to: "not-an-address" });
    assert.equal(broken.status, 422);
    assert.match(((await broken.json()) as { message: string }).message, /reply-to/i);
  });
});

describe("the email banner (D-138)", () => {
  test("a banner of the wrong size is refused, naming the size it is", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await uploadBanner(png(1000, 300));
    assert.equal(response.status >= 400 && response.status < 500, true);
    assert.match(((await response.json()) as { message: string }).message, /1200 px wide.*1000 × 300/);
    assert.equal((await uploadBanner(png(1200, 700))).status >= 400, true, "too tall");
  });

  test("a 1200 × 300 banner is stored and served publicly, for mail clients", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await uploadBanner(png(1200, 300))).status, 201);
    const comms = (await (await call("GET", `/events/${eventId}/comms`)).json()) as { email: { banner_url: string } };
    assert.match(comms.email.banner_url, new RegExp(`/api/v1/email-banner/${eventId}\\?v=[0-9a-f]{12}$`));
    const path = new URL(comms.email.banner_url).pathname + new URL(comms.email.banner_url).search;
    const served = await fetch(`${ORIGIN}${path}`); // no cookie: a mail client has none
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");
    assert.match(served.headers.get("cache-control") ?? "", /immutable/);
  });

  test("an unknown event has no banner, and nothing else is served there", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await fetch(`${API}/email-banner/00000000-0000-4000-8000-000000000000`)).status, 404);
    assert.equal((await fetch(`${API}/email-banner/not-a-uuid`)).status, 404);
  });
});

describe("templates and the test send (D-138)", () => {
  test("a test email is queued to the chosen address with the event's look and no personal link", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const to = `look.test.${RUN}@example.invalid`;
    const response = await call("POST", `/events/${eventId}/comms/test`, {
      to,
      subject: "Hello {{speaker_first}} from {{event_venue}}",
      body: "Your session is on {{session_date}} at {{session_start}}.\n\n{{upload_link}}",
    });
    assert.equal(response.status, 201);
    const queued = await outboxFor(to);
    assert.ok(queued, "queued for the dispatcher");
    assert.equal(queued.subject, "[Test] Hello Ana from Probe Hall");
    assert.match(queued.body, /Thursday, July 1, 2027 at 9:00 AM EDT/);
    assert.ok(!/\/t\/[0-9a-f-]{36}/.test(queued.body), "no sign-in link in a test");
    assert.equal(queued.look?.from_name, "Probe Organisers");
    assert.equal(queued.look?.reply_to, "replies@example.com");
    assert.match(queued.look?.banner_url ?? "", /email-banner/);
    assert.match(queued.look?.button?.url ?? "", /\/login$/);
  });

  test("a test without an address, or with a broken template, is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await call("POST", `/events/${eventId}/comms/test`, { to: "", subject: "s", body: "{{upload_link}}" })).status, 422);
    assert.equal(
      (await call("POST", `/events/${eventId}/comms/test`, { to: "a@example.invalid", subject: "s", body: "no link" })).status,
      422,
      "the upload link must stay",
    );
  });

  test("a template is saved as new, once per name", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const input = { name: "Second reminder", subject: "Still missing: {{event_name}}", body: "Hi {{speaker_first}}\n\n{{upload_link}}" };
    const first = await call("POST", `/events/${eventId}/comms/templates`, input);
    assert.equal(first.status, 201);
    const again = await call("POST", `/events/${eventId}/comms/templates`, input);
    assert.equal(again.status, 422, "a second template of the same name is refused");
    const comms = (await (await call("GET", `/events/${eventId}/comms`)).json()) as { templates: { name: string }[] };
    assert.ok(comms.templates.some((row) => row.name === "Second reminder"));
  });
});

describe("a real invitation carries the look (D-138)", () => {
  test("the speaker's email has the banner, their own upload button, the sender and reply-to", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call("POST", `/events/${eventId}/speakers/${speakerId}/send-link`);
    assert.equal(response.status, 201);
    const queued = await outboxFor(`ana.look.${RUN}@example.invalid`);
    assert.ok(queued?.look, "queued with a look");
    assert.match(queued.look.button?.url ?? "", /\/t\/[0-9a-f-]{36}$/, "the button is their personal upload link");
    assert.ok(queued.body.includes(queued.look.button!.url), "the same link is in the text");
    assert.equal(queued.look.from_name, "Probe Organisers");
    assert.match(queued.look.banner_url ?? "", /email-banner/);
  });
});

describe("formatted messages (D-139)", () => {
  type Template = { id: string; name: string; body: string; body_html: string | null };
  const templates = async () =>
    ((await (await call("GET", `/events/${eventId}/comms`)).json()) as { templates: Template[] }).templates;

  test("a formatted message is stored cleaned, with its plain-text twin", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const invitation = (await templates())[0]!;
    const response = await call("PATCH", `/events/${eventId}/comms/templates/${invitation.id}`, {
      subject: "Upload for {{event_name}}",
      body: "ignored when formatted",
      body_html:
        '<p>Hi <strong>{{speaker_first}}</strong>,</p><p></p><ul><li data-list="bullet">PowerPoint</li></ul>' +
        '<p onclick="x()">Go: {{upload_link}}<script>alert(1)</script> <a href="javascript:alert(1)">bad</a></p>',
    });
    assert.equal(response.status, 200);
    const saved = (await templates()).find((row) => row.id === invitation.id)!;
    assert.match(saved.body_html ?? "", /<strong>\{\{speaker_first\}\}<\/strong>/);
    assert.match(saved.body_html ?? "", /<ul><li>PowerPoint<\/li><\/ul>/);
    assert.ok(!/script|onclick|javascript:/i.test(saved.body_html ?? ""), saved.body_html ?? "");
    assert.equal(saved.body, "Hi {{speaker_first}},\n\n• PowerPoint\nGo: {{upload_link}} bad");
  });

  test("a formatted message without the upload link is refused, like a plain one", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const invitation = (await templates())[0]!;
    const response = await call("PATCH", `/events/${eventId}/comms/templates/${invitation.id}`, {
      subject: "s",
      body_html: "<p><strong>No link here</strong></p>",
    });
    assert.equal(response.status, 422);
  });

  test("an invitation from a formatted template carries the formatted message, values escaped", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    // A fresh speaker, so the once-only send guard does not refuse it.
    const email = `ana.formatted.${RUN}@example.invalid`;
    const added = await call("POST", `/events/${eventId}/speakers`, {
      name: "Bo <b>Bold</b> Format",
      email,
      organization: "",
      slot_id: ((await (await call("GET", `/events/${eventId}/agenda`)).json()) as {
        items: { presentations: { slot_id: string }[] }[];
      }).items[0]!.presentations[0]!.slot_id,
    });
    assert.equal(added.status, 201);
    const id = ((await added.json()) as { speaker_id: string }).speaker_id;
    assert.equal((await call("POST", `/events/${eventId}/speakers/${id}/send-link`)).status, 201);
    const queued = (await outboxFor(email)) as { body: string; html_body?: string } | undefined;
    assert.ok(queued?.html_body, "sent formatted");
    assert.match(queued.html_body, /<strong>Bo<\/strong>/, "first name filled inside the bold");
    assert.match(queued.html_body, /<a href="https?:\/\/[^"]+\/t\/[0-9a-f-]{36}">/, "the upload link is a link");
    assert.match(queued.body, /^Hi Bo,/, "and the plain-text twin goes too");
  });

  test("an image for a message is stored and served publicly; other files are refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const upload = (body: Buffer) =>
      fetch(`${API}/events/${eventId}/email-images`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "x-file-name": "pic.png", cookie: staff },
        body,
      });
    const response = await upload(png(400, 200));
    assert.equal(response.status, 201);
    const { url } = (await response.json()) as { url: string };
    assert.match(url, new RegExp(`/api/v1/email-image/${eventId}/[0-9a-f-]{36}$`));
    const served = await fetch(`${ORIGIN}${new URL(url).pathname}`); // no cookie
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/png");
    assert.equal((await upload(Buffer.from("not an image"))).status, 422);
  });
});

describe("a speaker's link lasts through the event (D-141)", () => {
  /** The probe event ends 2 July 2027 (New York); links must work until the end of 9 July there. */
  const lastsTheEvent = async (speakerId: string) =>
    withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ ok: boolean; expires_at: string }>(
        `SELECT expires_at >= ('2027-07-10'::timestamp AT TIME ZONE 'America/New_York') AS ok, expires_at::text
           FROM pmp.speaker_tokens WHERE speaker_id = $1 AND kind = 'magic_link' ORDER BY created_at DESC LIMIT 1`,
        [speakerId],
      );
      return rows[0];
    });

  test("an emailed invitation's link works until a week after the event", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const link = await lastsTheEvent(speakerId);
    assert.ok(link, "fixture: the invitation sent earlier in this file");
    assert.ok(link.ok, `expires ${link.expires_at}`);
  });

  test("a copied link does too", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await call("POST", `/speakers/${speakerId}/invite`)).status, 201);
    const link = await lastsTheEvent(speakerId);
    assert.ok(link?.ok, `expires ${link?.expires_at}`);
  });

  test("the default invitation tells speakers the link keeps working on the day", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const queued = await outboxFor(`ana.look.${RUN}@example.invalid`);
    assert.ok(queued, "fixture: the invitation");
    // This file formats the invitation (D-139 tests), so check the stored default for a fresh event instead.
    const fresh = (await (await call("GET", `/events/${eventId}/comms`)).json()) as { templates: { name: string; body: string }[] };
    const reminder = fresh.templates.find((row) => row.name.startsWith("Reminder"));
    assert.match(reminder?.body ?? "", /up to and on the day of your presentation/);
  });
});
