import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { linkExpiry, RETENTION_DAYS } from "./archive.ts";

/** The client's download link lasts 30 days from the event's end (D-069). */
describe("archive link retention", () => {
  test("expires 30 days after the end of the event's last day", () => {
    const expiry = linkExpiry("2026-03-12", new Date("2026-03-12T20:00:00Z"));
    assert.equal(RETENTION_DAYS, 30);
    assert.equal(expiry.toISOString(), "2026-04-11T23:59:59.000Z");
  });

  test("counts from the event's end, not from when it was delivered", () => {
    const early = linkExpiry("2026-03-12", new Date("2026-03-13T09:00:00Z"));
    const later = linkExpiry("2026-03-12", new Date("2026-03-20T09:00:00Z"));
    assert.equal(early.toISOString(), later.toISOString());
  });

  test("a package delivered late still gets a week, never a link that is already dead", () => {
    const now = new Date("2026-05-01T12:00:00Z"); // 50 days after the event
    const expiry = linkExpiry("2026-03-12", now);
    assert.equal(expiry.getTime(), now.getTime() + 7 * 86_400_000);
  });
});
