import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAddress } from "./validate.ts";

test("ordinary addresses pass, domain lower-cased", () => {
  for (const address of ["speaker@gmail.com", "first.last+dxg@Company.Co.UK", "o'neil@example.org", "x@xn--bcher-kva.de"]) {
    const result = checkAddress(address);
    assert.equal(result.ok, true, address);
  }
  const result = checkAddress("  Jane.Doe@Example.COM ");
  assert.deepEqual(result, { ok: true, address: "Jane.Doe@example.com", domain: "example.com" });
});

test("malformed addresses are refused with a reason", () => {
  for (const address of [
    "",
    "no-at-sign",
    "two@@signs.com",
    "a@b@c.com",
    "@nolocal.com",
    "space in@name.com",
    "dot..dot@name.com",
    ".leading@name.com",
    "x@nodot",
    "x@-bad-.com",
    "x@name.c",
    "x@name.123",
    `${"a".repeat(65)}@name.com`,
  ]) {
    const result = checkAddress(address);
    assert.equal(result.ok, false, address);
    if (!result.ok) assert.ok(result.reason.length > 0);
  }
});

test("common provider typos are refused with the likely address", () => {
  const result = checkAddress("irakibul568@gmial.com");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, /typo for gmail\.com/);
    assert.equal(result.suggestion, "irakibul568@gmail.com");
  }
  assert.equal(checkAddress("me@hotmial.com").ok, false);
  assert.equal(checkAddress("me@yahoo.con").ok, false);
});
