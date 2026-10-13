import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { withSystemScope } from "@pmp/db";
import { signInStaff } from "../helpers/signIn.ts";
import { removeTestAccounts } from "../helpers/cleanup.ts";
import { DELGADO_ID, technicianOn } from "../helpers/technician.ts";

/**
 * Checking a speaker in names the technician who helps them at the desk (D-168): one of the
 * event's DXG Technician staff, chosen by the DXG staff (admins, support) who check them in and
 * set up the desks. Only the technician records the speaker's confirmation; the receipt, a
 * hand-over and check-out are either's. A hand-over is audited.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const PASSWORD = "dxg-development-password";
const VEGA_ID = "33333333-3333-4333-8333-333333333331"; // support staff (seed)
const DAY = "2031-10-10";
const RUN = Date.now();
const SECOND_EMAIL = `probe-desk-technician-${RUN}@example.invalid`;

let up = false;
let admin = "";
let eventId = "";
let speakerId = "";
let stationId = "";
let secondId = "";
let checkinId = "";
let technician = "";

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
  eventId = ((await (
    await call("POST", "/events", { client_id: CLIENT, name: `Desk Technician Probe ${RUN}`, venue: "Probe", timezone: "America/New_York", starts_on: DAY, ends_on: DAY })
  ).json()) as { event_id: string }).event_id;
  const title = `Desk Talk ${RUN}`;
  assert.equal((await call("POST", `/events/${eventId}/sessions`, { title, room: "Probe Room", track: "", date: DAY, start: "09:00", end: "10:00" })).status, 201);
  const agenda = (await (await call("GET", `/events/${eventId}/agenda`)).json()) as { items: { presentations: { slot_id: string; title: string }[] }[] };
  const slot = agenda.items.flatMap((item) => item.presentations).find((talk) => talk.title === title)!;
  speakerId = ((await (
    await call("POST", `/events/${eventId}/speakers`, { name: `Desk Speaker ${RUN}`, email: `desk.${RUN}@example.invalid`, organization: "", slot_id: slot.slot_id })
  ).json()) as { speaker_id: string }).speaker_id;
  assert.equal((await call("PUT", `/events/${eventId}/srr-open`, { open: true })).status, 200);
  stationId = ((await (await call("POST", `/events/${eventId}/srr/stations`, { name: `Desk ${RUN}` })).json()) as { id: string }).id;
  // A second technician, for the hand-over.
  secondId = ((await (
    await call("POST", "/admin/users", { email: SECOND_EMAIL, display_name: `Second Tech ${RUN}`, account_type: "technician" })
  ).json()) as { user_id: string }).user_id;
  assert.ok(secondId, "fixture: a second technician account");
});

after(async () => {
  if (!up) return;
  if (eventId) await call("POST", `/events/${eventId}/archive`);
  await removeTestAccounts(["probe-desk-technician-"]);
});

describe("a check-in names the speaker's technician (D-168)", () => {
  test("with no technician on the event, the room offers nobody", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const room = (await (await call("GET", `/events/${eventId}/srr`)).json()) as { technicians: unknown[] };
    assert.deepEqual(room.technicians, []);
  });

  test("DXG staff check speakers in and set up desks — a technician can't", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    technician = await technicianOn(API, admin, eventId);
    const checkin = await call("POST", `/events/${eventId}/srr/checkins`, { speaker_id: speakerId, station_id: stationId, technician_id: DELGADO_ID }, technician);
    assert.equal(checkin.status, 403);
    assert.equal(await code(checkin), "auth.staff_only");
    const desk = await call("POST", `/events/${eventId}/srr/stations`, { name: `Tech Desk ${RUN}` }, technician);
    assert.equal(await code(desk), "auth.staff_only");
    const rename = await call("PATCH", `/events/${eventId}/srr/stations/${stationId}`, { name: "Renamed" }, technician);
    assert.equal(await code(rename), "auth.staff_only");
  });

  test("the technician is required, and must be one of the event's technicians", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const room = (await (await call("GET", `/events/${eventId}/srr`)).json()) as { technicians: { id: string }[] };
    assert.deepEqual(room.technicians.map((choice) => choice.id), [DELGADO_ID], "the event's technicians, nobody else");

    const none = await call("POST", `/events/${eventId}/srr/checkins`, { speaker_id: speakerId, station_id: stationId });
    assert.equal(await code(none), "srr.technician_required");
    // Support staff aren't technicians (and M. Vega isn't on this event anyway).
    const support = await call("POST", `/events/${eventId}/srr/checkins`, { speaker_id: speakerId, station_id: stationId, technician_id: VEGA_ID });
    assert.equal(support.status, 404);
    assert.equal(await code(support), "srr.technician_not_found");
    // A technician not placed on this event.
    const elsewhere = await call("POST", `/events/${eventId}/srr/checkins`, { speaker_id: speakerId, station_id: stationId, technician_id: secondId });
    assert.equal(await code(elsewhere), "srr.technician_not_found");
  });

  test("the chosen technician is recorded; only they record the speaker's confirmation", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const checkin = await call("POST", `/events/${eventId}/srr/checkins`, { speaker_id: speakerId, station_id: stationId, technician_id: DELGADO_ID });
    assert.equal(checkin.status, 201);
    checkinId = ((await checkin.json()) as { checkin_id: string }).checkin_id;
    const detail = (await (await call("GET", `/srr/checkins/${checkinId}`)).json()) as {
      checkin: { technician: string; technician_id: string };
    };
    assert.equal(detail.checkin.technician_id, DELGADO_ID);
    assert.equal(detail.checkin.technician, "C. Delgado");
    // The speaker's confirmation is the technician's; the admin who checked them in can't record it.
    const confirm = await call("POST", `/srr/checkins/${checkinId}/sign-off`, { file_version_id: "x" });
    assert.equal(confirm.status, 403);
    assert.equal(await code(confirm), "auth.technician_only");
  });

  test("handed over to another of the event's technicians, audited; anyone else refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.ok(checkinId, "needs the check-in above");
    const notHere = await call("PUT", `/srr/checkins/${checkinId}/technician`, { technician_id: secondId }, technician);
    assert.equal(await code(notHere), "srr.technician_not_found", "not on the event yet");

    const placed = await call("POST", `/admin/users/${secondId}/events`, { event_id: eventId, assign: true });
    assert.ok(placed.ok, "fixture: the second technician joins the event");
    const changed = await call("PUT", `/srr/checkins/${checkinId}/technician`, { technician_id: secondId });
    assert.equal(changed.status, 200);
    const detail = (await (await call("GET", `/srr/checkins/${checkinId}`)).json()) as { checkin: { technician_id: string } };
    assert.equal(detail.checkin.technician_id, secondId);

    const audited = await withSystemScope(async (tx) =>
      (await tx.query<{ detail: { from: string; to: string } }>(
        `SELECT detail FROM pmp.audit_records WHERE action = 'srr.technician_changed' AND subject_id = $1`,
        [checkinId],
      )).rows,
    );
    assert.deepEqual(audited.map((row) => row.detail), [{ from: DELGADO_ID, to: secondId }]);
  });

  test("never an admin or support staff — the person practising isn't offered on a practice event", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const practice = (await (await call("POST", "/practice-events")).json()) as { event_id: string };
    try {
      const room = (await (await call("GET", `/events/${practice.event_id}/srr`)).json()) as { technicians: unknown[] };
      assert.deepEqual(room.technicians, [], "the admin who started it is not a technician");
    } finally {
      await call("POST", `/events/${practice.event_id}/archive`);
    }
  });

  test("not after the speaker has checked out", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.ok(checkinId, "needs the check-in above");
    assert.equal((await call("POST", `/srr/checkins/${checkinId}/depart`, undefined, technician)).status, 200);
    const late = await call("PUT", `/srr/checkins/${checkinId}/technician`, { technician_id: DELGADO_ID }, technician);
    assert.equal(await code(late), "srr.already_departed");
  });
});
