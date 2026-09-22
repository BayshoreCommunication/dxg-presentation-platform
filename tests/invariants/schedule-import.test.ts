import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { removeTestEvents } from "../helpers/cleanup.ts";
import { withSystemScope } from "@pmp/db";

/**
 * An agenda arrives incomplete more often than not, and the operator is usually not
 * the person who produced it. They have to be able to finish it here (D-026), and the
 * event must not proceed on a half-imported schedule — every room, day and session
 * comes from this file.
 *
 * Corrections are sent as cell values and re-validated on the server, so these also
 * cover the thing that would otherwise need a second implementation in the browser:
 * a fixed date is parsed and converted through the event's timezone by the same code
 * that rejected it.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const EVENT_NAME = "Import Invariant Probe";

let up = false;
let admin = "";
let eventId = "";

const json = (cookie: string) => ({ "content-type": "application/json", cookie });

type Preview = {
  import_id: string;
  upload_id: string;
  timezone: string;
  rows: {
    row: number;
    missing: string[];
    title: string;
    room: string;
    starts_at: string | null;
    slot_starts_at?: string | null;
    slot_ends_at?: string | null;
  }[];
  issues: { row: number; column: string; severity: string; message: string }[];
};

const upload = async (csv: string): Promise<Preview> => {
  const response = await fetch(`${API}/events/${eventId}/imports`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", "x-file-name": "agenda.csv", cookie: admin },
    body: Buffer.from(csv, "utf8"),
  });
  return (await response.json()) as Preview;
};

const fixCell = async (uploadId: string, row: number, field: string, value: string): Promise<Preview> =>
  (await (
    await fetch(`${API}/imports/${uploadId}/cells`, {
      method: "POST",
      headers: json(admin),
      body: JSON.stringify({ row, field, value }),
    })
  ).json()) as Preview;

/** What the row editor sends: several cells of one row, in one request. */
const fixRow = async (
  uploadId: string,
  row: number,
  cells: Record<string, string>,
): Promise<Preview> =>
  (await (
    await fetch(`${API}/imports/${uploadId}/cells`, {
      method: "POST",
      headers: json(admin),
      body: JSON.stringify({ row, cells }),
    })
  ).json()) as Preview;

const commit = (preview: Preview) =>
  fetch(`${API}/imports/${preview.import_id}/commit`, {
    method: "POST",
    headers: json(admin),
    body: JSON.stringify({ event_id: eventId, rows: preview.rows }),
  });

/** Row 2 complete; row 3 has no title; row 4 no room; row 5 a date nothing can read. */
const INCOMPLETE = [
  "Session Title,Session Location,Session Date,Session Start,Session End,Presenter Email",
  "Complete Row,Ballroom A,03/14/2027,9:00 AM,10:00 AM,a@example.invalid",
  ",Ballroom A,03/14/2027,11:00 AM,12:00 PM,b@example.invalid",
  "No Room,,03/14/2027,1:00 PM,2:00 PM,c@example.invalid",
  "Bad Date,Ballroom A,not-a-date,3:00 PM,4:00 PM,d@example.invalid",
].join("\n");

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);
  const created = (await (
    await fetch(`${API}/events`, {
      method: "POST",
      headers: json(admin),
      body: JSON.stringify({
        // Named for the same reason the draft-resume suite names it: `POST /events`
        // guesses only when one client exists, and `rls-isolation.test.ts` transiently
        // creates a second.
        client_id: "11111111-1111-4111-8111-111111111111",
        name: EVENT_NAME,
        venue: "Tampa",
        timezone: "America/New_York",
        starts_on: "2027-03-14",
        ends_on: "2027-03-14",
      }),
    })
  ).json()) as { event_id: string };
  eventId = created.event_id;
});

