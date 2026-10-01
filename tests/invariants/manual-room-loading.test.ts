import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { writeZip } from "../../packages/files/src/zipWrite.ts";
import { withSystemScope } from "@pmp/db";
import { signInStaff } from "../helpers/signIn.ts";
import { createStaffAccount, grantRole } from "../helpers/account.ts";
import { removeTestAccounts } from "../helpers/cleanup.ts";

/**
 * Room PCs are loaded and checked by hand (D-125, Travis's call). DXG staff copy each
 * approved file onto the room's presentation PC and tick it "loaded" on Room sync; the
 * platform no longer asks whether a room PC is set up or reporting. So a room is ready
 * when every tick is in — with no room PC ever having reported — and a newer approval
 * waits ("Update pending ack") until it, too, is loaded and ticked.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const NAME = "Manual Room Loading Probe";
const DAY = "2031-08-20";
const RUN = Date.now();
// Each run gets its own room, so earlier runs' talks never decide this room's readiness.
const ROOM = `Loading Room ${RUN}`;
const REVIEWER_EMAIL = `probe-loading-reviewer-${RUN}@example.invalid`;

let up = false;
let admin = "";
let reviewer = "";
let eventId = "";
let checkinId = "";
let slotId = "";
let roomId = "";
let v1 = "";
let v2 = "";

const as = (cookie: string) => (method: string, path: string, body?: unknown) =>
  fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const call = (method: string, path: string, body?: unknown) => as(admin)(method, path, body);

type FleetTalk = {
  slot_id: string;
  status: string;
  approved: {
    file_version_id: string;
    version_number: number;
    download_url: string;
    room_file_id: string | null;
    lock_version: number | null;
    sync_state: string | null;
    loaded: boolean;
  } | null;
  loaded_other_version: number | null;
};
type FleetRoom = { room_id: string; room: string; readiness: string; heartbeat_age: number | null; talks: FleetTalk[] };

const room = async (): Promise<FleetRoom> => {
  const { items } = (await (await call("GET", `/events/${eventId}/sync/fleet`)).json()) as { items: FleetRoom[] };
  return items.find((item) => item.room === ROOM)!;
};
const talk = async (): Promise<FleetTalk> => (await room()).talks.find((item) => item.slot_id === slotId)!;
const talkStatus = async (): Promise<string> =>
  ((await (await call("GET", `/slots/${slotId}`)).json()) as { talk: { status: string } }).talk.status;

/** A USB file through the Speaker Ready Room, scanned and inspected, then approved. */
async function approvedVersion(label: string): Promise<string> {
  const deck = writeZip([
    { name: "[Content_Types].xml", body: Buffer.from('<?xml version="1.0"?><Types/>') },
    { name: "ppt/presentation.xml", body: Buffer.from('<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>') },
    { name: "ppt/slides/slide1.xml", body: Buffer.from(`<p:sld><!-- ${label} ${RUN} --></p:sld>`) },
  ]);
  const { upload_id } = (await (await call("POST", "/srr/uploads", {})).json()) as { upload_id: string };
  const part = await fetch(`${API}/srr/uploads/${upload_id}/parts/1`, {
    method: "PUT",
    headers: { cookie: admin, "content-type": "application/octet-stream" },
    body: deck,
  });
  assert.equal(part.status, 200);
  const ingested = await call("POST", `/srr/checkins/${checkinId}/usb-ingestions`, {
    upload_id,
    file_name: `${label}.pptx`,
    reason: "manual room loading probe",
  });
  assert.equal(ingested.status, 200);
  const { file_version_id } = (await ingested.json()) as { file_version_id: string };
  for (const action of ["claim", "approve"]) {
    const lock = await withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ lock_version: number }>(
        `SELECT lock_version FROM pmp.file_versions WHERE id = $1`,
        [file_version_id],
      );
      return rows[0]!.lock_version;
    });
    const response = await call("POST", `/file-versions/${file_version_id}:transition`, { action, lock_version: lock });
    assert.equal(response.status, 200, `${action} ${label}`);
  }
  return file_version_id;
}

