import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { removeTestEvents } from "../helpers/cleanup.ts";

/**
 * A room computer's check-in must carry its device key (D-077). Before this,
 * `POST /agent/heartbeat` took a bare room id, so anyone who knew one could report
 * that room online and "Rooms ready" would count it.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const NAME = "Device Key Probe";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const AGENDA = [
  "Session Title,Session Location,Session Date,Session Start,Session End",
  "Key Probe Session,Probe Hall,06/01/2027,9:00 AM,10:00 AM",
  "Second Probe Session,Other Hall,06/01/2027,11:00 AM,12:00 PM",
].join("\n");

let up = false;
let staff = "";
let eventId = "";
let roomId = "";
let otherRoomId = "";

const json = (cookie: string) => ({ "content-type": "application/json", cookie });
const heartbeat = (key: string | null, body: Record<string, unknown> = {}) =>
  fetch(`${API}/agent/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ agent_version: "probe", ...body }),
  });
const fleet = async () =>
  ((await (await fetch(`${API}/events/${eventId}/sync/fleet`, { headers: { cookie: staff } })).json()) as {
    items: { room_id: string; heartbeat_age: number | null; key_issued_at: string | null }[];
  }).items;

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  staff = await signInStaff(API, "admin@example.invalid", PASSWORD);
  const created = (await (
    await fetch(`${API}/events`, {
      method: "POST",
      headers: json(staff),
      body: JSON.stringify({
        client_id: CLIENT,
        name: NAME,
        venue: "Probe Venue",
        timezone: "America/New_York",
        starts_on: "2027-06-01",
        ends_on: "2027-06-01",
      }),
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
  await fetch(`${API}/imports/${preview.upload_id}/commit`, {
    method: "POST",
    headers: json(staff),
    body: JSON.stringify({ rows: preview.rows }),
  });
  const rooms = await fleet();
  roomId = rooms[0]!.room_id;
  otherRoomId = rooms[1]!.room_id;
});

after(async () => {
  if (up) await removeTestEvents([NAME]);
});

describe("room computers authenticate their check-ins", () => {
  test("a check-in with no key is refused, even naming a real room", async (t: TestContext) => {
    if (!up || !roomId) return t.skip("API not running");
    const response = await heartbeat(null, { room_id: roomId });
    assert.equal(response.status, 401);
  });

  test("a room's issued key is accepted, and counts for that room only", async (t: TestContext) => {
    if (!up || !roomId) return t.skip("API not running");
    const issued = await fetch(`${API}/rooms/${roomId}/device-key`, { method: "POST", headers: { cookie: staff } });
    assert.equal(issued.status, 201);
    const { device_key } = (await issued.json()) as { device_key: string };

    // Naming another room in the body changes nothing: the key decides the room.
    const response = await heartbeat(device_key, { room_id: otherRoomId });
    assert.equal(response.status, 200);
    const rooms = await fleet();
    assert.ok((rooms.find((room) => room.room_id === roomId)!.heartbeat_age ?? 999) < 60, "this room is online");
    assert.equal(rooms.find((room) => room.room_id === otherRoomId)!.heartbeat_age, null, "the other room is not");
    assert.ok(rooms.find((room) => room.room_id === roomId)!.key_issued_at);
  });

  test("a wrong secret for a real agent is refused", async (t: TestContext) => {
    if (!up || !roomId) return t.skip("API not running");
    const { device_key } = (await (
      await fetch(`${API}/rooms/${roomId}/device-key`, { method: "POST", headers: { cookie: staff } })
    ).json()) as { device_key: string };
    const [agentId] = device_key.split(".");
    assert.equal((await heartbeat(`${agentId}.not-the-right-secret-at-all`)).status, 401);
  });

  test("issuing a new key cancels the old one", async (t: TestContext) => {
    if (!up || !roomId) return t.skip("API not running");
    const first = (await (
      await fetch(`${API}/rooms/${roomId}/device-key`, { method: "POST", headers: { cookie: staff } })
    ).json()) as { device_key: string };
    const second = (await (
      await fetch(`${API}/rooms/${roomId}/device-key`, { method: "POST", headers: { cookie: staff } })
    ).json()) as { device_key: string };
    assert.equal((await heartbeat(first.device_key)).status, 401, "the replaced key no longer works");
    assert.equal((await heartbeat(second.device_key)).status, 200);
  });

  test("issuing a key needs a staff session", async (t: TestContext) => {
    if (!up || !roomId) return t.skip("API not running");
    assert.equal((await fetch(`${API}/rooms/${roomId}/device-key`, { method: "POST" })).status, 401);
  });
});