describe("an incomplete agenda can be finished on the screen", () => {
  test("each row names the required fields it is missing", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const preview = await upload(INCOMPLETE);
    assert.deepEqual(preview.rows.map((row) => row.missing), [
      [],
      ["session.title"],
      ["room.name"],
      // An unreadable date is missing, not merely wrong: nothing usable came out of it.
      ["session.date", "session.start"],
    ]);
  });

  test("the preview carries the event's timezone, so the screen never guesses", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await upload(INCOMPLETE)).timezone, "America/New_York");
  });

  test("an incomplete agenda cannot be committed", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await commit(await upload(INCOMPLETE));
    const body = (await response.json()) as { code?: string; detail?: { rows?: number[] } };
    assert.equal(response.status, 400);
    assert.equal(body.code, "import.blocking_errors");
    assert.deepEqual(body.detail?.rows, [3, 4, 5], "the refusal names the rows to go and fix");
  });

  test("a typed cell clears exactly its own row, and corrections accumulate", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    let preview = await upload(INCOMPLETE);
    preview = await fixCell(preview.upload_id, 3, "session.title", "Supplied By The Operator");
    assert.deepEqual(preview.rows[1]?.missing, [], "row 3 is complete");
    assert.deepEqual(preview.rows[2]?.missing, ["room.name"], "row 4 is untouched");

    preview = await fixCell(preview.upload_id, 4, "room.name", "Ballroom B");
    assert.equal(preview.rows[1]?.title, "Supplied By The Operator", "the earlier fix survives the next one");
    assert.deepEqual(preview.rows[2]?.missing, []);
  });

  test("a corrected date is parsed in the event's timezone, not the browser's or the server's", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    let preview = await upload(INCOMPLETE);
    preview = await fixCell(preview.upload_id, 5, "session.date", "03/14/2027");
    // 3pm on 14 March in New York is EDT, UTC-4. Getting this wrong by a day is what
    // the server-side re-validation exists to prevent.
    assert.equal(preview.rows[3]?.starts_at, "2027-03-14T19:00:00.000Z");
  });

  test("the row editor saves several cells of a row in one request", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    let preview = await upload(INCOMPLETE);
    // Row 5's date is unreadable and row 5 is also where the editor would show every
    // other field; saving them one at a time would re-read the file once per field and
    // let the responses race.
    preview = await fixRow(preview.upload_id, 5, {
      "session.date": "03/14/2027",
      "session.start": "4:30 PM",
      "session.title": "Renamed In The Editor",
    });
    const fixed = preview.rows[3]!;
    assert.deepEqual(fixed.missing, []);
    assert.equal(fixed.title, "Renamed In The Editor");
    assert.equal(fixed.starts_at, "2027-03-14T20:30:00.000Z", "4:30pm EDT");
  });

  test("every row carries its whole set of cells, so the editor can show the row", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const preview = await upload(INCOMPLETE);
    const row = preview.rows[0] as unknown as { cells: Record<string, string> };
    assert.equal(row.cells["session.title"], "Complete Row");
    assert.equal(row.cells["room.name"], "Ballroom A");
    assert.equal(row.cells["session.date"], "03/14/2027");
    assert.equal(row.cells["speaker.email"], "a@example.invalid");
    // Present but empty, rather than absent: the editor renders a box for it either way.
    assert.equal(row.cells["track.name"], "");
  });

  test("once every row is complete the commit goes through", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    let preview = await upload(INCOMPLETE);
    preview = await fixCell(preview.upload_id, 3, "session.title", "Supplied By The Operator");
    preview = await fixCell(preview.upload_id, 4, "room.name", "Ballroom B");
    preview = await fixCell(preview.upload_id, 5, "session.date", "03/14/2027");
    assert.equal(preview.rows.filter((row) => row.missing.length > 0).length, 0);

    const response = await commit(preview);
    assert.equal(response.status, 200, "a complete agenda must import");
    const body = (await response.json()) as { created: number };
    assert.equal(body.created, 4);
  });
});

