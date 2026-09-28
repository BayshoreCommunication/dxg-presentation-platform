import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatDateRange, humanize, roleList, talkRoomNote, timeZoneLabel, timeZoneOptions, wordsFor, IMPORT_ROW, ROLE } from "./vocabulary.ts";

test("unknown codes read as words, never raw", () => {
  assert.equal(humanize("sync_failed"), "Sync failed");
  assert.equal(wordsFor(ROLE, "brand_new_role").label, "Brand new role");
  assert.equal(wordsFor(ROLE, "srr_technician").label, "Speaker Ready Room technician");
});

test("role lists are sentences", () => {
  assert.equal(roleList(["content_reviewer", "project_manager", "platform_admin"]), "Reviewer, Project manager or DXG administrator");
});

test("time zones by name, US first", () => {
  assert.equal(timeZoneLabel("America/New_York"), "Eastern Time (New York)");
  assert.equal(timeZoneLabel("Europe/London"), "London (Europe)");
  assert.equal(timeZoneLabel("America/Argentina/Buenos_Aires"), "Buenos Aires (America)");
  assert.deepEqual(
    timeZoneOptions(["Europe/London", "America/Chicago", "America/New_York"]).map((option) => option.zone),
    ["America/New_York", "America/Chicago", "Europe/London"],
  );
});

test("dates are readable and never shift a day", () => {
  assert.equal(formatDate("2026-09-30"), "Sep 30, 2026");
  assert.equal(formatDateRange("2026-03-10", "2026-03-12"), "Mar 10 – 12, 2026");
  assert.equal(formatDateRange("2026-03-30", "2026-04-02"), "Mar 30 – Apr 2, 2026");
  assert.equal(formatDateRange("2026-12-30", "2027-01-02"), "Dec 30, 2026 – Jan 2, 2027");
  assert.equal(formatDateRange("2026-05-01", "2026-05-01"), "May 1, 2026");
});

test("a talk the room confirmed goes amber when the room PC is silent (R7)", () => {
  assert.equal(talkRoomNote("synchronized_onsite", 60), null);
  assert.equal(talkRoomNote("synchronized_onsite", 300), null);
  assert.match(talkRoomNote("synchronized_onsite", 6 * 86_400) ?? "", /^Last confirmed 6 days ago/);
  assert.match(talkRoomNote("update_pending_ack", 7_200) ?? "", /2 hours ago/);
  assert.match(talkRoomNote("approved_delivering", null) ?? "", /hasn't reported yet/);
  // Statuses that don't depend on the room PC, and talks with no known room, are left alone.
  assert.equal(talkRoomNote("submitted", 6 * 86_400), null);
  assert.equal(talkRoomNote("synchronized_onsite", undefined), null);
});

test("every schedule-import row action reads as words (S19)", () => {
  for (const action of ["create", "update", "unchanged", "incomplete", "saved"]) {
    assert.ok(IMPORT_ROW[action]?.label, action);
  }
  assert.equal(wordsFor(IMPORT_ROW, "update").label, "Will update");
});
