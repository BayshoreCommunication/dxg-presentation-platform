import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { removeTestEvents } from "../helpers/cleanup.ts";

/**
 * An event whose setup stopped part way is finished, not restarted.
 *
 * The portfolio used to send every event to its command centre, drafts included — a
 * screen that reports a live indicator and "every talk is synchronized onsite" for an
 * event with no rooms, no sessions and no talks, while the thing it actually needed
 * (the rest of the wizard) was reachable from nowhere at all.
 *
 * Resuming means the draft has to carry back everything the four steps put on screen,
 * and the boxes it fills have to be editable without lying: a field that accepts
 * typing and discards it is the trap D-033 took out of the row editor.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const NAME = "Draft Resume Probe";

let up = false;
let admin = "";
let draftId = "";

const json = (cookie: string) => ({ "content-type": "application/json", cookie });

type Draft = {
  id: string;
  name: string;
  status: string;
  venue: string | null;
  timezone: string;
  starts_on: string;
  ends_on: string;
  days: number;
  sessions: number;
  rooms: string[];
  settings: Record<string, unknown>;
  branding: Record<string, unknown>;
};

const BASICS = {
  name: NAME,
  venue: "Tampa Convention Center",
  timezone: "America/New_York",
  starts_on: "2027-03-14",
  ends_on: "2027-03-16",
};

const createDraft = async (basics: Record<string, string>): Promise<string> => {
  const created = (await (
    await fetch(`${API}/events`, { method: "POST", headers: json(admin), body: JSON.stringify(basics) })
  ).json()) as { event_id: string };
  return created.event_id;
};

const getDraft = async (id: string): Promise<Draft> =>
  (await (await fetch(`${API}/events/${id}/draft`, { headers: { cookie: admin } })).json()) as Draft;

const patch = (id: string, body: unknown) =>
  fetch(`${API}/events/${id}`, { method: "PATCH", headers: json(admin), body: JSON.stringify(body) });

/** The smallest real agenda: one session, on the event's first day. */
const AGENDA = [
  "Session Title,Session Location,Session Date,Session Start,Session End,Presenter Email",
  "Only Session,Ballroom A,03/14/2027,9:00 AM,10:00 AM,probe@example.invalid",
].join("\n");

const importAgenda = async (eventId: string): Promise<void> => {
  const preview = (await (
    await fetch(`${API}/events/${eventId}/imports`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-file-name": "agenda.csv", cookie: admin },
      body: Buffer.from(AGENDA, "utf8"),
    })
  ).json()) as { import_id: string; rows: unknown[] };
  const committed = await fetch(`${API}/imports/${preview.import_id}/commit`, {
    method: "POST",
    headers: json(admin),
    body: JSON.stringify({ event_id: eventId, rows: preview.rows }),
  });
  assert.equal(committed.status, 200, "the probe agenda commits");
};

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);
  draftId = await createDraft(BASICS);
});

after(async () => {
  if (up) await removeTestEvents([NAME]);
});

describe("an unfinished draft can be picked back up", () => {
  test("it carries back every box step 1 filled in", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const draft = await getDraft(draftId);
    assert.equal(draft.status, "draft");
    assert.equal(draft.name, BASICS.name);
    // Without these four the resumed wizard would show empty boxes over a draft that
    // already holds the answers, and re-typing them is how they get typed differently.
    assert.equal(draft.venue, BASICS.venue);
    assert.equal(draft.timezone, BASICS.timezone);
    assert.equal(draft.starts_on, BASICS.starts_on);
    assert.equal(draft.ends_on, BASICS.ends_on);
  });

  test("no agenda yet reads as no sessions, which is what closes steps 3 and 4", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const draft = await getDraft(draftId);
    assert.equal(draft.sessions, 0);
    assert.equal(draft.rooms.length, 0);
    assert.equal(draft.days, 3, "one day per calendar day between the dates");
  });

  test("an imported agenda reads as sessions, which is what opens them", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const fresh = await createDraft({ ...BASICS, name: `${NAME} agenda` });
    await importAgenda(fresh);
    const draft = await getDraft(fresh);
    assert.ok(draft.sessions > 0, "the committed agenda is visible to the resumed wizard");
    assert.ok(draft.rooms.includes("Ballroom A"));
  });

  test("settings and branding come back, so steps 3 and 4 resume too", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await patch(draftId, { settings: { upload_deadline: "2027-03-01", reminders: "T-7 only" } });
    await patch(draftId, { branding: { accent: "#123456" } });
    const draft = await getDraft(draftId);
    assert.equal(draft.settings.upload_deadline, "2027-03-01");
    assert.equal(draft.settings.reminders, "T-7 only");
    assert.equal(draft.branding.accent, "#123456");
  });
});