describe("the blank template is downloadable and importable", () => {
  test("it is served as a CSV attachment", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await fetch(`${API}/events/${eventId}/agenda-template`, { headers: { cookie: admin } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(response.headers.get("content-disposition") ?? "", /attachment; filename=/);
  });

  test("filled in and sent back, it imports with nothing missing and nothing to map by hand", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const template = await (
      await fetch(`${API}/events/${eventId}/agenda-template`, { headers: { cookie: admin } })
    ).text();
    const filled = [
      ...template.split("\r\n").filter(Boolean).slice(0, 4),
      // The template's own fourteen columns (D-029), in its order. The three
      // Presentation* columns and the Presenter 2 block are left empty, as an
      // organiser filling in a single-presenter session would leave them.
      "Template Row,Ballroom D,04/02/2027,9:00 AM,10:00 AM,,,,chair@example.invalid,Dana,Reyes,,,",
    ].join("\r\n");

    const preview = await upload(filled);
    assert.equal(preview.rows.length, 1, "the banner, hint, REQUIRED and EXAMPLE rows are not sessions");
    assert.deepEqual(preview.rows[0]?.missing, []);
    // The organization must not have been taken for the presenter's name.
    const withSpeaker = preview.rows[0] as unknown as { speaker_name: string };
    assert.equal(withSpeaker.speaker_name, "Dana Reyes");
  });
});

after(async () => {
  if (!up) return;
  await removeTestEvents([EVENT_NAME]);
});

/*
 * Every one of these committed a 500 before 2026-09-21: the row passed the preview with
 * no blocking errors, the operator pressed Import, and the database refused it with
 * "Unexpected server error" naming no row. `sessions` carries CHECK (ends_at >
 * starts_at) and `slots` CHECK (ends_at >= starts_at); the preview knew neither.
 *
 * The screen must refuse what the database will refuse. A rule held only by the
 * database is one the operator meets after reviewing the whole file.
 */
describe("the preview refuses what the database would", () => {
  const rowsOf = async (csv: string) => {
    const preview = await upload(csv);
    return preview;
  };

  test("a session with no end time at all is blocked, not committed", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const preview = await rowsOf(
      [
        "Session Title,Session Location,Session Date,Session Start,Presenter Email",
        "No End Given,Ballroom A,03/14/2027,8:00 AM,a@example.invalid",
      ].join("\n"),
    );
    // DXG's own template prints REQUIRED under Session End; the validator now agrees.
    assert.deepEqual(preview.rows[0]?.missing, ["session.end"]);

    const response = await commit(preview);
    assert.equal(response.status, 400, "refused by the preview, not by the database");
    assert.equal(((await response.json()) as { code: string }).code, "import.blocking_errors");
  });

  test("a session that ends before it starts names the row", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const preview = await rowsOf(
      [
        "Session Title,Session Location,Session Date,Session Start,Session End,Presenter Email",
        "Backwards Session,Ballroom A,03/14/2027,10:00 AM,8:00 AM,b@example.invalid",
      ].join("\n"),
    );
    const blocking = preview.issues.filter((issue) => issue.severity === "blocking");
    assert.equal(blocking.length, 1);
    assert.equal(blocking[0]?.column, "session.end");
    assert.match(blocking[0]!.message, /cannot end before it starts/);
    assert.equal((await commit(preview)).status, 400);
  });

  test("a presentation that ends before it starts does too", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const preview = await rowsOf(
      [
        "Session Title,Session Location,Session Date,Session Start,Session End,Presentation Start,Presentation End,Presenter Email",
        // Inside the session, so this isolates the backwards rule rather than also
        // tripping the one about a presentation escaping its session.
        "Backwards Talk,Ballroom A,03/14/2027,8:00 AM,12:00 PM,10:25 AM,10:10 AM,c@example.invalid",
      ].join("\n"),
    );
    const blocking = preview.issues.filter((issue) => issue.severity === "blocking");
    assert.equal(blocking.length, 1);
    assert.equal(blocking[0]?.column, "slot.end");
    assert.equal((await commit(preview)).status, 400);
  });

  test("a presentation window that is merely zero-length is allowed through", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    // `slots` allows ends_at >= starts_at, so this is legal where the session one is
    // not. The preview must draw the line in the same place the schema does.
    const preview = await rowsOf(
      [
        "Session Title,Session Location,Session Date,Session Start,Session End,Presentation Start,Presentation End,Presenter Email",
        "Instant Talk,Ballroom A,03/14/2027,8:00 AM,10:00 AM,9:00 AM,9:00 AM,d@example.invalid",
      ].join("\n"),
    );
    assert.equal(preview.issues.filter((issue) => issue.severity === "blocking").length, 0);
    assert.equal((await commit(preview)).status, 200);
  });

  test("the duration is ignored when an end time is given, and the end is what lands", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    // The case Travis asked about: 5:10 PM → 5:25 PM with a 55-minute duration beside
    // it. The published end wins, so the slot is 15 minutes, not 55.
    const preview = await rowsOf(
      [
        "Session Title,Session Location,Session Date,Session Start,Session End,Presentation Start,Presentation End,Presentation Duration,Presenter Email",
        "Disagreeing Row,Ballroom A,03/14/2027,4:00 PM,6:00 PM,5:10 PM,5:25 PM,55,e@example.invalid",
      ].join("\n"),
    );
    assert.equal(preview.issues.filter((issue) => issue.severity === "blocking").length, 0);
    assert.equal((await commit(preview)).status, 200);

    const row = preview.rows.find((entry) => entry.title === "Disagreeing Row");
    assert.ok(row, "the row is in the preview");
  });
});

