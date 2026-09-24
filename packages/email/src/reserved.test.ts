import { test } from "node:test";
import assert from "node:assert/strict";
import { isReservedAddress } from "./index.ts";

/** Seeded and probe addresses never reach SES; real ones always do. */
test("reserved test domains are recognised", () => {
  for (const address of [
    "a.fontaine@example.invalid",
    "probe@EXAMPLE.INVALID",
    "x@site.test",
    "x@example.com",
    "x@mail.example.org",
    "x@example.net",
    "x@localhost",
    "x@thing.example",
  ]) {
    assert.equal(isReservedAddress(address), true, address);
  }
});

test("real domains are not", () => {
  for (const address of ["speaker@gmail.com", "someone@company.co", "x@notexample.com", "x@example.co", "x@invalid.io"]) {
    assert.equal(isReservedAddress(address), false, address);
  }
});
