import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSheet } from "@pmp/files";
import { autoMap, closestRoom, editDistance, zonedToUtc, findHeaderRow, provisionalName, toDateTime, agendaTemplateCsv, manualAgendaCsv, REQUIRED_FIELDS } from "./scheduleImport.ts";

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

  test("the presentation timing columns are read as the slot's own time", () => {
    // These were unmapped until `slots` had times to put them in (D-031).
    const { headers } = findHeaderRow(sheet);
    const mapping = autoMap(headers);
    assert.equal(mapping[headers.indexOf("Presentation Start")], "slot.start");
    assert.equal(mapping[headers.indexOf("Presentation End")], "slot.end");
    assert.equal(mapping[headers.indexOf("Presentation Duration")], "slot.duration");
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

/*
 * A template we hand out and cannot read back is worse than no template: the operator
 * has done as they were told and still cannot import. These assert the round trip
 * against the real parser rather than against a description of it.
 */
describe("the agenda template we hand out is one we can read", () => {
  const sheet = parseSheet(Buffer.from(agendaTemplateCsv("MedTech Forward 2027"), "utf8"), "template.csv");

  test("the header row is found under the banner", () => {
    const { headers, index } = findHeaderRow(sheet);
    assert.equal(index, 1);
    assert.equal(headers[0], "Session Title");
  });

  test("every required field maps with no manual intervention", () => {
    const { headers } = findHeaderRow(sheet);
    const mapped = autoMap(headers).filter(Boolean);
    for (const field of REQUIRED_FIELDS) {
      assert.ok(mapped.includes(field), `${field} is not mapped by the template's own headings`);
    }
  });

  /*
   * Every column, not just the required ones. The weaker version of this test passed
   * while `Presenter Organization` was mapping to `speaker.name` — so the organization
   * became the speaker's display name and the first/last name columns, though mapped,
   * were discarded by the `speaker.name ||` precedence in buildPreview. Our own
   * template demonstrated the bug and the test could not see it.
   */
  test("every column maps to the field its heading names, and the rest to nothing", () => {
    const { headers } = findHeaderRow(sheet);
    const mapping = autoMap(headers);
    // The whole sheet, in order: what each column is read as, or null where the column
    // is recognised and deliberately not mapped.
    const expected: [string, string | null][] = [
      ["Session Title", "session.title"],
      ["Session Location", "room.name"],
      ["Session Date", "session.date"],
      ["Session Start", "session.start"],
      ["Session End", "session.end"],
      // A Preseria presentation sits inside a session — now a slot with its own time.
      ["Presentation Start", "slot.start"],
      ["Presentation End", "slot.end"],
      ["Presentation Duration", "slot.duration"],
      ["Presenter 1 Email", "speaker.email"],
      ["Presenter 1 First Name", "speaker.first_name"],
      ["Presenter 1 Last Name", "speaker.last_name"],
      ["Presenter 2 Email", "speaker2.email"],
      ["Presenter 2 First Name", "speaker2.first_name"],
      ["Presenter 2 Last Name", "speaker2.last_name"],
    ];
    assert.deepEqual(headers, expected.map(([heading]) => heading), "the template's columns, in order");
    assert.deepEqual(mapping, expected.map(([, field]) => field));
  });

  test("it carries the same columns as DXG's own sheet", () => {
    // The sheet event organisers already receive. Ours differs in exactly one heading:
    // theirs labels presenter 1's surname "Presenter 2 Last Name", which is a mistake
    // at source — it is REQUIRED and sits inside presenter 1's block.
    const dxg = [
      "Session Title", "Session Location", "Session Date", "Session Start", "Session End",
      "Presentation Start", "Presentation End", "Presentation Duration",
      "Presenter 1 Email", "Presenter 1 First Name", "Presenter 2 Last Name",
      "Presenter 2 Email", "Presenter 2 First Name", "Presenter 2 Last Name",
    ];
    const ours = findHeaderRow(sheet).headers;
    assert.equal(ours.length, dxg.length);
    const differences = ours.filter((heading, index) => heading !== dxg[index]);
    assert.deepEqual(differences, ["Presenter 1 Last Name"], "one corrected label, nothing else");
  });

  test("a sheet still carrying the original mislabel maps the same way", () => {
    // Files already in circulation must not be affected by our corrected heading.
    const theirs = autoMap([
      "Presenter 1 Email", "Presenter 1 First Name", "Presenter 2 Last Name",
      "Presenter 2 Email", "Presenter 2 First Name", "Presenter 2 Last Name",
    ]);
    const ours = autoMap([
      "Presenter 1 Email", "Presenter 1 First Name", "Presenter 1 Last Name",
      "Presenter 2 Email", "Presenter 2 First Name", "Presenter 2 Last Name",
    ]);
    assert.deepEqual(theirs, ours);
    assert.deepEqual(ours, [
      "speaker.email",
      "speaker.first_name",
      "speaker.last_name",
      "speaker2.email",
      "speaker2.first_name",
      "speaker2.last_name",
    ]);
  });

  test("the required row matches what the importer actually refuses to import without", () => {
    const { headers, index } = findHeaderRow(sheet);
    const requiredRow = sheet[index + 2]!;
    const mapping = autoMap(headers);
    for (const field of REQUIRED_FIELDS) {
      const column = mapping.indexOf(field);
      assert.equal(requiredRow[column], "REQUIRED", `${field}'s column must be marked REQUIRED`);
    }
  });

  test("the hint, REQUIRED and EXAMPLE rows are all annotation, so a blank template has no sessions", () => {
    const { firstDataRow } = findHeaderRow(sheet);
    assert.equal(sheet.length - firstDataRow, 0, "a blank template must import zero rows, not an example");
  });

  test("the example row's own date format is the one the template asks for", () => {
    // The row is dropped on import, but it is what a human copies. If it demonstrated
    // a format the parser could not read, the template would be teaching the mistake.
    const { headers } = findHeaderRow(sheet);
    const mapping = autoMap(headers);
    const example = sheet.find((row) => /^EXAMPLE/.test(row[0] ?? ""))!;
    const at = (field: string) => example[mapping.indexOf(field as never)]!;
    assert.equal(toDateTime(at("session.date"), at("session.start")), "2027-03-14T09:00:00");
    assert.equal(at("speaker.first_name"), "Alex");
    assert.equal(at("speaker.last_name"), "Okonkwo");
  });

  test("names the event when it knows it, and copes when it does not", () => {
    assert.match(agendaTemplateCsv("MedTech Forward 2027"), /MedTech Forward 2027/);
    assert.ok(agendaTemplateCsv().startsWith("DXG AGENDA TEMPLATE (US Date/Time Format),"));
  });
});

/*
 * DXG's sheet labels presenter 1's surname "Presenter 2 Last Name" (D-029). Matching
 * on the ordinal *in the label* would therefore file it under the second presenter and
 * leave the first with no surname — worse than before. Matching on the order the
 * columns appear gets both sheets right, and is how these sheets are actually laid out.
 */
describe("a second presenter is read from the second set of presenter columns", () => {
  test("DXG's own sheet, mislabel and all, fills presenter 1 then presenter 2", () => {
    assert.deepEqual(
      autoMap([
        "Presenter 1 Email",
        "Presenter 1 First Name",
        "Presenter 2 Last Name", // mislabelled at source; it is presenter 1's surname
        "Presenter 2 Email",
        "Presenter 2 First Name",
        "Presenter 2 Last Name",
      ]),
      [
        "speaker.email",
        "speaker.first_name",
        "speaker.last_name",
        "speaker2.email",
        "speaker2.first_name",
        "speaker2.last_name",
      ],
    );
  });

  test("our corrected template maps the same way", () => {
    assert.deepEqual(
      autoMap([
        "Presenter 1 Email",
        "Presenter 1 First Name",
        "Presenter 1 Last Name",
        "Presenter 2 Email",
        "Presenter 2 First Name",
        "Presenter 2 Last Name",
      ]),
      [
        "speaker.email",
        "speaker.first_name",
        "speaker.last_name",
        "speaker2.email",
        "speaker2.first_name",
        "speaker2.last_name",
      ],
    );
  });

  test("a sheet with one presenter leaves the second unmapped", () => {
    assert.deepEqual(autoMap(["Presenter Email", "Presenter First Name", "Presenter Last Name"]), [
      "speaker.email",
      "speaker.first_name",
      "speaker.last_name",
    ]);
  });

  test("a third presenter is read too", () => {
    // Capped at two until presenters became a list; see the "more than two" suite.
    const mapped = autoMap(["Presenter 1 Email", "Presenter 2 Email", "Presenter 3 Email"]);
    assert.deepEqual(mapped, ["speaker.email", "speaker2.email", "speaker3.email"]);
  });
});

describe("a presentation's own time is not the session's", () => {
  test("the presentation columns map to the slot, the session columns to the session", () => {
    assert.deepEqual(
      autoMap([
        "Session Start",
        "Session End",
        "Presentation Start",
        "Presentation End",
        "Presentation Duration",
      ]),
      ["session.start", "session.end", "slot.start", "slot.end", "slot.duration"],
    );
  });

  test("the order the columns appear in does not change what they mean", () => {
    assert.deepEqual(
      autoMap(["Presentation Start", "Session Start", "Presentation End", "Session End"]),
      ["slot.start", "session.start", "slot.end", "session.end"],
    );
  });
});

/*
 * `toDateTime` defaulted a missing clock to 09:00. For a session that quietly invented
 * a start time — and worse, made `Session Start` pass the required-field check that
 * the template and the row editor both promise to enforce. For a presentation it
 * invented a slot time on every row whose optional Presentation Start was blank.
 */
describe("a missing time is missing, not nine in the morning", () => {
  test("a date with no clock yields nothing", () => {
    assert.equal(toDateTime("03/14/2027", ""), null);
    assert.equal(toDateTime("03/14/2027", "   "), null);
  });

  test("a date with a clock is unaffected", () => {
    assert.equal(toDateTime("03/14/2027", "9:00 AM"), "2027-03-14T09:00:00");
    assert.equal(toDateTime("03/14/2027", "4:30 PM"), "2027-03-14T16:30:00");
  });

  test("an unreadable clock is still refused", () => {
    assert.equal(toDateTime("03/14/2027", "half past nine"), null);
  });

  test("no date means no time, whatever the clock says", () => {
    assert.equal(toDateTime("", "9:00 AM"), null);
  });
});

describe("more than two presenters", () => {
  test("a sheet with three presenter blocks maps all three", () => {
    assert.deepEqual(
      autoMap([
        "Presenter 1 Email", "Presenter 1 First Name", "Presenter 1 Last Name",
        "Presenter 2 Email", "Presenter 2 First Name", "Presenter 2 Last Name",
        "Presenter 3 Email", "Presenter 3 First Name", "Presenter 3 Last Name",
      ]),
      [
        "speaker.email", "speaker.first_name", "speaker.last_name",
        "speaker2.email", "speaker2.first_name", "speaker2.last_name",
        "speaker3.email", "speaker3.first_name", "speaker3.last_name",
      ],
    );
  });

  test("the run stops at six rather than inventing a seventh", () => {
    const emails = Array.from({ length: 7 }, (_, index) => `Presenter ${index + 1} Email`);
    const mapped = autoMap(emails);
    assert.equal(mapped.filter(Boolean).length, 6);
    assert.equal(mapped[6], null, "a seventh presenter has no field to go in");
  });
});

describe("an agenda typed in rather than uploaded", () => {
  const sheet = parseSheet(Buffer.from(manualAgendaCsv(), "utf8"), "manual-entry.csv");

  test("its headings are row one, and there are no data rows to skip", () => {
    const { headers, index, firstDataRow } = findHeaderRow(sheet);
    assert.equal(index, 0);
    assert.equal(headers[0], "Session Title");
    assert.equal(firstDataRow, 1);
    assert.equal(sheet.slice(firstDataRow).length, 0);
  });

  test("every required field maps, so a typed row is validated like an uploaded one", () => {
    const mapped = autoMap(findHeaderRow(sheet).headers).filter(Boolean);
    for (const field of REQUIRED_FIELDS) {
      assert.ok(mapped.includes(field), `${field} is not mapped by the manual headings`);
    }
  });

  /*
   * The reason `buildPreview` appends typed rows itself rather than writing blank
   * lines into the body. `parseCsv` drops a row whose every cell is empty, so a blank
   * row written into the file is gone before anyone can fill it in — which is exactly
   * how the first attempt at this produced an import with no rows in it.
   */
  test("a blank line in the body would not survive parsing", () => {
    const withBlanks = manualAgendaCsv() + ",,,,,,,,,,,,,\r\n,,,,,,,,,,,,,\r\n";
    const parsed = parseSheet(Buffer.from(withBlanks, "utf8"), "manual-entry.csv");
    assert.equal(parsed.length, 1, "the blank rows should have been dropped by the parser");
  });

  test("the headings are the template's, so a typed agenda and an uploaded one are one format", () => {
    const template = findHeaderRow(parseSheet(Buffer.from(agendaTemplateCsv(), "utf8"), "t.csv")).headers;
    assert.deepEqual(findHeaderRow(sheet).headers, template);
  });
});