/*
 * A presentation happens inside its session. Nothing in the database says so — `slots`
 * and `sessions` carry their times independently — which is why it is checked here: a
 * talk starting before its room opens, or running past the session it belongs to, is
 * wrong in a way no constraint will catch, and it would reach the room schedule and
 * the speaker's portal looking authoritative.
 */
describe("a presentation cannot escape its session", () => {
  const row = (slotStart: string, slotEnd: string, duration = "") =>
    [
      "Session Title,Session Location,Session Date,Session Start,Session End,Presentation Start,Presentation End,Presentation Duration,Presenter Email",
      `Bounded,Ballroom A,03/14/2027,9:00 AM,10:00 AM,${slotStart},${slotEnd},${duration},f@example.invalid`,
    ].join("\n");

  test("starting before the session starts is blocked", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const preview = await upload(row("8:30 AM", "9:30 AM"));
    const blocking = preview.issues.filter((issue) => issue.severity === "blocking");
    assert.equal(blocking.length, 1);
    assert.equal(blocking[0]?.column, "slot.start");
    assert.match(blocking[0]!.message, /before its session starts/);
    assert.equal((await commit(preview)).status, 400);
  });

  test("ending after the session ends is blocked", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const preview = await upload(row("9:30 AM", "10:30 AM"));
    const blocking = preview.issues.filter((issue) => issue.severity === "blocking");
    assert.equal(blocking.length, 1);
    assert.equal(blocking[0]?.column, "slot.end");
    assert.match(blocking[0]!.message, /after its session ends/);
    assert.equal((await commit(preview)).status, 400);
  });

  test("a duration that runs past the session's end is blocked too", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    // No end given, so the duration decides it — and 90 minutes from 9:30 lands at
    // 11:00, half an hour past a session that ends at 10:00.
    const preview = await upload(row("9:30 AM", "", "90"));
    const blocking = preview.issues.filter((issue) => issue.severity === "blocking");
    assert.equal(blocking.length, 1);
    assert.equal(blocking[0]?.column, "slot.end");
    assert.match(blocking[0]!.message, /90 minutes/);
    assert.equal((await commit(preview)).status, 400);
  });

  test("a presentation filling its session exactly is fine", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    // The boundaries are inclusive: a session with one talk in it is the ordinary case.
    const preview = await upload(row("9:00 AM", "10:00 AM"));
    assert.equal(preview.issues.filter((issue) => issue.severity === "blocking").length, 0);
    assert.equal((await commit(preview)).status, 200);
  });
});

