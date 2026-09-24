import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { grantRole } from "../helpers/account.ts";
import { removeTestEvents } from "../helpers/cleanup.ts";

/**
 * Who may set an event up.
 *
 * SCREEN_SPECS §2 says project manager, presentation manager and administrator, and
 * for as long as the wizard has existed nothing enforced it: create, configure,
 * activate and duplicate took a staff session and an event scope and asked nothing
 * further. Demonstrated before the fix — `t.okafor`, a room technician on MedTech
 * Forward and nothing else there, set that event's upload deadline to 1999-01-01 and
 * was answered 200.
 *
 * That is not a tidiness problem. The upload deadline is what closes the speaker
 * portal, so an account whose authority is custody of one room could lock every
 * speaker on the event out of submitting, or reopen a closed one — and the accent
 * colour it also rewrote is on every message those speakers receive.
 *
 * **Everything here writes to a probe event, never to a seeded one.** The first draft
 * of this suite asserted the refusals against MedTech Forward, which is fine while the
 * invariant holds and destructive the moment it does not: proving the suite by
 * reverting the gate renamed the seeded event and moved its deadline, because the
 * writes these tests expect to be refused were not refused. A suite that damages the
 * database precisely when it is doing its job is a suite nobody will run twice.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const NAME = "Event Config Probe";
/*
 * A prefix of its own, not `${NAME} duplicate`: `events.duplicated_from` points from the
 * copy back at its source, so a cleanup that happens to process the source first is
 * blocked by that key and archives it instead of deleting — leaving a probe event
 * behind on every run. Two removals in order, child before parent.
 */
const DUPLICATE = "Copy Of Config Probe";

let up = false;
let admin = "";
let probeEvent = "";
/**
 * Signed in *after* the grant, so the session carries the role.
 *
 * `c.delgado`, deliberately **not** `t.okafor`: `mfa.test.ts` reserves that account
 * because it drives the raw second factor outside the cross-process step lock, so any
 * other suite signing in as it spends a code that suite was about to replay on
 * purpose. Using it here cost a "the same code cannot be used twice" failure that had
 * nothing to do with either suite's subject. Which account this is does not matter to
 * anything below — the role is granted on the probe event by name.
 */
let technician = "";
let manager = "";

const json = (cookie: string) => ({ "content-type": "application/json", cookie });

/**
 * The seeded tenant, named rather than inferred. `POST /events` guesses the client
 * only when exactly one exists, and `rls-isolation.test.ts` creates a second while it
 * runs — so a suite that leaves this out is refused with `events.client_required`
 * whenever the two happen to overlap, which is a failure with nothing to do with what
 * it was testing. The sixty-first entry stopped those probe tenants accumulating; it
 * did not stop them existing for the seconds that suite takes.
 */
const CLIENT = "11111111-1111-4111-8111-111111111111";

const BASICS = {
  client_id: CLIENT,
  name: NAME,
  venue: "Tampa Convention Center",
  timezone: "America/New_York",
  starts_on: "2027-06-01",
  ends_on: "2027-06-02",
};

const setupOf = async (id: string, cookie: string) =>
  (await (await fetch(`${API}/events/${id}/draft`, { headers: { cookie } })).json()) as {
    name: string;
    status: string;
    sessions: number;
    venue: string | null;
    starts_on: string;
    ends_on: string;
    timezone: string;
    settings: Record<string, unknown>;
    branding: Record<string, unknown>;
  };

const patch = (id: string, cookie: string, body: unknown) =>
  fetch(`${API}/events/${id}`, { method: "PATCH", headers: json(cookie), body: JSON.stringify(body) });

/** The smallest real agenda, on the event's first day. */
const AGENDA = [
  "Session Title,Session Location,Session Date,Session Start,Session End,Presenter Email",
  "Only Session,Ballroom A,06/01/2027,9:00 AM,10:00 AM,probe@example.invalid",
].join("\n");

const importAgenda = async (eventId: string): Promise<void> => {
  const preview = (await (
    await fetch(`${API}/events/${eventId}/imports`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-file-name": "agenda.csv", cookie: admin },
      body: Buffer.from(AGENDA, "utf8"),
    })
  ).json()) as { upload_id: string; rows: unknown[] };
  const committed = await fetch(`${API}/imports/${preview.upload_id}/commit`, {
    method: "POST",
    headers: json(admin),
    body: JSON.stringify({ rows: preview.rows }),
  });
  assert.equal(committed.status, 200, "the probe agenda commits");
};