const tick = (cookie: string, path: "loaded" | "unloaded", roomFileId: string, lockVersion: number) =>
  as(cookie)("POST", `/room-files/${roomFileId}/${path}`, { lock_version: lockVersion });

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", "dxg-development-password");

  // One event, reused across runs (its check-ins and approvals are history and stay).
  const events = (await (await call("GET", "/events")).json()) as { items: { id: string; name: string; status: string }[] };
  const probe = events.items.find((item) => item.name === NAME);
  eventId = probe?.id ?? "";
  if (probe?.status === "archived") await call("POST", `/events/${eventId}/restore`);
  if (!eventId) {
    const created = (await (
      await call("POST", "/events", { client_id: CLIENT, name: NAME, venue: "Probe", timezone: "America/New_York", starts_on: DAY, ends_on: DAY })
    ).json()) as { event_id: string };
    eventId = created.event_id;
  }

  const title = `Loading Talk ${RUN}`;
  assert.equal(
    (await call("POST", `/events/${eventId}/sessions`, { title, room: ROOM, track: "", date: DAY, start: "09:00", end: "10:00" })).status,
    201,
  );
  const agenda = (await (await call("GET", `/events/${eventId}/agenda`)).json()) as {
    items: { presentations: { slot_id: string; title: string }[] }[];
  };
  slotId = agenda.items.flatMap((item) => item.presentations).find((item) => item.title === title)!.slot_id;
  const speaker = (await (
    await call("POST", `/events/${eventId}/speakers`, {
      name: `Loading Speaker ${RUN}`,
      email: `loading.${RUN}@example.invalid`,
      organization: "",
      slot_id: slotId,
    })
  ).json()) as { speaker_id: string };
  const station = (await (await call("POST", `/events/${eventId}/srr/stations`, { name: `Loading Desk ${RUN}` })).json()) as { id: string };
  const checkin = await call("POST", `/events/${eventId}/srr/checkins`, { speaker_id: speaker.speaker_id, station_id: station.id });
  assert.equal(checkin.status, 201);
  checkinId = ((await checkin.json()) as { checkin_id: string }).checkin_id;

  const account = await createStaffAccount(API, admin, {
    email: REVIEWER_EMAIL,
    displayName: "Loading Probe Reviewer",
    password: "probe-loading-password",
  });
  reviewer = account.cookie;
  await grantRole(API, admin, account.userId, eventId, "content_reviewer");

  roomId = (await room()).room_id;
});

after(async () => {
  if (!up) return;
  await removeTestAccounts(["probe-loading-reviewer-"]);
  if (eventId) await call("POST", `/events/${eventId}/archive`);
});

