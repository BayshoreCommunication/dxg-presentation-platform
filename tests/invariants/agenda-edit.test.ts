import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { getOwnerPool } from "@pmp/db";
import { removeTestEvents } from "../helpers/cleanup.ts";

/**
 * Editing the agenda from the event details (D-064): sessions, presentations and
 * presenters change one at a time, times are read on the event's clock, bad input is
 * refused with a reason, and an archived event refuses all of it (D-062).
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const NAME = "Agenda Edit Probe";
const CLIENT = "11111111-1111-4111-8111-111111111111";

let up = false;
let admin = "";
let eventId = "";
let sessionId = "";
let slotId = "";

const json = (cookie: string) => ({ "content-type": "application/json", cookie });
const call = (method: string, path: string, body?: unknown) =>
  fetch(`${API}${path}`, {
    method,
    headers: json(admin),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

type Agenda = {
  items: {
    id: string;
    title: string;
    room: string | null;
    track: string | null;
    state: string;
    starts_at: string;
    presentations: { slot_id: string; title: string; starts_at: string | null; speakers: { id: string; name: string }[] }[];
  }[];
};
const agenda = async (): Promise<Agenda["items"]> =>
  ((await (await call("GET", `/events/${eventId}/agenda`)).json()) as Agenda).items;

const SESSION = {
  title: "Opening Keynote",
  room: "Hall A",
  track: "Plenary",
  date: "2027-06-01",
  start: "09:00",
  end: "10:00",
};

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);
  const created = (await (
    await call("POST", "/events", {
      client_id: CLIENT,
      name: NAME,
      venue: "Tampa Convention Center",
      timezone: "America/New_York",
      starts_on: "2027-06-01",
      ends_on: "2027-06-02",
    })
  ).json()) as { event_id: string };
  eventId = created.event_id;
});

after(async () => {
  if (!up) return;
  /*
   * The archive test below archives and restores the probe, which writes workflow
   * history, and `removeTestEvents` keeps history — so the probe used to be archived
   * instead of deleted, one more copy every run (32 by 2026-09-28). That history is
   * this suite's own test traffic on its own probe, so it goes first; every earlier
   * copy by this name is cleared with it.
   */
  // The same guard as the helper: history is only ever cleared in a development database.
  if (!/^pmp_(dev|test)/.test(process.env.PGDATABASE ?? "pmp_dev")) return;
  // As the database owner: the app's role may not delete history at all (append-only).
  const owner = getOwnerPool();
  await owner.query(
    `DELETE FROM pmp.workflow_transitions
      WHERE event_id IN (SELECT id FROM pmp.events WHERE name = $1)`,
    [NAME],
  );
  await owner.end();
  await removeTestEvents([NAME]);
});