const userId = async (email: string): Promise<string> => {
  const staff = (await (await fetch(`${API}/admin/users`, { headers: { cookie: admin } })).json()) as {
    items: { id: string; email: string }[];
  };
  const found = staff.items.find((person) => person.email === email);
  if (!found) throw new Error(`no such account: ${email}`);
  return found.id;
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
    await fetch(`${API}/events`, { method: "POST", headers: json(admin), body: JSON.stringify(BASICS) })
  ).json()) as { event_id: string };
  probeEvent = created.event_id;

  /*
   * Both accounts are given a role *on this event*, so that what refuses them is the
   * role gate and not `scopeFor`. An earlier version skipped this and stayed green
   * with the gate reverted: a refusal by the scope check proves nothing about the
   * role check, which is the third time this repo has met a test passing for the
   * wrong reason.
   */
  await grantRole(API, admin, await userId("c.delgado@example.invalid"), probeEvent, "room_technician");
  await grantRole(API, admin, await userId("m.vega@example.invalid"), probeEvent, "presentation_manager");
  technician = await signInStaff(API, "c.delgado@example.invalid", PASSWORD);
  manager = await signInStaff(API, "m.vega@example.invalid", PASSWORD);
});

after(async () => {
  if (!up) return;
  await removeTestEvents([DUPLICATE]);
  await removeTestEvents([NAME]);
});

describe("a room technician cannot reconfigure the event they staff", () => {
  test("the upload deadline is not theirs to move", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const before = await setupOf(probeEvent, admin);
    const response = await patch(probeEvent, technician, { settings: { upload_deadline: "1999-01-01" } });

    assert.equal(response.status, 403);
    assert.equal(((await response.json()) as { code: string }).code, "events.forbidden");
    // Refused *and* unchanged: a 403 that still wrote would be the worse failure.
    assert.deepEqual((await setupOf(probeEvent, admin)).settings, before.settings);
  });

  test("neither is the branding every speaker's mail carries", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const before = await setupOf(probeEvent, admin);
    const response = await patch(probeEvent, technician, { branding: { accent: "#ff0000" } });
    assert.equal(response.status, 403);
    assert.deepEqual((await setupOf(probeEvent, admin)).branding, before.branding);
  });

  test("nor the event's name", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await patch(probeEvent, technician, {
      basics: { ...BASICS, name: "Renamed By A Room Technician" },
    });
    assert.equal(response.status, 403);
    assert.equal((await setupOf(probeEvent, admin)).name, NAME);
  });

  test("and the event they genuinely staff is one they cannot activate", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await fetch(`${API}/events/${probeEvent}/activate`, {
      method: "POST",
      headers: json(technician),
    });
    assert.equal(response.status, 403);
    assert.equal(((await response.json()) as { code: string }).code, "events.forbidden");
  });
});

describe("a presentation manager on the event still can", () => {
  test("the gate stops the wrong role, not the work", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await patch(probeEvent, manager, { settings: { reminders: "T-7 · T-2" } });
    assert.equal(response.status, 200);
    assert.equal((await setupOf(probeEvent, admin)).settings.reminders, "T-7 · T-2");
  });
});

/**
 * The settings themselves are checked (D-091). `settings` was stored as sent, so a
 * deadline of "tomorrow" or "2026-13-45" reached every speaker's portal and email. The
 * probe runs 2027-06-01 to 2027-06-02; the date pickers cap the deadline at its start.
 */
describe("what the event's settings will and will not accept", () => {
  const refused = async (settings: unknown, pattern: RegExp) => {
    const before = await setupOf(probeEvent, admin);
    const response = await patch(probeEvent, admin, { settings });
    assert.equal(response.status, 422, JSON.stringify(settings));
    const body = (await response.json()) as { code: string; message: string };
    assert.equal(body.code, "events.bad_settings");
    assert.match(body.message, pattern);
    assert.deepEqual((await setupOf(probeEvent, admin)).settings, before.settings, "and nothing was stored");
  };

  test("a real date on or before the first day is stored", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    for (const deadline of ["2027-05-20", "2027-06-01"]) {
      const response = await patch(probeEvent, admin, { settings: { upload_deadline: deadline } });
      assert.equal(response.status, 200, deadline);
      assert.equal((await setupOf(probeEvent, admin)).settings.upload_deadline, deadline);
    }
  });

  test("an empty deadline clears it", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await patch(probeEvent, admin, { settings: { upload_deadline: "" } })).status, 200);
    assert.equal((await setupOf(probeEvent, admin)).settings.upload_deadline, "");
  });

  test("text that is not a date is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await refused({ upload_deadline: "tomorrow" }, /YYYY-MM-DD/);
    await refused({ upload_deadline: "06/01/2027" }, /YYYY-MM-DD/);
    await refused({ upload_deadline: 20270601 }, /YYYY-MM-DD/);
  });

  test("a date that does not exist is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await refused({ upload_deadline: "2027-02-30" }, /not a real date/);
    await refused({ upload_deadline: "2027-13-01" }, /not a real date/);
  });

  test("a deadline after the event has started is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await refused({ upload_deadline: "2027-06-02" }, /after the event starts/);
  });

  test("unknown settings and oversized reminders are refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await refused({ upload_deadline: "2027-05-20", portal_closed: true }, /Unknown setting: portal_closed/);
    await refused({ reminders: "x".repeat(201) }, /200 characters/);
    await refused({ reminders: 7 }, /must be text/);
  });
});

