import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSheet } from "@pmp/files";
import { autoMap, closestRoom, editDistance, zonedToUtc, findHeaderRow, provisionalName, toDateTime } from "./scheduleImport.ts";

describe("column auto-mapping (FR-IMP-001)", () => {
  test("maps a typical DXG header row exactly", () => {
    const headers = [
      "Session Title",
      "Room",
      "Date",
      "Start",
      "End",
      "Speaker Name",
      "Speaker Email",
      "Organization",
      "Track",
    ];
    assert.deepEqual(autoMap(headers), [
      "session.title",
      "room.name",
      "session.date",
      "session.start",
      "session.end",
      "speaker.name",
      "speaker.email",
      "speaker.organization",
      "track.name",
    ]);
  });

  test("copes with different wording and casing", () => {
    const mapped = autoMap(["TALK", "Location", "Day", "start time", "e-mail"]);
    assert.equal(mapped[0], "session.title");
    assert.equal(mapped[1], "room.name");
    assert.equal(mapped[2], "session.date");
    assert.equal(mapped[3], "session.start");
    assert.equal(mapped[4], "speaker.email");
  });

  test("never maps two columns to the same field", () => {
    const mapped = autoMap(["Title", "Session Title", "Room"]);
    const used = mapped.filter((field): field is NonNullable<typeof field> => field !== null);
    assert.equal(new Set(used).size, used.length);
  });

  test("leaves unknown columns unmapped rather than guessing", () => {
    assert.equal(autoMap(["Catering notes"])[0], null);
  });
});

describe("room suggestions are conservative", () => {
  const rooms = ["Ballroom A", "Ballroom B", "Room 210", "Room 212"];

  test("suggests the obvious typo", () => {
    assert.equal(closestRoom("Ballroon B", rooms), "Ballroom B");
    assert.equal(closestRoom("room 21O", rooms), null); // two rooms equally close — ambiguous
  });

  test("offers nothing when the name is far from every room", () => {
    assert.equal(closestRoom("Exhibition Hall", rooms), null);
  });

  test("offers nothing for an exact match", () => {
    assert.equal(closestRoom("Ballroom A", rooms), null);
  });

  test("refuses to choose between two equally close rooms", () => {
    assert.equal(closestRoom("Room 211", ["Room 210", "Room 212"]), null);
  });

  test("edit distance is symmetric and zero for equal strings", () => {
    assert.equal(editDistance("abc", "abc"), 0);
    assert.equal(editDistance("kitten", "sitting"), editDistance("sitting", "kitten"));
  });
});

describe("spreadsheet times are venue wall-clock, not UTC", () => {
  test("a March morning in New York is EDT (UTC-4)", () => {
    assert.equal(
      zonedToUtc("2026-03-11T10:30:00", "America/New_York").toISOString(),
      "2026-03-11T14:30:00.000Z",
    );
  });

  test("a January morning in New York is EST (UTC-5)", () => {
    assert.equal(
      zonedToUtc("2026-01-21T10:30:00", "America/New_York").toISOString(),
      "2026-01-21T15:30:00.000Z",
    );
  });

  test("UTC events are unchanged", () => {
    assert.equal(zonedToUtc("2026-03-11T10:30:00", "UTC").toISOString(), "2026-03-11T10:30:00.000Z");
  });
});

/*
 * DXG supplies agendas on the Preseria import template. It is not shaped like the
 * hand-made sheet the mapper was written against: a banner occupies row 1, the real
 * headers are row 2, and two annotation rows sit under them. Every assertion below
 * failed before `findHeaderRow` and the mapping fixes existed.
 */
