import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { withSystemScope } from "@pmp/db";
import { signInStaff } from "../helpers/signIn.ts";
import { DELGADO_ID, technicianOn } from "../helpers/technician.ts";

/**
 * A speaker taken off their session while sitting at a Speaker Ready Room desk (found on
 * production, 2026-10-12): the desk showed "In session" with no way in, and their check-in
 * page crashed. Their visit must still open and check out, the desk must link to it by
 * visit (not by name), and removing a speaker checks them out.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const PASSWORD = "dxg-development-password";
const DAY = "2031-10-10";
const RUN = Date.now();

let up = false;
let admin = "";
let eventId = "";
const speakers: string[] = [];
const stations: string[] = [];

const call = (method: string, path: string, body?: unknown, cookie = admin) =>
  fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);
  eventId = ((await (
    await call("POST", "/events", { client_id: CLIENT, name: `Desk Probe ${RUN}`, venue: "Probe", timezone: "America/New_York", starts_on: DAY, ends_on: DAY })
  ).json()) as { event_id: string }).event_id;
  assert.equal((await call("PUT", `/events/${eventId}/srr-open`, { open: true })).status, 200);
  for (const n of [1, 2]) {
    const title = `Desk Talk ${n} ${RUN}`;
    assert.equal((await call("POST", `/events/${eventId}/sessions`, { title, room: "Probe Room", track: "", date: DAY, start: `1${n}:00`, end: `1${n}:30` })).status, 201);
    const agenda = (await (await call("GET", `/events/${eventId}/agenda`)).json()) as { items: { presentations: { slot_id: string; title: string }[] }[] };
    const slot = agenda.items.flatMap((item) => item.presentations).find((talk) => talk.title === title)!;
    speakers.push(((await (
      await call("POST", `/events/${eventId}/speakers`, { name: `=Same Name ${RUN}`, email: `desk${n}.${RUN}@example.invalid`, organization: "", slot_id: slot.slot_id })
    ).json()) as { speaker_id: string }).speaker_id);
    stations.push(((await (await call("POST", `/events/${eventId}/srr/stations`, { name: `Desk ${n}` })).json()) as { id: string }).id);
  }
});

after(async () => {
  if (up && eventId) await call("POST", `/events/${eventId}/archive`);
});

describe("a desk whose speaker has no talk any more", () => {
  test("each desk links to its own visit, even when two speakers share a name", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const ids: string[] = [];
    // The desk is the technician's (D-168): they check the speakers in.
    const technician = await technicianOn(API, admin, eventId);
    for (const [i, speaker] of speakers.entries()) {
      const checkin = await call("POST", `/events/${eventId}/srr/checkins`, { speaker_id: speaker, station_id: stations[i], technician_id: DELGADO_ID }, technician);
      assert.equal(checkin.status, 201);
      ids.push(((await checkin.json()) as { checkin_id: string }).checkin_id);
    }
    const room = (await (await call("GET", `/events/${eventId}/srr`)).json()) as { stations: { id: string; checkin_id: string | null }[] };
    assert.deepEqual(stations.map((id) => room.stations.find((station) => station.id === id)?.checkin_id), ids);
  });

  test("a name that looks like a formula is written to the report as text", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const csv = await (await call("GET", `/events/${eventId}/srr/report.csv`)).text();
    assert.ok(csv.includes(`'=Same Name ${RUN}`), "prefixed with an apostrophe so Excel does not run it");
  });

  test("taken off their session, their check-in still opens and checks out", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const room = (await (await call("GET", `/events/${eventId}/srr`)).json()) as { stations: { id: string; checkin_id: string | null }[] };
    const checkinId = room.stations.find((station) => station.id === stations[0])!.checkin_id!;
    await withSystemScope((tx) => tx.query(`DELETE FROM pmp.speaker_assignments WHERE speaker_id = $1`, [speakers[0]]));
    const detail = await call("GET", `/srr/checkins/${checkinId}`);
    assert.equal(detail.status, 200, "it used to be 404, which crashed the page");
    const body = (await detail.json()) as { talk: { slot_id: string | null } };
    assert.equal(body.talk.slot_id, null);
    const technician = await technicianOn(API, admin, eventId);
    const intake = await call("POST", `/srr/checkins/${checkinId}/usb-ingestions`, { upload_id: "x", file_name: "x.pptx", reason: "probe" }, technician);
    assert.equal(intake.status, 409, "nothing to take a file in for");
    assert.equal((await call("POST", `/srr/checkins/${checkinId}/depart`, undefined, technician)).status, 200, "and the desk can be freed");
  });

  test("removing a speaker who is at a desk checks them out", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await call("DELETE", `/events/${eventId}/speakers/${speakers[1]}`)).status, 200);
    const room = (await (await call("GET", `/events/${eventId}/srr`)).json()) as { stations: { id: string; busy: boolean }[] };
    assert.equal(room.stations.find((station) => station.id === stations[1])?.busy, false);
  });
});