describe("the resumed step 1 is editable, and editing it means something", () => {
  test("a correction is stored", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await patch(draftId, {
      basics: { ...BASICS, name: `${NAME} renamed`, venue: "Orlando Civic Hall" },
    });
    assert.equal(response.status, 200);
    const draft = await getDraft(draftId);
    assert.equal(draft.name, `${NAME} renamed`);
    assert.equal(draft.venue, "Orlando Civic Hall");
  });

  test("changing the dates moves the days with them", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await patch(draftId, {
      basics: { ...BASICS, name: `${NAME} renamed`, starts_on: "2027-03-14", ends_on: "2027-03-15" },
    });
    // Two days now, not three and not five: a shortened event drops the day it no
    // longer covers rather than keeping a stale one the schedule could hang on.
    assert.equal((await getDraft(draftId)).days, 2);

    await patch(draftId, {
      basics: { ...BASICS, name: `${NAME} renamed`, starts_on: "2027-03-14", ends_on: "2027-03-18" },
    });
    assert.equal((await getDraft(draftId)).days, 5);
  });

  test("the same rules as creation apply — an event cannot end before it starts", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await patch(draftId, {
      basics: { ...BASICS, starts_on: "2027-03-18", ends_on: "2027-03-14" },
    });
    // 422, not 400: well-formed, and refused by a rule rather than by the parser.
    assert.equal(response.status, 422);
    assert.equal(((await response.json()) as { code: string }).code, "events.bad_dates");
  });

  test("a timezone the platform does not know is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await patch(draftId, { basics: { ...BASICS, timezone: "Mars/Olympus" } });
    assert.equal(((await response.json()) as { code: string }).code, "events.unknown_timezone");
  });
});

describe("what editing the basics must never do", () => {
  test("dates that would drop a day holding sessions are refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const withAgenda = await createDraft({ ...BASICS, name: `${NAME} guarded` });
    await importAgenda(withAgenda);

    const response = await patch(withAgenda, {
      basics: { ...BASICS, name: `${NAME} guarded`, starts_on: "2027-03-15", ends_on: "2027-03-16" },
    });
    assert.equal(response.status, 409);
    const body = (await response.json()) as { code: string; message: string };
    assert.equal(body.code, "events.days_conflict");
    assert.match(body.message, /2027-03-14/, "the refusal names the day it would have dropped");

    const after = await getDraft(withAgenda);
    assert.equal(after.starts_on, BASICS.starts_on, "and nothing moved");
    assert.ok(after.sessions > 0, "the agenda is still there");
  });

  test("an event that is no longer a draft is not edited here", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const live = await createDraft({ ...BASICS, name: `${NAME} — activated` });
    await importAgenda(live);
    const activated = await fetch(`${API}/events/${live}/activate`, { method: "POST", headers: json(admin) });
    assert.equal(activated.status, 200, "an imported agenda is enough to activate");

    const response = await patch(live, { basics: { ...BASICS, name: "Renamed After Going Live" } });
    assert.equal(response.status, 422);
    assert.equal(((await response.json()) as { code: string }).code, "events.not_a_draft");
    assert.equal((await getDraft(live)).name, `${NAME} — activated`);
  });
});
