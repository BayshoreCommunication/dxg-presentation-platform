import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { firstName } from "./firstName.ts";

/**
 * `{{speaker_first}}` in speaker email. It used to take the last word of the name, so the
 * default invitation greeted "Dr. Priya Raman" as "Hi Raman".
 */
describe("firstName", () => {
  test("takes the first word, not the last", () => {
    assert.equal(firstName("Kwame Osei"), "Kwame");
    assert.equal(firstName("Maria de la Cruz"), "Maria");
  });

  test("skips honorifics, with or without a full stop, in any case", () => {
    assert.equal(firstName("Dr. Priya Raman"), "Priya");
    assert.equal(firstName("Dr Priya Raman"), "Priya");
    assert.equal(firstName("PROF. Ada Lovelace"), "Ada");
    assert.equal(firstName("mrs Jane Smith"), "Jane");
    for (const title of ["Mr", "Ms", "Mx", "Sir", "Dame"]) {
      assert.equal(firstName(`${title} Alex Kim`), "Alex", title);
    }
  });

  test("skips more than one leading title", () => {
    assert.equal(firstName("Prof. Dr. Hans Weber"), "Hans");
  });

  test("keeps a single-word name as it is", () => {
    assert.equal(firstName("Madonna"), "Madonna");
  });

  test("does not mistake a name that starts like a title for one", () => {
    assert.equal(firstName("Drew Barrymore"), "Drew");
    assert.equal(firstName("Msizi Dlamini"), "Msizi");
  });

  test("ignores stray whitespace", () => {
    assert.equal(firstName("  Dr.   Priya\tRaman  "), "Priya");
  });

  test("falls back to the full name when only titles are left", () => {
    assert.equal(firstName("Dr."), "Dr.");
    assert.equal(firstName("Prof Dr"), "Prof Dr");
    assert.equal(firstName(""), "");
  });
});
