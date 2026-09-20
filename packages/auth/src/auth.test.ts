import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, checkPassword } from "./password.ts";
import {
  generateAccessCode,
  normaliseCode,
  hashSecret,
  generateSessionToken,
  lockoutFor,
  lockoutState,
} from "./codes.ts";

describe("password hashing", () => {
  test("a correct password verifies and a wrong one does not", async () => {
    const stored = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("correct horse battery staple", stored), true);
    assert.equal(await verifyPassword("correct horse battery stapl", stored), false);
    assert.equal(await verifyPassword("", stored), false);
  });

  test("the same password hashes differently every time (salted)", async () => {
    const a = await hashPassword("a reasonably long password");
    const b = await hashPassword("a reasonably long password");
    assert.notEqual(a, b);
    assert.equal(await verifyPassword("a reasonably long password", a), true);
    assert.equal(await verifyPassword("a reasonably long password", b), true);
  });

  test("the hash records its parameters so they can be raised later", async () => {
    const stored = await hashPassword("a reasonably long password");
    assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$/);
  });

  test("the plaintext never appears in the stored value", async () => {
    const secret = "zebra-mango-lantern-77";
    const stored = await hashPassword(secret);
    assert.equal(stored.includes(secret), false);
  });

  test("a missing or malformed hash fails closed rather than throwing", async () => {
    assert.equal(await verifyPassword("anything", null), false);
    assert.equal(await verifyPassword("anything", ""), false);
    assert.equal(await verifyPassword("anything", "not-a-hash"), false);
    assert.equal(await verifyPassword("anything", "scrypt$x$y$z$bad$bad"), false);
  });

  test("unicode-equivalent passwords are treated as the same password", async () => {
    // The same string typed on two keyboards can differ byte-for-byte.
    const composed = "café-au-lait-2026";
    const decomposed = "café-au-lait-2026";
    const stored = await hashPassword(composed);
    assert.equal(await verifyPassword(decomposed, stored), true);
  });
});

describe("password policy", () => {
  test("length is the rule, not character classes", () => {
    assert.equal(checkPassword("Sh0rt")?.code, "too_short", "five characters is under the minimum");
    assert.equal(checkPassword("Sh0rt!"), null, "six is the minimum, so six passes");
    assert.equal(checkPassword("all lowercase and long enough"), null);
  });

  /*
   * These two used to assert `too_short`, which meant the dictionary was never
   * actually exercised — both are eleven characters and the old twelve-character
   * minimum caught them first. The test passed for the wrong reason. At a minimum of
   * six they reach the dictionary, which is what its name always claimed to check.
   */
  test("common passwords are rejected however long", () => {
    assert.equal(checkPassword("password123")?.code, "too_common");
    assert.equal(checkPassword("dxgpassword")?.code, "too_common");
    assert.equal(checkPassword("passwordpassword"), null, "not on the list, however guessable it looks");
  });

  /*
   * Lowering the minimum to six is what makes these reachable at all: every one of
   * them is long enough now, so the dictionary is the only thing refusing them.
   */
  test("the most-guessed short passwords are refused", () => {
    for (const guess of ["123456", "qwerty", "abc123", "letmein", "monkey", "111111", "secret"]) {
      assert.equal(checkPassword(guess)?.code, "too_common", `${guess} should be refused`);
    }
  });

  test("case and spacing do not smuggle a common password past the list", () => {
    assert.equal(checkPassword("QWERTY")?.code, "too_common");
    assert.equal(checkPassword("Abc123")?.code, "too_common");
  });

  test("an absurdly long password is refused rather than hashed", () => {
    assert.equal(checkPassword("x".repeat(201))?.code, "too_long");
  });
});

describe("presenter access codes", () => {
  test("codes are grouped and readable", () => {
    const code = generateAccessCode();
    assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  test("the alphabet excludes characters people confuse", () => {
    const sample = Array.from({ length: 200 }, () => generateAccessCode()).join("");
    for (const confusable of ["O", "I", "L", "S", "Z", "B", "0", "1", "5", "2", "8"]) {
      assert.equal(sample.includes(confusable), false, `${confusable} should not appear in codes`);
    }
  });

  test("codes do not repeat in a large sample", () => {
    const codes = new Set(Array.from({ length: 2000 }, () => generateAccessCode()));
    assert.equal(codes.size, 2000);
  });

  test("typing is forgiving: case, spaces, dashes and confusable characters", () => {
    const code = "ACDE-FGHJ-KMNP";
    for (const typed of ["acde-fghj-kmnp", "ACDE FGHJ KMNP", "ACDEFGHJKMNP", " acde–fghj_kmnp "]) {
      assert.equal(normaliseCode(typed), normaliseCode(code), `"${typed}" should match`);
    }
  });

  test("a genuinely different code does not normalise to the same value", () => {
    assert.notEqual(normaliseCode("ACDE-FGHJ-KMNP"), normaliseCode("ACDE-FGHJ-KMNQ"));
  });

  test("session tokens are long, opaque and unique", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateSessionToken()));
    assert.equal(tokens.size, 1000);
    assert.ok(generateSessionToken().length >= 43);
  });

  test("only the hash of a secret is ever stored", () => {
    const code = generateAccessCode();
    const digest = hashSecret(code);
    assert.equal(digest.length, 32);
    assert.equal(digest.toString("hex").includes(code.replace(/-/g, "").toLowerCase()), false);
  });
});

describe("lockout", () => {
  const now = new Date("2026-03-11T10:00:00Z");

  test("no lockout below the threshold", () => {
    for (let failures = 0; failures < 5; failures += 1) {
      assert.equal(lockoutFor(failures, now), null);
    }
  });

  test("lockout starts at the threshold and grows, capped at 30 minutes", () => {
    const first = lockoutFor(5, now)!;
    const later = lockoutFor(9, now)!;
    const capped = lockoutFor(30, now)!;
    assert.ok(first > now);
    assert.ok(later > first);
    assert.equal((capped.getTime() - now.getTime()) / 60_000, 30);
  });

  test("state reports remaining attempts before the lock bites", () => {
    assert.deepEqual(lockoutState(null, 2, now), { locked: false, until: null, remaining: 3 });
  });

  test("an expired lock is not a lock", () => {
    const past = new Date(now.getTime() - 1000);
    assert.equal(lockoutState(past, 9, now).locked, false);
  });

  test("a live lock reports when it lifts", () => {
    const future = new Date(now.getTime() + 60_000);
    const state = lockoutState(future, 6, now);
    assert.equal(state.locked, true);
    assert.equal(state.until?.toISOString(), future.toISOString());
  });
});