describe("room PCs are loaded and ticked by hand (D-125)", () => {
  test("an approved version waits to be loaded; its room is not ready", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    v1 = await approvedVersion("first");
    assert.equal(await talkStatus(), "approved_delivering");
    const here = await room();
    assert.equal(here.readiness, "attention");
    assert.equal(here.heartbeat_age, null, "no room PC has ever reported for this room");
    const row = await talk();
    assert.equal(row.approved?.file_version_id, v1);
    assert.equal(row.approved?.loaded, false);
    assert.equal(row.approved?.download_url, `/api/v1/file-versions/${v1}/download`);
    // The link is the staff download the Files screen uses, and it serves the file.
    assert.equal((await call("GET", `/file-versions/${v1}/download`)).status, 200);
  });

  test("a content reviewer cannot tick it loaded", async (t: TestContext) => {
    if (!up || !v1) return t.skip("API not running");
    const row = (await talk()).approved!;
    const refused = await tick(reviewer, "loaded", row.room_file_id!, row.lock_version!);
    assert.equal(refused.status, 403);
    assert.equal(((await refused.json()) as { code: string }).code, "room_sync.forbidden");
    assert.equal((await talk()).approved?.loaded, false);
  });

  test("a stale lock is refused with a conflict", async (t: TestContext) => {
    if (!up || !v1) return t.skip("API not running");
    const row = (await talk()).approved!;
    const stale = await tick(admin, "loaded", row.room_file_id!, row.lock_version! - 1);
    assert.equal(stale.status, 409);
    assert.equal(((await stale.json()) as { code: string }).code, "room_sync.conflict");
  });

  test("ticked loaded, the talk is Synchronized onsite and the room Ready — no room PC needed", async (t: TestContext) => {
    if (!up || !v1) return t.skip("API not running");
    const row = (await talk()).approved!;
    const loaded = await tick(admin, "loaded", row.room_file_id!, row.lock_version!);
    assert.equal(loaded.status, 200);
    assert.equal(((await loaded.json()) as { sync_state: string }).sync_state, "active");
    assert.equal(await talkStatus(), "synchronized_onsite");
    const here = await room();
    assert.equal(here.readiness, "ready");
    assert.equal(here.heartbeat_age, null);
    // Recorded like every other room change.
    const recorded = await withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pmp.workflow_transitions
          WHERE subject_id = $1 AND action = 'mark_loaded' AND to_state = 'active'`,
        [row.room_file_id],
      );
      return rows[0]!.n;
    });
    assert.equal(recorded, 1);
    // The room view's Launch rule is unchanged: the loaded copy is the launchable one.
    const view = (await (await call("GET", `/rooms/${roomId}/agent-view`)).json()) as {
      schedule: { slot_id: string; launchable: boolean; sync_state: string | null }[];
    };
    assert.equal(view.schedule.find((item) => item.slot_id === slotId)?.launchable, true);

    // D-128: Launch is recorded by the person who pressed it — there is no room PC.
    const launched = await call("POST", `/rooms/${roomId}/launch`, { slot_id: slotId });
    assert.equal(((await launched.json()) as { launched: boolean }).launched, true);
    const after = (await (await call("GET", `/rooms/${roomId}/agent-view`)).json()) as {
      schedule: { slot_id: string; presented_at: string | null }[];
    };
    assert.ok(after.schedule.find((item) => item.slot_id === slotId)?.presented_at, "shown as presented");
  });

  test("a newer approval is Update pending ack until it is loaded; loading it replaces the old copy", async (t: TestContext) => {
    if (!up || !v1) return t.skip("API not running");
    const oldCopy = (await talk()).approved!.room_file_id!;
    v2 = await approvedVersion("second");
    assert.equal(await talkStatus(), "update_pending_ack");
    const waiting = await talk();
    assert.equal(waiting.approved?.file_version_id, v2);
    assert.equal(waiting.approved?.loaded, false);
    assert.equal(waiting.loaded_other_version, 1, "the room still has v1");
    assert.equal((await room()).readiness, "attention");

    const loaded = await tick(admin, "loaded", waiting.approved!.room_file_id!, waiting.approved!.lock_version!);
    assert.equal(loaded.status, 200);
    assert.equal(await talkStatus(), "synchronized_onsite");
    assert.equal((await room()).readiness, "ready");
    assert.equal((await talk()).loaded_other_version, null);
    const oldState = await withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ sync_state: string }>(`SELECT sync_state FROM pmp.room_files WHERE id = $1`, [oldCopy]);
      return rows[0]!.sync_state;
    });
    assert.equal(oldState, "obsolete");
  });

  test("an older version's copy can no longer be ticked", async (t: TestContext) => {
    if (!up || !v2) return t.skip("API not running");
    // Put v1's copy back to "not loaded" behind the API's back: it is not the approved version.
    const old = await withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ id: string; lock_version: number }>(
        `UPDATE pmp.room_files SET sync_state = 'assigned', lock_version = lock_version + 1
          WHERE file_version_id = $1 AND room_id = $2 RETURNING id, lock_version`,
        [v1, roomId],
      );
      return rows[0]!;
    });
    const refused = await tick(admin, "loaded", old.id, old.lock_version);
    assert.equal(refused.status, 409);
    assert.equal(((await refused.json()) as { code: string }).code, "room_sync.not_approved");
    await withSystemScope((tx) =>
      tx.query(`UPDATE pmp.room_files SET sync_state = 'obsolete', lock_version = lock_version + 1 WHERE id = $1`, [old.id]),
    );
  });

  test("a mistaken tick is taken back: not loaded yet again", async (t: TestContext) => {
    if (!up || !v2) return t.skip("API not running");
    const row = (await talk()).approved!;
    assert.equal((await tick(reviewer, "unloaded", row.room_file_id!, row.lock_version!)).status, 403);
    const undone = await tick(admin, "unloaded", row.room_file_id!, row.lock_version!);
    assert.equal(undone.status, 200);
    assert.equal(((await undone.json()) as { sync_state: string }).sync_state, "assigned");
    assert.equal((await talk()).approved?.loaded, false);
    assert.equal(await talkStatus(), "approved_delivering");
    assert.equal((await room()).readiness, "attention");
  });
});
