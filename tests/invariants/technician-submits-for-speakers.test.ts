import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { hashPassword } from "@pmp/auth";
import { withSystemScope } from "@pmp/db";
import { writeZip } from "../../packages/files/src/zipWrite.ts";
import { cookieFrom, signInStaff } from "../helpers/signIn.ts";
import { removeTestAccounts } from "../helpers/cleanup.ts";

/**
 * Speaker Support Staff is retired (D-159, Travis): nobody is an assistant to one speaker any
 * more. DXG Technician staff submit for speakers instead — any speaker on the events they are
 * assigned to, from Manage presentations, and nothing on an event they are not on.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const SEED_EVENT = "22222222-2222-4222-8222-222222222222";
const DELGADO = "33333333-3333-4333-8333-333333333332";
const PASSWORD = "dxg-development-password";
const SPEAKER = "p.raman@example.invalid";
const NAME = "Technician Submits Probe";
const DAY = "2031-09-16";
const RUN = Date.now();
const FORMER = `probe-former-assistant-${RUN}@example.invalid`;

let up = false;
let admin = "";
let delgado = "";
let eventId = "";
const talks: { slotId: string; speaker: string }[] = [];

const call = (cookie: string, method: string, path: string, body?: unknown) =>
  fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const deck = () =>
  writeZip([
    { name: "[Content_Types].xml", body: Buffer.from('<?xml version="1.0"?><Types/>') },
    { name: "ppt/presentation.xml", body: Buffer.from('<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>') },
    { name: "ppt/slides/slide1.xml", body: Buffer.from("<p:sld/>") },
  ]);

/** The file goes up as Manage presentations sends it, through `/srr/uploads`. */
async function intake(cookie: string, slotId: string): Promise<Response> {
  const begun = await call(cookie, "POST", "/srr/uploads", {});
  if (begun.status !== 201 && begun.status !== 200) return begun;
  const { upload_id } = (await begun.json()) as { upload_id: string };
  const part = await fetch(`${API}/srr/uploads/${upload_id}/parts/1`, {
    method: "PUT",
    headers: { cookie, "content-type": "application/octet-stream" },
    body: deck(),
  });
  assert.equal(part.status, 200);
  return call(cookie, "POST", `/events/${eventId}/srr/slots/${slotId}/intake`, {
    upload_id,
    file_name: "sent-by-the-speaker.pptx",
    reason: "the speaker emailed the file to the DXG team",
  });
}

const assign = (assigned: boolean) =>
  call(admin, "POST", `/admin/users/${DELGADO}/events`, { event_id: eventId, assign: assigned });

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);
  delgado = await signInStaff(API, "c.delgado@example.invalid", PASSWORD);

  const events = (await (await call(admin, "GET", "/events")).json()) as { items: { id: string; name: string; status: string }[] };
  const probe = events.items.find((item) => item.name === NAME);
  eventId = probe?.id ?? "";
  if (probe?.status === "archived") await call(admin, "POST", `/events/${eventId}/restore`);
  if (!eventId) {
    const created = (await (
      await call(admin, "POST", "/events", { client_id: CLIENT, name: NAME, venue: "Probe", timezone: "America/Chicago", starts_on: DAY, ends_on: DAY })
    ).json()) as { event_id: string };
    eventId = created.event_id;
  }
  // Start from "not on this event", whatever an earlier run left behind.
  await assign(false);

  // Two talks, two speakers: the technician's reach is the event, not one speaker.
  for (const [index, start, end] of [[1, "09:00", "10:00"], [2, "10:00", "11:00"]] as const) {
    const title = `Technician Talk ${RUN} ${index}`;
    assert.equal(
      (await call(admin, "POST", `/events/${eventId}/sessions`, { title, room: "Probe Room", track: "", date: DAY, start, end })).status,
      201,
    );
    const agenda = (await (await call(admin, "GET", `/events/${eventId}/agenda`)).json()) as {
      items: { presentations: { slot_id: string; title: string }[] }[];
    };
    const slotId = agenda.items.flatMap((item) => item.presentations).find((talk) => talk.title === title)!.slot_id;
    const speaker = `Technician Speaker ${RUN} ${index}`;
    const added = await call(admin, "POST", `/events/${eventId}/speakers`, {
      name: speaker,
      email: `tech-submits.${RUN}.${index}@example.invalid`,
      organization: "",
      slot_id: slotId,
    });
    assert.equal(added.status, 201);
    talks.push({ slotId, speaker });
  }
});