/*
 * D-046. `commitImport` already repeated six of the seven blocking rules the preview
 * applies — an empty title, an empty room, an unreadable date, a backwards session, a
 * backwards presentation, a presentation outside its session. It did not repeat the
 * seventh: a room matching nothing on the event.
 *
 * So a request that skipped the screen, or replayed a preview taken before the rule
 * mattered, imported the typo and `rooms` gained "Main Hal" beside "Main Hall" — the
 * duplicate the check exists to prevent. Reproduced exactly that way before the fix:
 * one row, one typo, {"created":1}, two rooms.
 *
 * These go through the API rather than calling `commitImport`, because what was wrong
 * was reachable over HTTP without the screen's cooperation, and a unit test on the
 * function would have passed either way once the screen was fixed.
 */
describe("the commit refuses a room the event does not have", () => {
  const ROOM_PROBE = "Import Room Revalidation Probe";
  let probe = "";

  /** A typed agenda of one row, filled with whatever this test is about. */
  const oneRow = async (cells: Record<string, string>) => {
    const blank = (await (
      await fetch(`${API}/events/${probe}/imports/blank`, { method: "POST", headers: json(admin) })
    ).json()) as Preview;
    return (await (
      await fetch(`${API}/imports/${blank.upload_id}/cells`, {
        method: "POST",
        headers: json(admin),
        body: JSON.stringify({ row: 2, cells }),
      })
    ).json()) as Preview;
  };

  const commitTo = (preview: Preview) =>
    fetch(`${API}/imports/${preview.import_id}/commit`, {
      method: "POST",
      headers: json(admin),
      body: JSON.stringify({ event_id: probe, rows: preview.rows }),
    });

  const roomsOf = async (): Promise<string[]> =>
    withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ name: string }>(
        `SELECT name FROM pmp.rooms WHERE event_id = $1 ORDER BY name`,
        [probe],
      );
      return rows.map((room) => room.name);
    });

  const session = (title: string, room: string, start: string, end: string) => ({
    "session.title": title,
    "room.name": room,
    "session.date": "03/14/2027",
    "session.start": start,
    "session.end": end,
  });

  before(async () => {
    if (!up) return;
    const created = (await (
      await fetch(`${API}/events`, {
        method: "POST",
        headers: json(admin),
        body: JSON.stringify({
          client_id: "11111111-1111-4111-8111-111111111111",
          name: ROOM_PROBE,
          venue: "Tampa",
          timezone: "America/New_York",
          starts_on: "2027-03-14",
          ends_on: "2027-03-14",
        }),
      })
    ).json()) as { event_id: string };
    probe = created.event_id;
  });

  after(async () => {
    if (!up) return;
    await removeTestEvents([ROOM_PROBE]);
  });

  /*
   * First, because the rest depend on it and because it is the behaviour the rule must
   * not break: an event with no rooms is one whose first import *defines* them, so
   * there is nothing to match against and the name is taken as given.
   */
  test("an event with no rooms takes the name it is given", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await commitTo(await oneRow(session("Opening", "Grand Ballroom", "9:00 AM", "10:00 AM")));
    assert.equal(response.status, 200);
    assert.deepEqual(await roomsOf(), ["Grand Ballroom"]);
  });

  test("a room the event has commits into it, creating nothing", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await commitTo(await oneRow(session("Second", "Grand Ballroom", "11:00 AM", "12:00 PM")));
    assert.equal(response.status, 200);
    assert.deepEqual(await roomsOf(), ["Grand Ballroom"]);
  });

  test("a room the event does not have is refused, and no room is created", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const preview = await oneRow(session("Typo", "Grand Balroom", "1:00 PM", "2:00 PM"));
    // The preview already knew. The point of the test is what the commit does with a
    // row the preview called blocking.
    assert.ok(preview.issues.some((issue) => issue.column === "room.name" && issue.severity === "blocking"));

    const response = await commitTo(preview);
    assert.equal(response.status, 400);
    const body = (await response.json()) as { code: string; detail?: { unmatched_rooms?: string[] } };
    assert.equal(body.code, "import.blocking_errors");
    // Named, because a caller that never saw the screen has nothing else to go on.
    assert.deepEqual(body.detail?.unmatched_rooms, ["Grand Balroom"]);
    assert.deepEqual(await roomsOf(), ["Grand Ballroom"]);
  });

  /*
   * The same duplicate by a second route. Validation compares with `normalise`, which
   * folds repeated spaces and separators; the commit used to resolve the room with SQL
   * `lower()`, which does not. A name differing only in spacing therefore passed the
   * check and then missed the lookup, and was created as a new room. Both ends now
   * use `normalise`.
   */
  test("a name differing only in spacing joins the room, it does not fork it", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await commitTo(await oneRow(session("Spaced", "Grand  Ballroom", "3:00 PM", "4:00 PM")));
    assert.equal(response.status, 200);
    assert.deepEqual(await roomsOf(), ["Grand Ballroom"]);
  });
});

