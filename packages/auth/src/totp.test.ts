import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  base32Encode,
  base32Decode,
  hotp,
  totp,
  verifyTotp,
  otpauthUri,
  generateTotpSecret,
  generateRecoveryCodes,
  normaliseRecoveryCode,
  groupSecret,
} from "./totp.ts";

/** RFC 4648 §10 and RFC 6238 Appendix B. */
const RFC_SECRET_ASCII = "12345678901234567890";
const RFC_SECRET = base32Encode(Buffer.from(RFC_SECRET_ASCII));

describe("base32", () => {
  test("matches the RFC 4648 vectors", () => {
    assert.equal(base32Encode(Buffer.from("")), "");
    assert.equal(base32Encode(Buffer.from("f")), "MY");
    assert.equal(base32Encode(Buffer.from("fo")), "MZXQ");
    assert.equal(base32Encode(Buffer.from("foo")), "MZXW6");
    assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
  });

  test("round-trips arbitrary bytes", () => {
    const original = Buffer.from([0x00, 0xff, 0x10, 0x7a, 0x99, 0x01]);
    assert.deepEqual(base32Decode(base32Encode(original)), original);
  });

  test("tolerates spacing, dashes, padding and lower case", () => {
    assert.deepEqual(base32Decode("mzxw 6ytb-oi=="), base32Decode("MZXW6YTBOI"));
  });

  test("rejects characters that are not base32", () => {
    assert.throws(() => base32Decode("MZXW6YTB01"), /not valid base32/);
  });
});

describe("TOTP against the RFC 6238 test vectors", () => {
  // Appendix B, SHA-1, 8 digits.
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];

  for (const [seconds, expected] of vectors) {
    test(`T=${seconds} produces ${expected}`, () => {
      assert.equal(totp(RFC_SECRET, seconds * 1000, 30, 8), expected);
    });
  }

  test("the six-digit code is the tail of the eight-digit one", () => {
    for (const [seconds, expected] of vectors) {
      assert.equal(totp(RFC_SECRET, seconds * 1000), expected.slice(-6));
    }
  });

  test("HOTP counters advance independently of the clock", () => {
    const key = Buffer.from(RFC_SECRET_ASCII);
    assert.notEqual(hotp(key, 1), hotp(key, 2));
  });
});

describe("verification", () => {
  const now = 1_700_000_000_000;

  test("the current code verifies", () => {
    assert.equal(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now), { atMs: now }).valid, true);
  });

  test("a clock one step out either way still verifies", () => {
    for (const drift of [-30_000, 30_000]) {
      const code = totp(RFC_SECRET, now + drift);
      assert.equal(verifyTotp(RFC_SECRET, code, { atMs: now }).valid, true, `drift ${drift}`);
    }
  });

  test("two steps out does not", () => {
    const code = totp(RFC_SECRET, now + 90_000);
    assert.equal(verifyTotp(RFC_SECRET, code, { atMs: now }).valid, false);
  });

  test("a wrong code, the wrong length, and rubbish are all refused", () => {
    assert.equal(verifyTotp(RFC_SECRET, "000000", { atMs: now }).valid, false);
    assert.equal(verifyTotp(RFC_SECRET, "12345", { atMs: now }).valid, false);
    assert.equal(verifyTotp(RFC_SECRET, "abcdef", { atMs: now }).valid, false);
    assert.equal(verifyTotp(RFC_SECRET, "", { atMs: now }).valid, false);
  });

  test("spaces typed between digits are forgiven", () => {
    const code = totp(RFC_SECRET, now);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    assert.equal(verifyTotp(RFC_SECRET, spaced, { atMs: now }).valid, true);
  });

  test("the counter is reported so a reused code can be rejected", () => {
    const result = verifyTotp(RFC_SECRET, totp(RFC_SECRET, now), { atMs: now });
    assert.equal(typeof result.counter, "number");
  });

  test("a code from one secret does not verify against another", () => {
    const other = generateTotpSecret();
    assert.equal(verifyTotp(other, totp(RFC_SECRET, now), { atMs: now }).valid, false);
  });
});

describe("enrolment material", () => {
  test("generated secrets are 160-bit and unique", () => {
    const secrets = new Set(Array.from({ length: 200 }, () => generateTotpSecret()));
    assert.equal(secrets.size, 200);
    assert.equal(base32Decode(generateTotpSecret()).length, 20);
  });

  test("the otpauth URI carries what an authenticator needs", () => {
    const uri = otpauthUri({ secret: RFC_SECRET, account: "m.vega@dxg.live", issuer: "DXG·PM" });
    assert.match(uri, /^otpauth:\/\/totp\//);
    assert.ok(uri.includes(`secret=${RFC_SECRET}`));
    assert.ok(uri.includes("algorithm=SHA1"));
    assert.ok(uri.includes("digits=6"));
    assert.ok(uri.includes("period=30"));
  });

  test("secrets are grouped for typing", () => {
    assert.equal(groupSecret("ABCDEFGH"), "ABCD EFGH");
  });

  test("recovery codes are unique, readable and normalise for typing", () => {
    const codes = generateRecoveryCodes(20);
    assert.equal(new Set(codes).size, 20);
    for (const code of codes) assert.match(code, /^[a-z0-9]{5}-[a-z0-9]{5}$/);
    assert.equal(normaliseRecoveryCode(" ABcd1-2EfG3 "), "abcd12efg3");
  });

  test("recovery codes avoid characters misread on paper", () => {
    const sample = generateRecoveryCodes(200).join("");
    for (const confusable of ["l", "i", "o", "0", "1"]) {
      assert.equal(sample.includes(confusable), false, `${confusable} should not appear`);
    }
  });
});