/** Branding is only an accent colour, `#RRGGBB` (D-092). */
describe("what the event's branding will and will not accept", () => {
  test("a hex colour is stored, in capitals", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await patch(probeEvent, admin, { branding: { accent: "#1a7f5c" } });
    assert.equal(response.status, 200);
    assert.equal((await setupOf(probeEvent, admin)).branding.accent, "#1A7F5C");
  });

  test("anything that is not a six-digit hex colour is refused, and nothing is stored", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    for (const branding of [{ accent: "blue" }, { accent: "#44C7F" }, { accent: "44C7F4" }, { accent: 44 }, { logo: "x.png" }]) {
      const before = await setupOf(probeEvent, admin);
      const response = await patch(probeEvent, admin, { branding });
      assert.equal(response.status, 422, JSON.stringify(branding));
      assert.equal(((await response.json()) as { code: string }).code, "events.bad_branding");
      assert.deepEqual((await setupOf(probeEvent, admin)).branding, before.branding);
    }
  });
});

describe("what a live event will and will not accept", () => {
  test("an event with rooms and days but no agenda cannot be activated", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    // Rooms and days, deliberately without an agenda. This is exactly the shape the
    // wizard cannot produce — step 2 is mandatory — and the API used to accept.
    await patch(probeEvent, admin, { rooms: ["Ballroom A"] });
    const response = await fetch(`${API}/events/${probeEvent}/activate`, {
      method: "POST",
      headers: json(admin),
    });
    assert.equal(response.status, 422);
    const body = (await response.json()) as { code: string; message: string };
    assert.equal(body.code, "events.incomplete");
    assert.match(body.message, /no sessions/, "the refusal says which of the three is missing");

    const setup = await setupOf(probeEvent, admin);
    assert.equal(setup.status, "draft", "and it is still a draft");
  });

  test("its name and venue are labels, and stay correctable", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await importAgenda(probeEvent);
    const activated = await fetch(`${API}/events/${probeEvent}/activate`, {
      method: "POST",
      headers: json(admin),
    });
    assert.equal(activated.status, 200, "an agenda is what makes it activatable");

    const response = await patch(probeEvent, admin, {
      basics: { ...BASICS, name: `${NAME} corrected`, venue: "Orlando Civic Hall" },
    });
    assert.equal(response.status, 200, "an event is created before its venue is confirmed");
    const setup = await setupOf(probeEvent, admin);
    assert.equal(setup.name, `${NAME} corrected`);
    assert.equal(setup.venue, "Orlando Civic Hall");
  });

  /*
   * FR-EVT-002 copies structure and settings and deliberately copies no speakers,
   * files or sessions — last year's decks must not appear in this year's event. So a
   * duplicate arrives with rooms, tracks and days and an empty agenda, which is
   * precisely the shape the new rule refuses. That is the intended consequence rather
   * than an oversight: a duplicated event has no talks either, and activating it would
   * produce the same shell by a different route.
   */
  test("a duplicate inherits rooms and days, and still needs its own agenda", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const copy = (await (
      await fetch(`${API}/events/${probeEvent}/duplicate`, {
        method: "POST",
        headers: json(admin),
        body: JSON.stringify({ name: DUPLICATE, starts_on: "2027-09-01", ends_on: "2027-09-02" }),
      })
    ).json()) as { event_id: string; rooms: number };
    assert.ok(copy.rooms > 0, "the rooms did come across");

    const setup = await setupOf(copy.event_id, admin);
    assert.equal(setup.sessions, 0, "and the agenda did not, by design");

    const response = await fetch(`${API}/events/${copy.event_id}/activate`, {
      method: "POST",
      headers: json(admin),
    });
    assert.equal(response.status, 422);
    assert.match(((await response.json()) as { message: string }).message, /no sessions/);
  });

  test("its dates and timezone are not, and the refusal names them", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const moved = await patch(probeEvent, admin, {
      basics: { ...BASICS, name: `${NAME} corrected`, starts_on: "2027-07-01", ends_on: "2027-07-02" },
    });
    assert.equal(moved.status, 422);
    const body = (await moved.json()) as { code: string; message: string };
    assert.equal(body.code, "events.not_a_draft");
    assert.match(body.message, /start date, end date/);

    const zoned = await patch(probeEvent, admin, {
      basics: { ...BASICS, name: `${NAME} corrected`, timezone: "Europe/London" },
    });
    assert.equal(zoned.status, 422);
    assert.match(((await zoned.json()) as { message: string }).message, /time zone/);

    const setup = await setupOf(probeEvent, admin);
    assert.equal(setup.starts_on, BASICS.starts_on, "and nothing moved");
    assert.equal(setup.timezone, BASICS.timezone);
  });
});