describe("the Preseria template (v.1.3) imports without manual mapping", () => {
  const sheet = parseSheet(
    readFileSync(new URL("../../../../tests/fixtures/preseria-v1.3.csv", import.meta.url)),
    "preseria-v1.3.csv",
  );

  test("the header row is found, not assumed to be row 1", () => {
    const found = findHeaderRow(sheet);
    assert.equal(found.index, 1, "row 2 carries the real headers");
    assert.equal(found.headers[0], "Session Title");
    // The two annotation rows under the header are not sessions.
    assert.equal(found.firstDataRow, 4);
  });

  test("a banner row is never mistaken for a header", () => {
    // Row 1 is "PRESERIA IMPORT TEMPLATE …" plus ten empty cells.
    assert.notEqual(findHeaderRow(sheet).index, 0);
  });

  test("every required column maps on its own", () => {
    const { headers } = findHeaderRow(sheet);
    const mapping = autoMap(headers);
    const at = (name: string) => mapping[headers.indexOf(name)] ?? null;

    assert.equal(at("Session Title"), "session.title");
    assert.equal(at("Session Location"), "room.name");
    assert.equal(at("Session Date"), "session.date");
    assert.equal(at("Session Start"), "session.start");
    assert.equal(at("Session End"), "session.end");
  });

  test("the presenter's email is mapped as an email, not as their name", () => {
    const { headers } = findHeaderRow(sheet);
    const mapping = autoMap(headers);
    assert.equal(
      mapping[headers.indexOf("Presenter 1 Email")],
      "speaker.email",
      "mapping presenter 1's address to speaker.name sent every invitation to presenter 2",
    );
    // Presenter 2's address must not become the contact address for the session.
    assert.notEqual(mapping[headers.indexOf("Presenter 2 Email")], "speaker.email");
  });

  test("split presenter names map to first and last name fields", () => {
    const { headers } = findHeaderRow(sheet);
    const mapping = autoMap(headers);
    assert.equal(mapping[headers.indexOf("Presenter 1 First Name")], "speaker.first_name");
  });

  test("a blank column header maps to nothing at all", () => {
    // The banner row is mostly empty cells; under substring matching every one of
    // them claimed the next unused field, because "".includes("") is true.
    assert.deepEqual(autoMap(["", "", ""]), [null, null, null]);
    assert.deepEqual(autoMap(["Session Title", "", ""]), ["session.title", null, null]);
  });

  test("the timing columns Preseria leaves optional stay unmapped", () => {
    const { headers } = findHeaderRow(sheet);
    const mapping = autoMap(headers);
    for (const column of ["Presentation Start", "Presentation End", "Presentation Duration"]) {
      assert.equal(mapping[headers.indexOf(column)], null, `${column} should not be guessed at`);
    }
  });
});

/*
 * Every data row in DXG's file carries a presenter email and no name at all. The
 * commit created speakers only `if (row.speaker_name)`, so the whole agenda imported
 * with zero speakers and zero assignments — sessions with nobody to invite.
 */
describe("a presenter identified only by an address", () => {
  test("still yields a display name, since full_name is NOT NULL", () => {
    assert.equal(provisionalName("wallace@Branch-productions.com"), "Wallace");
  });

  test("splits on the punctuation people put in addresses", () => {
    assert.equal(provisionalName("anna.maria.k@example.org"), "Anna Maria K");
    assert.equal(provisionalName("j_ellis@example.org"), "J Ellis");
  });

  test("never invents a surname out of the domain", () => {
    assert.ok(!provisionalName("wallace@branch-productions.com").toLowerCase().includes("branch"));
  });

  test("an empty address yields nothing, so no speaker is created", () => {
    assert.equal(provisionalName(""), "");
  });
});

/*
 * `toDateTime` returns a wall-clock local ISO string which `zonedToUtc` then reads in
 * the event's timezone. It used to produce that string by handing the date to
 * `new Date` and taking `.toISOString().slice(0, 10)` — an instant, resolved in the
 * *server's* timezone. East of Greenwich that lands on the previous calendar day.
 *
 * This is environment-dependent, which is what makes it dangerous: production runs on
 * UTC and would never show it, while every session imported on a developer machine in
 * Asia/Dhaka was silently a day early. The Preseria template's mm/dd/yyyy is exactly
 * the format that takes this branch.
 */
describe("a calendar date survives the server's own timezone", () => {
  test("mm/dd/yyyy keeps its day", () => {
    assert.equal(toDateTime("05/16/2023", "8:00 AM"), "2023-05-16T08:00:00");
  });

  test("the end of a month does not roll back into the previous one", () => {
    assert.equal(toDateTime("03/01/2026", "9:30 AM"), "2026-03-01T09:30:00");
    assert.equal(toDateTime("01/01/2026", "12:00 AM"), "2026-01-01T00:00:00");
  });

  test("ISO dates are unchanged", () => {
    assert.equal(toDateTime("2023-05-16", "2:15 PM"), "2023-05-16T14:15:00");
  });

  test("a written date keeps its day too", () => {
    assert.equal(toDateTime("May 16 2023", "8:00 AM"), "2023-05-16T08:00:00");
  });

  test("the whole path lands on the right instant for a New York event", () => {
    // 8am on 16 May is EDT, UTC-4.
    const local = toDateTime("05/16/2023", "8:00 AM")!;
    assert.equal(zonedToUtc(local, "America/New_York").toISOString(), "2023-05-16T12:00:00.000Z");
  });
});
