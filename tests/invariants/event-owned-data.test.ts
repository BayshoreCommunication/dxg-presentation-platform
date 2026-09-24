import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { removeTestEvents } from "../helpers/cleanup.ts";

/**
 * D-080: what a screen shows about an event comes from that event.
 *
 * Each case here was a literal once — the Speaker Ready Room's three stations and the
 * "Station 2" every check-in was recorded at, the Room Agent's holding slide that named
 * one seeded event, New York time on every event's talk screens, and email templates
 * nobody could edit. The tests prove the data now belongs to the event: a new event
 * starts with none of the old literals, and what staff set is what comes back.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const MEDTECH = "22222222-2222-4222-8222-222222222222";
const PROBE_EVENT = "Owned Data Probe";

let up = false;
let admin = "";
let probeId = "";

const call = (path: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie: admin, ...(init.headers ?? {}) },
  });

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);
  const created = (await (
    await call("/events", {
      method: "POST",
      body: JSON.stringify({
        name: `${PROBE_EVENT} ${Date.now()}`,
        venue: "Elsewhere",
        timezone: "Europe/Berlin",
        starts_on: "2027-08-01",
        ends_on: "2027-08-02",
      }),
    })
  ).json()) as { event_id: string };
  probeId = created.event_id;
});

after(async () => {
  if (!up) return;
  await removeTestEvents([PROBE_EVENT]);
});

type Station = { id: string; name: string; busy: boolean };
const stations = async (eventId: string): Promise<Station[]> =>
  ((await (await call(`/events/${eventId}/srr`)).json()) as { stations: Station[] }).stations;

describe("Speaker Ready Room stations belong to the event", () => {
  test("a new event starts with no stations — not the old three", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.deepEqual(await stations(probeId), []);
  });

  test("stations are added, renamed and retired, and names stay unique", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const added = await call(`/events/${probeId}/srr/stations`, { method: "POST", body: JSON.stringify({ name: "Front desk" }) });
    assert.equal(added.status, 201);
    const station = (await added.json()) as Station;

    const duplicate = await call(`/events/${probeId}/srr/stations`, {
      method: "POST",
      body: JSON.stringify({ name: "  front DESK " }),
    });
    assert.equal(duplicate.status, 409, "the same name, differently cased and spaced, is still the same desk");

    const renamed = await call(`/events/${probeId}/srr/stations/${station.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Desk A" }),
    });
    assert.equal(renamed.status, 200);
    assert.deepEqual((await stations(probeId)).map((row) => row.name), ["Desk A"]);

    const retired = await call(`/events/${probeId}/srr/stations/${station.id}`, { method: "DELETE" });
    assert.equal(retired.status, 200);
    assert.deepEqual(await stations(probeId), []);
  });

  test("a check-in must name a station, and one of this event's", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const dashboard = (await (await call(`/events/${MEDTECH}/srr`)).json()) as {
      expected: { speaker_id: string; checkin_id: string | null }[];
    };
    const speaker = dashboard.expected.find((row) => !row.checkin_id);
    assert.ok(speaker, "fixture: a speaker not checked in");

    const none = await call(`/events/${MEDTECH}/srr/checkins`, {
      method: "POST",
      body: JSON.stringify({ speaker_id: speaker.speaker_id }),
    });
    assert.equal(none.status, 400, "there is no default station any more");

    const foreign = await call(`/events/${probeId}/srr/stations`, { method: "POST", body: JSON.stringify({ name: "Elsewhere desk" }) });
    const foreignStation = (await foreign.json()) as Station;
    const wrongEvent = await call(`/events/${MEDTECH}/srr/checkins`, {
      method: "POST",
      body: JSON.stringify({ speaker_id: speaker.speaker_id, station_id: foreignStation.id }),
    });
    assert.equal(wrongEvent.status, 404, "another event's desk is not a desk here");
  });
});

describe("email templates are editable, within what sending can fill in", () => {
  test("an edit is saved, and unknown fields or a missing link are refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const comms = (await (await call(`/events/${probeId}/comms`)).json()) as {
      templates: { id: string; subject: string; body: string }[];
      merge_fields: string[];
    };
    const template = comms.templates[0]!;
    assert.ok(comms.merge_fields.includes("upload_link"));

    const patch = (body: { subject: string; body: string }) =>
      call(`/events/${probeId}/comms/templates/${template.id}`, { method: "PATCH", body: JSON.stringify(body) });

    assert.equal((await patch({ subject: template.subject, body: `${template.body}\n{{shoe_size}}` })).status, 422);
    assert.equal(
      (await patch({ subject: template.subject, body: template.body.replace("{{upload_link}}", "") })).status,
      422,
      "without the link the speaker cannot upload",
    );

    const saved = await patch({ subject: "Your slides for {{event_name}}", body: "Hello {{speaker_name}}\n\n{{upload_link}}" });
    assert.equal(saved.status, 200);
    const after = (await (await call(`/events/${probeId}/comms`)).json()) as typeof comms;
    assert.equal(after.templates.find((row) => row.id === template.id)?.subject, "Your slides for {{event_name}}");
  });
});

describe("screens read the event's own name and clock", () => {
  test("the Room Agent's holding slide names the room's own event", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const fleet = (await (await call(`/events/${MEDTECH}/sync/fleet`)).json()) as { items: { room_id: string }[] };
    const view = (await (await call(`/rooms/${fleet.items[0]!.room_id}/agent-view`)).json()) as {
      event: { id: string; name: string; timezone: string };
    };
    const summary = (await (await call(`/events/${MEDTECH}/summary`)).json()) as {
      event: { name: string; timezone: string };
    };
    assert.equal(view.event.id, MEDTECH);
    assert.equal(view.event.name, summary.event.name);
    assert.equal(view.event.timezone, summary.event.timezone);
  });

  test("a talk's screen carries its event's timezone", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const talks = (await (await call(`/events/${MEDTECH}/talks`)).json()) as { items: { slot_id: string }[] };
    const detail = (await (await call(`/slots/${talks.items[0]!.slot_id}`)).json()) as {
      event: { id: string; timezone: string };
    };
    assert.equal(detail.event.id, MEDTECH);
    assert.ok(detail.event.timezone.includes("/"), "an IANA zone, from the event row");
  });
});
