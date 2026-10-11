import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { withSystemScope } from "@pmp/db";
import { signInStaff } from "../helpers/signIn.ts";

/**
 * Room sync by room (client review, D-153): admins and support staff give rooms to DXG
 * Technician staff; a technician sees, ticks and downloads only the rooms they work; and
 * "Download all" brings a room's (or all of one's rooms') approved presentations as one zip.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const EVENT = "22222222-2222-4222-8222-222222222222";
const PASSWORD = "dxg-development-password";
const DELGADO = "33333333-3333-4333-8333-333333333332";
const OKAFOR = "33333333-3333-4333-8333-333333333333";
const VEGA = "33333333-3333-4333-8333-333333333331";

type Room = {
  room_id: string;
  room: string;
  technicians: { user_id: string }[];
  talks: { approved: { room_file_id: string | null; lock_version: number | null } | null }[];
};

let up = false;
let admin = "";
let delgado = "";
let okafor = "";
let rooms: Room[] = [];
let before_: { room_id: string; user_id: string }[] = [];

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
  okafor = await signInStaff(API, "t.okafor@example.invalid", PASSWORD);
  rooms = await fleet(admin);
  before_ = await withSystemScope(async (tx) =>
    (await tx.query<{ room_id: string; user_id: string }>(`SELECT room_id, user_id FROM pmp.room_assignments WHERE event_id = $1`, [EVENT])).rows,
  );
  // C. Delgado works Ballroom A, T. Okafor Room 210, as the seed has it.
  for (const [name, who] of [["Ballroom A", [DELGADO]], ["Room 210", [OKAFOR]], ["Room 212", []]] as const) {
    const response = await call(admin, "PUT", `/events/${EVENT}/sync/rooms/${room(name).room_id}/technicians`, { user_ids: who });
    assert.equal(response.status, 200, name);
  }
});

after(async () => {
  if (!up) return;
  // Put the rooms back as they were.
  for (const item of rooms) {
    const ids = before_.filter((row) => row.room_id === item.room_id).map((row) => row.user_id);
    await call(admin, "PUT", `/events/${EVENT}/sync/rooms/${item.room_id}/technicians`, { user_ids: ids });
  }
});

describe("technicians work the rooms they are given (D-153)", () => {
  test("the event's technicians are offered; a non-technician is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const list = (await (await call(admin, "GET", `/events/${EVENT}/sync/technicians`)).json()) as { items: { user_id: string }[] };
    const ids = list.items.map((item) => item.user_id);
    assert.ok(ids.includes(DELGADO) && ids.includes(OKAFOR));
    assert.equal(ids.includes(VEGA), false, "support staff are not technicians");
    const refused = await call(admin, "PUT", `/events/${EVENT}/sync/rooms/${room("Room 212").room_id}/technicians`, { user_ids: [VEGA] });
    assert.equal(refused.status, 422);
    assert.equal(((await refused.json()) as { code: string }).code, "room.not_a_technician");
  });

  test("admins see every room with its technicians; a technician sees only their own", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const all = await fleet(admin);
    assert.deepEqual(all.find((item) => item.room === "Ballroom A")!.technicians.map((person) => person.user_id), [DELGADO]);
    const mine = await fleet(delgado);
    assert.deepEqual(mine.map((item) => item.room), ["Ballroom A"]);
    const his = await fleet(okafor);
    assert.deepEqual(his.map((item) => item.room), ["Room 210"]);
  });

  test("a technician can't give out rooms", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    for (const [method, path, body] of [
      ["GET", `/events/${EVENT}/sync/technicians`, undefined],
      ["PUT", `/events/${EVENT}/sync/rooms/${room("Room 212").room_id}/technicians`, { user_ids: [DELGADO] }],
    ] as const) {
      const response = await call(delgado, method, path, body);
      assert.equal(response.status, 403, `${method} ${path}`);
      assert.equal(((await response.json()) as { code: string }).code, "auth.kind_forbidden");
    }
  });

  test("a technician ticks files in their own rooms only", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const copy = room("Ballroom A").talks.find((talk) => talk.approved?.room_file_id)?.approved;
    assert.ok(copy?.room_file_id, "fixture: Ballroom A has a room copy");
    const refused = await call(okafor, "POST", `/room-files/${copy.room_file_id}/loaded`, { lock_version: copy.lock_version });
    assert.equal(refused.status, 403);
    assert.equal(((await refused.json()) as { code: string }).code, "room.not_assigned");
  });
});

describe("Download all (D-153)", () => {
  test("a room's approved presentations come as one zip", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call(delgado, "GET", `/events/${EVENT}/sync/approved.zip?room=${room("Ballroom A").room_id}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/zip");
    assert.match(response.headers.get("content-disposition") ?? "", /^attachment; filename="approved-ballroom-a-\d{4}-\d{2}-\d{2}\.zip"$/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString(), "PK");
    assert.match(bytes.toString("latin1"), /\d{2}-\d{2} \d{4} Robotic Surgery Outcomes[^\n]*\(v\d+\)\.pptx/, "named by time and talk");
  });

  test("a technician can't download a room that isn't theirs; no room means all of theirs", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const refused = await call(delgado, "GET", `/events/${EVENT}/sync/approved.zip?room=${room("Room 210").room_id}`);
    assert.equal(refused.status, 403);
    assert.equal(((await refused.json()) as { code: string }).code, "room.not_assigned");
    const mine = await call(delgado, "GET", `/events/${EVENT}/sync/approved.zip`);
    assert.equal(mine.status, 200);
  });

  test("a room with nothing approved says so", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call(admin, "GET", `/events/${EVENT}/sync/approved.zip?room=${room("Room 212").room_id}`);
    if (response.status === 200) return; // the local data may have an approved file there
    assert.equal(response.status, 422);
    assert.equal(((await response.json()) as { code: string }).code, "room.nothing_approved");
  });
});

describe("a technician uploads a new version a presenter brings (D-153)", () => {
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
