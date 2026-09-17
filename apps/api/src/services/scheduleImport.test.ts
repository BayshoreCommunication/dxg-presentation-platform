import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { autoMap, closestRoom, editDistance, zonedToUtc } from "./scheduleImport.ts";

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
