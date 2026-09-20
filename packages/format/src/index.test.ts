import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatBytes, formatBytesDelta } from "./index.ts";

describe("formatBytes", () => {
  // The bug this function exists to prevent: a real file must never read as "0".
  test("a small real file is never rendered as zero", () => {
    assert.equal(formatBytes(68_912), "68.9 KB");
    assert.notEqual(formatBytes(68_912), "0 MB");
    assert.equal(formatBytes(1), "1 byte");
    assert.equal(formatBytes(999), "999 bytes");
  });

  test("picks the unit from the magnitude", () => {
    assert.equal(formatBytes(0), "0 bytes");
    assert.equal(formatBytes(1_000), "1.0 KB");
    assert.equal(formatBytes(1_000_000), "1.0 MB");
    assert.equal(formatBytes(155_000_000), "155 MB");
    assert.equal(formatBytes(1_200_000_000), "1.2 GB");
    assert.equal(formatBytes(10_000_000_000), "10.0 GB");
  });

  test("drops the decimal above 100, where it is only noise", () => {
    assert.equal(formatBytes(99_400), "99.4 KB");
    assert.equal(formatBytes(100_400), "100 KB");
  });

  test("accepts the string sizes the API returns for bigint columns", () => {
    assert.equal(formatBytes("504413000"), "504 MB");
    assert.equal(formatBytes("0"), "0 bytes");
  });

  test("refuses to invent a number it does not have", () => {
    assert.equal(formatBytes(null), "—");
    assert.equal(formatBytes(undefined), "—");
    assert.equal(formatBytes("not a number"), "—");
  });

  test("handles negatives, which deltas produce", () => {
    assert.equal(formatBytes(-2_400_000), "-2.4 MB");
  });
});

describe("formatBytesDelta", () => {
  test("signs the difference so the direction is unmistakable", () => {
    assert.equal(formatBytesDelta(1_000_000, 3_400_000), "+2.4 MB");
    assert.equal(formatBytesDelta(3_400_000, 1_000_000), "-2.4 MB");
  });

  test("says so plainly when nothing changed", () => {
    assert.equal(formatBytesDelta(1_000_000, 1_000_000), "unchanged");
  });

  test("a small change is still visible, not rounded to zero", () => {
    assert.equal(formatBytesDelta(1_000_000, 1_068_912), "+68.9 KB");
  });
});
