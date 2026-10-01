import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { writeZip } from "../../packages/files/src/zipWrite.ts";
import { signInStaff, cookieFrom } from "../helpers/signIn.ts";

/**
 * Co-presenters each upload their own file (D-137).
 *
 * Before D-137 everyone in a session shared one presentation and so one file: whoever
 * uploaded last became the next version of everyone's deck, and approving it retired
 * the others'. Here two presenters named on one agenda row each sign in to the speaker
 * portal and upload; each must end up with a file of their own, and neither may touch
 * the other's.
 *
 * The probe event is reused, not recreated (once it has files it can only be archived).
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const NAME = "Co-presenter Upload Probe";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const ONE = "copresent.one@example.invalid";
const TWO = "copresent.two@example.invalid";
const AGENDA = [
  "Session Title,Session Location,Session Date,Session Start,Session End,Presenter 1 Email,Presenter 1 First Name,Presenter 1 Last Name,Presenter 2 Email,Presenter 2 First Name,Presenter 2 Last Name",
  `Shared Stage,Probe Room,06/02/2027,9:00 AM,10:00 AM,${ONE},Uma,One,${TWO},Theo,Two`,
].join("\n");

let up = false;
let staff = "";
let eventId = "";
const people: Record<string, { slotId: string; cookie: string; name: string }> = {};

const json = (cookie: string) => ({ "content-type": "application/json", cookie });
const post = (path: string, body: unknown, cookie = staff) =>
  fetch(`${API}${path}`, { method: "POST", headers: json(cookie), body: JSON.stringify(body) });

/** One small, valid PowerPoint package through the portal, as a speaker would. */
async function upload(cookie: string, slotId: string, name: string, text: string): Promise<Response> {
  const body = writeZip([
    { name: "[Content_Types].xml", body: Buffer.from('<?xml version="1.0"?><Types/>') },
    { name: "ppt/presentation.xml", body: Buffer.from('<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>') },
    { name: "ppt/slides/slide1.xml", body: Buffer.from(`<p:sld>${text}</p:sld>`) },
  ]);
  const start = await post("/portal/uploads", { slot_id: slotId, file_name: name, total_bytes: body.length }, cookie);
  if (start.status !== 200 && start.status !== 201) return start;
  const { upload_id } = (await start.json()) as { upload_id: string };
  await fetch(`${API}/portal/uploads/${upload_id}/parts/1`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream", cookie },
    body,
  });
  return post(`/portal/uploads/${upload_id}/complete`, { slot_id: slotId, file_name: name }, cookie);
}

type FileRow = { slot_id: string; speakers: string | null; history: { uploaded_by: string | null; version_number: number }[] };
const filesOf = async (): Promise<FileRow[]> =>
  ((await (await fetch(`${API}/events/${eventId}/files?limit=100`, { headers: { cookie: staff } })).json()) as {
    items: FileRow[];
  }).items;

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  staff = await signInStaff(API, "admin@example.invalid", PASSWORD);

  const existing = (await (await fetch(`${API}/events`, { headers: { cookie: staff } })).json()) as {
    items: { id: string; name: string; status: string }[];
  };
  const probe = existing.items.find((item) => item.name === NAME);
  if (probe) {
    eventId = probe.id;
    if (probe.status === "archived") await post(`/events/${eventId}/restore`, {});
  } else {
    const created = (await (
      await post("/events", {
        client_id: CLIENT,
        name: NAME,
        venue: "Probe Venue",
        timezone: "America/New_York",
        starts_on: "2027-06-02",
        ends_on: "2027-06-02",
      })
    ).json()) as { event_id: string };
    eventId = created.event_id;
    const preview = (await (
      await fetch(`${API}/events/${eventId}/imports`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "x-file-name": "agenda.csv", cookie: staff },
        body: Buffer.from(AGENDA, "utf8"),
      })
    ).json()) as { upload_id: string; rows: unknown[] };
    await post(`/imports/${preview.upload_id}/commit`, { rows: preview.rows });
  }

  const { items } = (await (await fetch(`${API}/events/${eventId}/agenda`, { headers: { cookie: staff } })).json()) as {
    items: { presentations: { slot_id: string; speakers: { id: string; name: string }[] }[] }[];
  };
  for (const talk of items[0]!.presentations) {
    for (const person of talk.speakers) {
      const email = person.name === "Uma One" ? ONE : TWO;
      const { access_code } = (await (await post(`/speakers/${person.id}/credentials`, {})).json()) as {
        access_code: string;
      };
      const login = await post("/portal/login", { email, code: access_code }, "");
      people[email] = { slotId: talk.slot_id, cookie: cookieFrom(login), name: person.name };
    }
  }
});

after(async () => {
  if (up && eventId) await post(`/events/${eventId}/archive`, {});
});

describe("co-presenters each upload their own file (D-137)", () => {
  test("the agenda row's two presenters are on two presentations", (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.ok(people[ONE] && people[TWO], "both presenters signed in");
    assert.notEqual(people[ONE]!.slotId, people[TWO]!.slotId);
  });

  test("each upload lands in that speaker's own file, and neither replaces the other", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const one = people[ONE]!;
    const two = people[TWO]!;
    assert.equal((await upload(one.cookie, one.slotId, "uma.pptx", `uma ${Date.now()}`)).status, 200);
    assert.equal((await upload(two.cookie, two.slotId, "theo.pptx", `theo ${Date.now()}`)).status, 200);

    const files = await filesOf();
    const umaFile = files.find((row) => row.slot_id === one.slotId);
    const theoFile = files.find((row) => row.slot_id === two.slotId);
    assert.ok(umaFile && theoFile, "two files, one per presenter");
    assert.ok(
      umaFile.history.every((version) => version.uploaded_by === "Uma One"),
      "Uma's file holds only Uma's uploads",
    );
    assert.ok(
      theoFile.history.every((version) => version.uploaded_by === "Theo Two"),
      "Theo's file holds only Theo's uploads",
    );
  });

  test("a speaker cannot upload onto their co-presenter's presentation", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const before = (await filesOf()).find((row) => row.slot_id === people[TWO]!.slotId)!.history.length;
    const attempt = await upload(people[ONE]!.cookie, people[TWO]!.slotId, "sneaky.pptx", `sneaky ${Date.now()}`);
    assert.ok(attempt.status >= 400 && attempt.status < 500, `refused (${attempt.status})`);
    const after = (await filesOf()).find((row) => row.slot_id === people[TWO]!.slotId)!.history.length;
    assert.equal(after, before, "Theo's file gained no version");
  });
});
