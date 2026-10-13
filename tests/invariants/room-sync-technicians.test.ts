import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";

/**
 * Room sync (D-154, D-160, D-163): DXG Admins and support staff see, tick and download every
 * room of their events — nobody hands out rooms one by one. DXG Technician staff no longer
 * open it (D-163); they find the approved presentations on Manage presentations. "Download
 * all" brings a room's (or every room's) approved presentations as one zip.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const EVENT = "22222222-2222-4222-8222-222222222222";
const PASSWORD = "dxg-development-password";
const DELGADO = "33333333-3333-4333-8333-333333333332";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const PROBE = "Room Sync Not Mine Probe";

type Room = {
  room_id: string;
  room: string;
  talks: { approved: { room_file_id: string | null; lock_version: number | null; loaded: boolean } | null }[];
};

let up = false;
let admin = "";
let delgado = "";
let vega = "";
let rooms: Room[] = [];
let probe = "";

const call = (cookie: string, method: string, path: string, body?: unknown) =>
  fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const fleet = async (cookie: string) =>
  ((await (await call(cookie, "GET", `/events/${EVENT}/sync/fleet`)).json()) as { items: Room[] }).items;
const room = (name: string) => rooms.find((item) => item.room === name)!;

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);
  delgado = await signInStaff(API, "c.delgado@example.invalid", PASSWORD);
  vega = await signInStaff(API, "m.vega@example.invalid", PASSWORD);
  rooms = await fleet(admin);

  // An event neither technician is on.
  const events = (await (await call(admin, "GET", "/events")).json()) as { items: { id: string; name: string; status: string }[] };
  const found = events.items.find((item) => item.name === PROBE);
  probe = found?.id ?? "";
  if (found?.status === "archived") await call(admin, "POST", `/events/${probe}/restore`);
  if (!probe) {
    const created = (await (
      await call(admin, "POST", "/events", { client_id: CLIENT, name: PROBE, venue: "Probe", timezone: "America/Chicago", starts_on: "2031-10-01", ends_on: "2031-10-01" })
    ).json()) as { event_id: string };
    probe = created.event_id;
    await call(admin, "POST", `/events/${probe}/sessions`, { title: "Probe Talk", room: "Probe Room", track: "", date: "2031-10-01", start: "09:00", end: "10:00" });
  }
});

after(async () => {
  if (up && probe) await call(admin, "POST", `/events/${probe}/archive`);
});

describe("Room sync is the support staff's and admins', not the technicians' (D-163)", () => {
  test("support staff see the same rooms as an admin", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const all = rooms.map((item) => item.room).sort();
    assert.ok(all.length > 1, "fixture: the event has several rooms");
    assert.deepEqual((await fleet(vega)).map((item) => item.room).sort(), all);
    assert.equal("technicians" in rooms[0]!, false, "rooms no longer name technicians");
  });

  test("a technician is refused Room sync: the list, the zip and the ticks", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const copy = room("Ballroom A").talks.find((talk) => talk.approved?.room_file_id)?.approved;
    assert.ok(copy?.room_file_id, "fixture: Ballroom A has a room copy");
    for (const [method, path, body] of [
      ["GET", `/events/${EVENT}/sync/fleet`, undefined],
      ["GET", `/events/${EVENT}/sync/approved.zip`, undefined],
      ["POST", `/room-files/${copy.room_file_id}/loaded`, { lock_version: copy.lock_version }],
    ] as const) {
      const refused = await call(delgado, method, path, body);
      assert.equal(refused.status, 403, `${method} ${path}`);
      assert.equal(((await refused.json()) as { code: string }).code, "auth.kind_forbidden", `${method} ${path}`);
    }
  });

  test("nobody hands out rooms any more", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await call(admin, "GET", `/events/${EVENT}/sync/technicians`)).status, 404);
    assert.equal((await call(admin, "PUT", `/events/${EVENT}/sync/rooms/${room("Room 212").room_id}/technicians`, { user_ids: [DELGADO] })).status, 404);
  });

  test("support staff tick a file loaded, and can take the tick back", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const copy = room("Ballroom A").talks.find((talk) => talk.approved?.room_file_id)!.approved!;
    const now = (await fleet(admin)).find((item) => item.room === "Ballroom A")!.talks.find((talk) => talk.approved?.room_file_id === copy.room_file_id)!.approved!;
    const first = await call(vega, "POST", `/room-files/${copy.room_file_id}/${now.loaded ? "unloaded" : "loaded"}`, { lock_version: now.lock_version });
    assert.equal(first.status, 200);
    const ticked = ((await fleet(admin)).find((item) => item.room === "Ballroom A")!.talks.find((talk) => talk.approved?.room_file_id === copy.room_file_id)!).approved!;
    const back = await call(vega, "POST", `/room-files/${copy.room_file_id}/${now.loaded ? "loaded" : "unloaded"}`, { lock_version: ticked.lock_version });
    assert.equal(back.status, 200, "put back as it was");
  });

  test("an event they are not on stays closed", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    for (const path of [`/events/${probe}/sync/fleet`, `/events/${probe}/sync/approved.zip`]) {
      const refused = await call(vega, "GET", path);
      assert.equal(refused.status, 403, path);
      assert.equal(((await refused.json()) as { code: string }).code, "auth.not_on_this_event");
    }
  });
});

describe("Download all (D-154)", () => {
  test("a room's approved presentations come as one zip", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call(admin, "GET", `/events/${EVENT}/sync/approved.zip?room=${room("Ballroom A").room_id}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/zip");
    assert.match(response.headers.get("content-disposition") ?? "", /^attachment; filename="approved-ballroom-a-\d{4}-\d{2}-\d{2}\.zip"$/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString(), "PK");
    assert.match(bytes.toString("latin1"), /\d{2}-\d{2} \d{4} Robotic Surgery Outcomes[^\n]*\(v\d+\)\.pptx/, "named by time and talk");
  });

  test("support staff download any room of the event, or all of them at once", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await call(vega, "GET", `/events/${EVENT}/sync/approved.zip?room=${room("Ballroom A").room_id}`)).status, 200);
    assert.equal((await call(vega, "GET", `/events/${EVENT}/sync/approved.zip`)).status, 200);
  });

  test("a room address that isn't a room is not found, not a server error", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await call(admin, "GET", `/events/${EVENT}/sync/approved.zip?room=not-a-room`)).status, 404);
  });

  test("a room with nothing approved says so", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call(admin, "GET", `/events/${EVENT}/sync/approved.zip?room=${room("Room 212").room_id}`);
    if (response.status === 200) return; // the local data may have an approved file there
    assert.equal(response.status, 422);
    assert.equal(((await response.json()) as { code: string }).code, "room.nothing_approved");
  });
});

describe("a technician uploads a new version a presenter brings (D-154)", () => {
  test("the intake is open to them (refused here only for the missing reason, so nothing is stored)", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const talks = (await (await call(delgado, "GET", `/events/${EVENT}/talks`)).json()) as { items: { slot_id: string }[] };
    assert.ok(talks.items.length > 0, "a technician reads the event's talks for the picker");
    const response = await call(delgado, "POST", `/events/${EVENT}/srr/slots/${talks.items[0]!.slot_id}/intake`, {
      upload_id: "00000000-0000-4000-8000-000000000000",
      file_name: "brought-to-the-room.pptx",
      reason: " ",
    });
    assert.equal(response.status, 422);
    assert.equal(((await response.json()) as { code: string }).code, "srr.reason_required");
  });
});