/*
 * A row is added with its values, not before them.
 *
 * `+ Add session` used to append the row and then open the editor over it, so
 * cancelling the dialog left the row behind — empty, blocking, and one per change of
 * mind. The screen now opens the editor over nothing and saving is what appends; this
 * is the endpoint contract that makes that possible, so a cancelled dialog has
 * nothing to undo.
 */
describe("a typed row arrives complete", () => {
  const ADD_PROBE = "Import Add Row Probe";
  let probe = "";

  const blank = async (): Promise<Preview> =>
    (await (
      await fetch(`${API}/events/${probe}/imports/blank`, { method: "POST", headers: json(admin) })
    ).json()) as Preview;

  const addRow = async (uploadId: string, cells: Record<string, string>): Promise<Preview> =>
    (await (
      await fetch(`${API}/imports/${uploadId}/rows`, {
        method: "POST",
        headers: json(admin),
        body: JSON.stringify({ cells }),
      })
    ).json()) as Preview;

  before(async () => {
    if (!up) return;
    const created = (await (
      await fetch(`${API}/events`, {
        method: "POST",
        headers: json(admin),
        body: JSON.stringify({
          client_id: "11111111-1111-4111-8111-111111111111",
          name: ADD_PROBE,
          venue: "Tampa",
          timezone: "America/New_York",
          starts_on: "2027-03-14",
          ends_on: "2027-03-14",
        }),
      })
    ).json()) as { event_id: string };
    probe = created.event_id;
  });

  after(async () => {
    if (!up) return;
    await removeTestEvents([ADD_PROBE]);
  });

  test("the added row is complete on arrival, not blocking and then filled", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const started = await blank();
    const after = await addRow(started.upload_id, {
      "session.title": "Added Complete",
      "room.name": "Ballroom A",
      "session.date": "03/14/2027",
      "session.start": "2:00 PM",
      "session.end": "3:00 PM",
    });

    assert.equal(after.rows.length, 2);
    const added = after.rows[1]!;
    assert.equal(added.title, "Added Complete");
    assert.deepEqual(added.missing, [], "the row should never exist in an incomplete state");
    // Parsed and converted by the importer, not taken as typed: 2pm on 14 March is EDT.
    assert.equal(added.starts_at, "2027-03-14T18:00:00.000Z");
  });

  test("adding without values still appends an empty row, for callers that want one", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const started = await blank();
    const after = (await (
      await fetch(`${API}/imports/${started.upload_id}/rows`, { method: "POST", headers: json(admin) })
    ).json()) as Preview;
    assert.equal(after.rows.length, 2);
    assert.ok(after.rows[1]!.missing.length > 0);
  });
});

