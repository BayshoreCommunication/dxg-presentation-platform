import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { removeTestEvents } from "../helpers/cleanup.ts";

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
  rows: { row: number; missing: string[]; title: string; room: string; starts_at: string | null }[];
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