describe("sessions", () => {
  test("a session is added with its presenter, on the event's clock", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call("POST", `/events/${eventId}/sessions`, {
      ...SESSION,
      presenter: { name: "Probe Keynoter", email: "keynote.probe@example.invalid", organization: "Probe Org" },
    });
    assert.equal(response.status, 201);
    sessionId = ((await response.json()) as { session_id: string }).session_id;
    const [session] = await agenda();
    assert.equal(session!.title, "Opening Keynote");
    assert.equal(session!.room, "Hall A");
    assert.equal(session!.track, "Plenary");
    // 09:00 in New York in June is 13:00 UTC — the server's own zone must not leak in.
    assert.equal(session!.starts_at, "2027-06-01T13:00:00.000Z");
    slotId = session!.presentations[0]!.slot_id;
    assert.deepEqual(
      session!.presentations[0]!.speakers.map((person) => person.name),
      ["Probe Keynoter"],
    );
  });

  test("editing it changes that session, including its location", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call("PATCH", `/events/${eventId}/sessions/${sessionId}`, {
      ...SESSION,
      title: "Opening Keynote (revised)",
      room: "Hall B",
      start: "09:30",
      end: "10:30",
    });
    assert.equal(response.status, 200);
    const sessions = await agenda();
    assert.equal(sessions.length, 1, "edited in place, not duplicated");
    assert.equal(sessions[0]!.title, "Opening Keynote (revised)");
    assert.equal(sessions[0]!.room, "Hall B");
    assert.equal(sessions[0]!.starts_at, "2027-06-01T13:30:00.000Z");
  });

  test("a presentation named after its session is renamed with it; one with its own name is not", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    // The session's own presentation took the session's title on creation (D-064) and
    // followed the rename above (D-130).
    const [before] = await agenda();
    const own = before!.presentations.find((item) => item.slot_id === slotId)!;
    assert.equal(own.title, "Opening Keynote (revised)", "the presentation followed the session's new title");

    const added = await call("POST", `/events/${eventId}/sessions/${sessionId}/presentations`, {
      title: "Fireside chat",
      start: "",
      end: "",
    });
    assert.equal(added.status, 201);
    const response = await call("PATCH", `/events/${eventId}/sessions/${sessionId}`, {
      ...SESSION,
      title: "Opening Keynote (final)",
      room: "Hall B",
      start: "09:30",
      end: "10:30",
    });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { presentations_renamed: number }).presentations_renamed, 1);
    const [after] = await agenda();
    const titles = after!.presentations.map((item) => item.title).sort();
    assert.deepEqual(titles, ["Fireside chat", "Opening Keynote (final)"]);
    const fireside = after!.presentations.find((item) => item.title === "Fireside chat")!;
    const removed = await call("DELETE", `/events/${eventId}/presentations/${fireside.slot_id}`);
    assert.equal(removed.status, 200, "the extra presentation is cleaned up again");
  });

  test("a session that ends before it starts is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call("PATCH", `/events/${eventId}/sessions/${sessionId}`, {
      ...SESSION,
      start: "11:00",
      end: "10:00",
    });
    assert.equal(response.status, 422);
    assert.equal(((await response.json()) as { code: string }).code, "agenda.bad_times");
  });

  test("a day outside the event is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call("POST", `/events/${eventId}/sessions`, { ...SESSION, date: "2027-07-01" });
    assert.equal(response.status, 422);
    assert.equal(((await response.json()) as { code: string }).code, "agenda.bad_dates");
  });

  test("cancelling needs a reason, and then takes effect", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const refused = await call("POST", `/events/${eventId}/sessions/${sessionId}/cancel`, { reason: "" });
    assert.equal(refused.status, 422);
    const done = await call("POST", `/events/${eventId}/sessions/${sessionId}/cancel`, { reason: "speaker ill" });
    assert.equal(done.status, 200);
    assert.equal((await agenda())[0]!.state, "canceled");
    const twice = await call("POST", `/events/${eventId}/sessions/${sessionId}/cancel`, { reason: "again" });
    assert.equal(twice.status, 409);
  });

  test("reinstating puts it back on the schedule", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call("POST", `/events/${eventId}/sessions/${sessionId}/reinstate`, {
      reason: "speaker recovered",
    });
    assert.equal(response.status, 200);
    assert.equal((await agenda())[0]!.state, "scheduled");
  });
});

describe("presentations and presenters", () => {
  let addedSlot = "";

  test("a second presentation can be added with its own time", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call("POST", `/events/${eventId}/sessions/${sessionId}/presentations`, {
      title: "Q&A",
      start: "10:15",
      end: "10:30",
    });
    assert.equal(response.status, 201);
    addedSlot = ((await response.json()) as { slot_id: string }).slot_id;
    const talk = (await agenda())[0]!.presentations.find((item) => item.slot_id === addedSlot)!;
    assert.equal(talk.title, "Q&A");
    assert.equal(talk.starts_at, "2027-06-01T14:15:00.000Z");
  });

  test("a presentation's title is edited in place", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await call("PATCH", `/events/${eventId}/presentations/${slotId}`, {
      title: "Keynote address",
      start: "",
      end: "",
    });
    assert.equal(response.status, 200);
    const talk = (await agenda())[0]!.presentations.find((item) => item.slot_id === slotId)!;
    assert.equal(talk.title, "Keynote address");
    assert.equal(talk.starts_at, null, "no time of its own means it runs with the session");
  });

  test("a presenter is added, and removed again without deleting the speaker", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const added = await call("POST", `/events/${eventId}/presentations/${addedSlot}/presenters`, {
      name: "Probe Moderator",
      email: "moderator.probe@example.invalid",
      organization: "",
    });
    assert.equal(added.status, 201);
    const talk = (await agenda())[0]!.presentations.find((item) => item.slot_id === addedSlot)!;
    const moderator = talk.speakers.find((person) => person.name === "Probe Moderator");
    assert.ok(moderator, "the presenter is on the talk");

    const removed = await call("DELETE", `/events/${eventId}/presentations/${addedSlot}/presenters/${moderator.id}`);
    assert.equal(removed.status, 200);
    // D-137: an extra presentation left with nobody and no file is tidied away.
    const after = (await agenda())[0]!.presentations.find((item) => item.slot_id === addedSlot);
    assert.equal(after, undefined, "the emptied extra presentation is gone");
    const speakers = (await (await call("GET", `/events/${eventId}/speakers`)).json()) as {
      items: { full_name: string }[];
    };
    assert.ok(speakers.items.some((person) => person.full_name === "Probe Moderator"), "the speaker record stays");
  });

  test("a presentation with no files can be deleted", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const made = await call("POST", `/events/${eventId}/sessions/${sessionId}/presentations`, { title: "Spare", start: "", end: "" });
    assert.equal(made.status, 201);
    const spare = ((await made.json()) as { slot_id: string }).slot_id;
    assert.equal((await call("DELETE", `/events/${eventId}/presentations/${spare}`)).status, 200);
    assert.equal((await agenda())[0]!.presentations.length, 1);
  });
});