/*
 * Taking a row out of an uploaded agenda (D-049).
 *
 * Removal used to be typed-agendas-only, because the first implementation renumbered:
 * the rows below a removal moved up and their `overrides` had to move with them. That
 * is wrong for a file twice over — an error naming row 12 must mean the twelfth row of
 * the spreadsheet on the operator's screen, and any slip in the re-keying silently
 * reattaches a correction to the wrong session.
 *
 * So a removed row is *skipped*, not deleted, and every other row keeps its number.
 * These pin both halves: the numbers, and the corrections that hang off them.
 */
describe("a row can be taken out of an uploaded agenda", () => {
  const FIVE_ROWS = [
    "Session Title,Session Location,Session Date,Session Start,Session End,Presenter 1 Email",
    "Talk One,Ballroom A,03/14/2027,9:00 AM,10:00 AM,one@example.invalid",
    "Talk Two,Ballroom A,03/14/2027,10:00 AM,11:00 AM,two@example.invalid",
    "Talk Three,Ballroom A,03/14/2027,11:00 AM,12:00 PM,three@example.invalid",
    "Talk Four,Ballroom A,03/14/2027,1:00 PM,2:00 PM,four@example.invalid",
  ].join("\n");

  const remove = async (uploadId: string, row: number) =>
    fetch(`${API}/imports/${uploadId}/rows/${row}`, { method: "DELETE", headers: json(admin) });

  const restore = async (uploadId: string): Promise<Preview> =>
    (await (
      await fetch(`${API}/imports/${uploadId}/rows/restore`, { method: "POST", headers: json(admin) })
    ).json()) as Preview;

  test("the removed row goes and the others keep their file row numbers", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const preview = await upload(FIVE_ROWS);
    assert.deepEqual(preview.rows.map((row) => row.row), [2, 3, 4, 5]);

    const after = (await (await remove(preview.upload_id, 3)).json()) as Preview;
    // 3 is gone; 4 and 5 are still 4 and 5, not 3 and 4.
    assert.deepEqual(after.rows.map((row) => row.row), [2, 4, 5]);
    assert.deepEqual(after.rows.map((row) => row.title), ["Talk One", "Talk Three", "Talk Four"]);
    assert.equal(after.total_rows, 3);
  });

  /*
   * The one that would have broken under renumbering, and the reason this is worth a
   * test rather than an assertion in a comment.
   */
  test("a correction below the removal stays on the row it was typed for", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const preview = await upload(FIVE_ROWS);
    const corrected = await fixRow(preview.upload_id, 5, { "session.title": "Talk Four, corrected" });
    assert.equal(corrected.rows.find((row) => row.row === 5)?.title, "Talk Four, corrected");

    const after = (await (await remove(preview.upload_id, 2)).json()) as Preview;
    assert.equal(
      after.rows.find((row) => row.row === 5)?.title,
      "Talk Four, corrected",
      "the correction followed the row number, so removing an earlier row must not move it",
    );
  });

  test("the last row cannot be removed, and the attempt changes nothing", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const preview = await upload(
      ["Session Title,Session Location,Session Date,Session Start,Session End",
       "Only Row,Ballroom A,03/14/2027,9:00 AM,10:00 AM"].join("\n"),
    );
    const response = await remove(preview.upload_id, 2);
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as { code: string }).code, "import.last_row");

    const still = await restore(preview.upload_id);
    assert.equal(still.rows.length, 1, "the refused removal must not have been half-applied");
  });

  test("restore puts every removed row back", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const preview = await upload(FIVE_ROWS);
    await remove(preview.upload_id, 2);
    const twoGone = (await (await remove(preview.upload_id, 4)).json()) as Preview;
    assert.deepEqual(twoGone.excluded, [2, 4]);
    assert.deepEqual(twoGone.rows.map((row) => row.row), [3, 5]);

    const back = await restore(preview.upload_id);
    assert.deepEqual(back.excluded, []);
    assert.deepEqual(back.rows.map((row) => row.row), [2, 3, 4, 5]);
  });
});
