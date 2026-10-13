import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { DELGADO_ID, placeTechnician, technicianOn } from "../helpers/technician.ts";

/**
 * The Speaker Ready Room's event-day switch (client review, D-157): a new event's room
 * starts closed; DXG Admins and support staff open it on the day. While closed nobody checks
 * in, takes a file in at a check-in or signs off — setting up desks, checking out and the
 * report still work.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const SEED_EVENT = "22222222-2222-4222-8222-222222222222";
const PASSWORD = "dxg-development-password";
const DAY = "2031-09-09";
const RUN = Date.now();

let up = false;
let admin = "";
let eventId = "";
let speakerId = "";
let stationId = "";

const call = (method: string, path: string, body?: unknown, cookie = admin) =>
  fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const code = async (response: Response) => ((await response.json()) as { code: string }).code;

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);
  // A fresh event every run: the point is how a new one starts.
  const created = (await (
    await call("POST", "/events", { client_id: CLIENT, name: `SRR Switch Probe ${RUN}`, venue: "Probe", timezone: "America/New_York", starts_on: DAY, ends_on: DAY })
  ).json()) as { event_id: string };
  eventId = created.event_id;
  const title = `Switch Talk ${RUN}`;
  assert.equal((await call("POST", `/events/${eventId}/sessions`, { title, room: "Probe Room", track: "", date: DAY, start: "09:00", end: "10:00" })).status, 201);
  const agenda = (await (await call("GET", `/events/${eventId}/agenda`)).json()) as { items: { presentations: { slot_id: string; title: string }[] }[] };
  const slot = agenda.items.flatMap((item) => item.presentations).find((talk) => talk.title === title)!;
  speakerId = ((await (
    await call("POST", `/events/${eventId}/speakers`, { name: `Switch Speaker ${RUN}`, email: `switch.${RUN}@example.invalid`, organization: "", slot_id: slot.slot_id })
  ).json()) as { speaker_id: string }).speaker_id;
});

after(async () => {
  if (up && eventId) await call("POST", `/events/${eventId}/archive`);
});

describe("a new event's Speaker Ready Room starts closed (D-157)", () => {
  test("it says so; desks can be set up, but no one checks in", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const room = (await (await call("GET", `/events/${eventId}/srr`)).json()) as { open: boolean };
    assert.equal(room.open, false);
    const summary = (await (await call("GET", `/events/${eventId}/summary`)).json()) as { event: { srr_open: boolean } };
    assert.equal(summary.event.srr_open, false);
    const desk = await call("POST", `/events/${eventId}/srr/stations`, { name: "Desk 1" });
    assert.equal(desk.status, 201, "setting up before the day is fine");
    stationId = ((await desk.json()) as { id: string }).id;
    const refused = await call("POST", `/events/${eventId}/srr/checkins`, { speaker_id: speakerId, station_id: stationId, technician_id: DELGADO_ID });
    assert.equal(refused.status, 409);
    assert.equal(await code(refused), "srr.closed_conflict");
  });

  test("a technician can't open it", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const technician = await signInStaff(API, "c.delgado@example.invalid", PASSWORD);
    const refused = await call("PUT", `/events/${SEED_EVENT}/srr-open`, { open: false }, technician);
    assert.equal(refused.status, 403);
  });

  test("opened, speakers check in; closed again, sign-off and intake stop but checkout still works", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await call("PUT", `/events/${eventId}/srr-open`, { open: true })).status, 200);
    await placeTechnician(API, admin, eventId);
    const checkin = await call("POST", `/events/${eventId}/srr/checkins`, { speaker_id: speakerId, station_id: stationId, technician_id: DELGADO_ID });
    assert.equal(checkin.status, 201);
    const { checkin_id } = (await checkin.json()) as { checkin_id: string };

    assert.equal((await call("PUT", `/events/${eventId}/srr-open`, { open: false })).status, 200);
    const signOff = await call("POST", `/srr/checkins/${checkin_id}/sign-off`, { file_version_id: "00000000-0000-4000-8000-000000000000" });
    assert.notEqual(signOff.status, 200, "no sign-off while closed");
    // Taking a file in is the technician's (D-162); closed, even they are stopped.
    const technician = await technicianOn(API, admin, eventId);
    const intake = await call("POST", `/srr/checkins/${checkin_id}/usb-ingestions`, { upload_id: "x", file_name: "x.pptx", reason: "probe" }, technician);
    assert.equal(intake.status, 409);
    assert.equal(await code(intake), "srr.closed_conflict");
    assert.equal((await call("POST", `/srr/checkins/${checkin_id}/depart`)).status, 200, "a speaker at a desk can still leave");
    assert.equal((await call("GET", `/events/${eventId}/srr/report.csv`)).status, 200, "the report still downloads");
  });
});

describe("support staff run the Speaker Ready Room (D-164)", () => {
  test("they switch it, set up a desk, check a speaker in and out and get the report — but take no file in", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    // M. Vega (seeded DXG Support staff), placed on this event the way DXG does it.
    const placed = await call("POST", "/admin/users/33333333-3333-4333-8333-333333333331/events", { event_id: eventId, assign: true });
    assert.equal(placed.status, 200);
    const support = await signInStaff(API, "m.vega@example.invalid", PASSWORD);
    assert.equal((await call("GET", `/events/${eventId}/srr`, undefined, support)).status, 200);
    assert.equal((await call("PUT", `/events/${eventId}/srr-open`, { open: true }, support)).status, 200, "the switch");
    const desk = await call("POST", `/events/${eventId}/srr/stations`, { name: `Support Desk ${RUN}` }, support);
    assert.equal(desk.status, 201, "a desk");
    const checkin = await call("POST", `/events/${eventId}/srr/checkins`, { speaker_id: speakerId, station_id: ((await desk.json()) as { id: string }).id, technician_id: DELGADO_ID }, support);
    assert.equal(checkin.status, 201, "check-in");
    const { checkin_id } = (await checkin.json()) as { checkin_id: string };
    assert.equal((await call("GET", `/srr/checkins/${checkin_id}`, undefined, support)).status, 200, "the check-in page");
    const intake = await call("POST", `/srr/checkins/${checkin_id}/usb-ingestions`, { upload_id: "x", file_name: "x.pptx", reason: "probe" }, support);
    assert.equal(intake.status, 403);
    assert.equal(await code(intake), "auth.technician_only", "Local intake stays the technicians'");
    assert.equal((await call("POST", `/srr/checkins/${checkin_id}/depart`, undefined, support)).status, 200, "check-out");
    assert.equal((await call("GET", `/events/${eventId}/srr/report.csv`, undefined, support)).status, 200, "the report");
  });
});