describe("co-presenters each have their own presentation (D-137)", () => {
  let coSlot = "";

  test("a second speaker added to a presented session gets a presentation of their own", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const before = (await agenda())[0]!.presentations;
    assert.equal(before.length, 1);
    assert.ok(before[0]!.speakers.length >= 1, "fixture: the session's presentation has a speaker");
    const added = await call("POST", `/events/${eventId}/presentations/${slotId}/presenters`, {
      name: "Probe Co-presenter",
      email: "copresenter.probe@example.invalid",
      organization: "",
    });
    assert.equal(added.status, 201);
    coSlot = ((await added.json()) as { slot_id: string }).slot_id;
    assert.notEqual(coSlot, slotId, "not put on the first speaker's presentation");
    const after = (await agenda())[0]!.presentations;
    assert.equal(after.length, 2, "the session now holds two presentations");
    const theirs = after.find((item) => item.slot_id === coSlot)!;
    assert.deepEqual(theirs.speakers.map((person) => person.name), ["Probe Co-presenter"]);
    assert.equal(theirs.title, before[0]!.title, "same title as the session's presentation");
    const first = after.find((item) => item.slot_id === slotId)!;
    assert.ok(!first.speakers.some((person) => person.name === "Probe Co-presenter"), "the first presentation is untouched");
  });

  test("adding the same person to that session again is refused, not duplicated", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const again = await call("POST", `/events/${eventId}/speakers`, {
      name: "Probe Co-presenter",
      email: "copresenter.probe@example.invalid",
      organization: "",
      slot_id: slotId,
    });
    assert.equal(again.status, 409);
    assert.equal((await agenda())[0]!.presentations.length, 2);
  });

  test("renaming the session renames every co-presenter's presentation", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const current = (await agenda())[0]!;
    // An earlier test gave the presentation a title of its own; line the session up with
    // it first, so both presentations carry the session's title before the rename.
    const shared = current.presentations[0]!.title;
    const patch = (title: string) =>
      call("PATCH", `/events/${eventId}/sessions/${sessionId}`, {
        ...SESSION,
        title,
        room: current.room ?? SESSION.room,
        start: "09:30",
        end: "10:30",
      });
    assert.equal((await patch(shared)).status, 200);
    const response = await patch("Co-presented keynote");
    assert.equal(response.status, 200);
    const titles = (await agenda())[0]!.presentations.map((item) => item.title);
    assert.ok(titles.every((title) => title === "Co-presented keynote"), `all follow: ${titles.join(" / ")}`);
  });

  test("taking the co-presenter off removes their empty presentation, and keeps the speaker", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const theirs = (await agenda())[0]!.presentations.find((item) => item.slot_id === coSlot)!;
    const person = theirs.speakers[0]!;
    assert.equal((await call("DELETE", `/events/${eventId}/presentations/${coSlot}/presenters/${person.id}`)).status, 200);
    const after = (await agenda())[0]!.presentations;
    assert.equal(after.length, 1, "back to the one presentation");
    assert.equal(after[0]!.slot_id, slotId);
  });
});

describe("what editing the agenda must never do", () => {
  test("change an archived event", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await call("POST", `/events/${eventId}/archive`)).status, 200);
    const response = await call("PATCH", `/events/${eventId}/sessions/${sessionId}`, SESSION);
    assert.equal(response.status, 409);
    assert.equal(((await response.json()) as { code: string }).code, "events.archived");
    assert.equal((await call("POST", `/events/${eventId}/restore`)).status, 200);
  });

  test("work without a session", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await fetch(`${API}/events/${eventId}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(SESSION),
    });
    assert.equal(response.status, 401);
  });

  test("leave anything behind when a session with no files is deleted", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await call("DELETE", `/events/${eventId}/sessions/${sessionId}`)).status, 200);
    assert.equal((await agenda()).length, 0);
  });
});