after(async () => {
  if (!up) return;
  await removeTestAccounts(["probe-former-assistant-"]);
  if (!eventId) return;
  await assign(false);
  await call(admin, "POST", `/events/${eventId}/archive`);
});

describe("DXG Technician staff submit for every speaker on their events (D-159)", () => {
  test("a technician not on the event is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const refused = await intake(delgado, talks[0]!.slotId);
    assert.equal(refused.status, 403);
  });

  test("once assigned, they upload for any speaker; each version is the speaker's, sent by the technician", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await assign(true)).status, 200);
    const versions: string[] = [];
    for (const talk of talks) {
      const response = await intake(delgado, talk.slotId);
      assert.equal(response.status, 200, talk.speaker);
      const body = (await response.json()) as { scan_result: string; file_version_id: string };
      assert.equal(body.scan_result, "clean");
      versions.push(body.file_version_id);
    }
    const rows = await withSystemScope(async (tx) =>
      (
        await tx.query<{ slot_id: string; source: string; uploaded_by_user: string | null }>(
          `SELECT f.slot_id::text, v.source, v.uploaded_by_user::text
             FROM pmp.file_versions v JOIN pmp.files f ON f.id = v.file_id WHERE v.id = ANY($1::uuid[])`,
          [versions],
        )
      ).rows,
    );
    assert.deepEqual(rows.map((row) => row.slot_id).sort(), talks.map((talk) => talk.slotId).sort(), "one version on each speaker's talk");
    for (const row of rows) {
      assert.equal(row.source, "srr_manual");
      assert.equal(row.uploaded_by_user, DELGADO, "who sent it is recorded");
    }
    // They appear in Manage presentations' queue, where the technician works.
    const queue = (await (await call(delgado, "GET", `/events/${eventId}/review-queue`)).json()) as { items: { file_version_id?: string; id?: string }[] };
    const ids = queue.items.map((item) => item.file_version_id ?? item.id);
    for (const version of versions) assert.ok(ids.includes(version), "in the review queue");
  });

  test("taken off the event, they are refused again", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await assign(false)).status, 200);
    assert.equal((await intake(delgado, talks[1]!.slotId)).status, 403);
  });
});

describe("speaker support staff are gone (D-159)", () => {
  test("no route adds, lists or removes them, on either site", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const speakers = (await (await call(admin, "GET", `/events/${SEED_EVENT}/speakers`)).json()) as { items: Record<string, unknown>[] };
    assert.ok(speakers.items.length > 0);
    assert.equal("support_staff" in speakers.items[0]!, false, "the Speakers screen no longer counts them");
    const id = speakers.items[0]!.id as string;
    for (const method of ["GET", "POST"]) {
      assert.equal((await call(admin, method, `/events/${SEED_EVENT}/speakers/${id}/support-staff`, method === "POST" ? {} : undefined)).status, 404);
    }
    const speaker = cookieFrom(
      await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: SPEAKER, password: PASSWORD }),
      }),
    );
    assert.ok(speaker, "the seeded speaker signs in");
    assert.equal((await call(speaker, "GET", "/me/support-staff")).status, 404);
  });

  test("a sign-in that assisted a speaker never opens, even if left active", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const hash = await hashPassword(PASSWORD);
    await withSystemScope((tx) =>
      tx.query(
        `INSERT INTO pmp.users (email, display_name, password_hash, password_set_at, must_change_password, account_kind, assists_user_id)
         SELECT $1::citext, 'Former Assistant', $2, now(), false, 'speaker', id FROM pmp.users WHERE lower(email::text) = $3`,
        [FORMER, hash, SPEAKER],
      ),
    );
    const login = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: FORMER, password: PASSWORD }),
    });
    assert.equal(login.ok, false);
    assert.equal(cookieFrom(login), "", "no session is handed out");
  });
});
