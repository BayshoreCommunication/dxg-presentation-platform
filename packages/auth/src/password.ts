import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";

const scrypt = (password: string | Buffer, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derived) =>
      error ? reject(error) : resolve(derived),
    );
  });

/**
 * Password hashing with scrypt from the Node standard library — memory-hard,
 * no dependency, and the parameters are stored with the hash so they can be
 * raised later without invalidating existing passwords.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 32 } as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: 256 * 1024 * 1024,
  });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

/** Constant-time comparison; a malformed stored hash is a failure, never a pass. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, salt, digest] = parts;
  const expected = Buffer.from(digest!, "base64");
  try {
    const derived = await scrypt(password.normalize("NFKC"), Buffer.from(salt!, "base64"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 256 * 1024 * 1024,
    });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export type PasswordProblem =
  | { code: "too_short"; message: string }
  | { code: "too_long"; message: string }
  | { code: "too_common"; message: string };

/**
 * Length first, dictionary second — NIST's guidance rather than character-class
 * rules, which push people towards "Passw0rd!" and nothing better.
 *
 * The short entries matter more than they look. The minimum was 12 when this list
 * was written, so nothing below that length could ever reach it; at 6 (Travis's
 * call, 2026-09-20) the most-guessed passwords in every breach corpus — `123456`,
 * `qwerty`, `abc123` — are suddenly long enough to pass the length rule, and this
 * list is the only thing that stops them. Lowering the floor without widening the
 * dictionary would have been the worst of both.
 */
const COMMON = new Set([
  // Short and overwhelmingly common — reachable only since the minimum became 6.
  "123456",
  "654321",
  "111111",
  "000000",
  "121212",
  "abc123",
  "qwerty",
  "qwerty1",
  "azerty",
  "monkey",
  "dragon",
  "master",
  "shadow",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "superman",
  "trustno1",
  "letmein",
  "secret",
  "access",
  "admin1",
  "login1",
  "welcome",
  "iloveu",
  "passwd",
  "pass123",
  "test123",
  "dxg123",
  "password",
  "password1",
  "password123",
  "12345678",
  "123456789",
  "qwertyuiop",
  "letmein1",
  "welcome1",
  "iloveyou",
  "changeme",
  "dxgpassword",
  "presentation",
]);

/**
 * Set to 6 on 2026-09-20 at Travis's request, down from 12.
 *
 * Six is below the 8 that NIST SP 800-63B gives as a floor for user-chosen secrets,
 * and these are staff accounts that can see and change every speaker's material for
 * an entire event. Two things carry the weight that length no longer does: TOTP is
 * enforced for every staff account with no development bypass (D-017), so a guessed
 * password alone yields a five-minute challenge and nothing else; and sign-in locks
 * after five failed attempts with a growing window, which makes online guessing
 * expensive. Raising it later is this one number.
 */
export const MINIMUM_LENGTH = 6;

export function checkPassword(password: string): PasswordProblem | null {
  const value = password.normalize("NFKC");
  if (value.length < MINIMUM_LENGTH) {
    return {
      code: "too_short",
      message: `Use at least ${MINIMUM_LENGTH} characters — length matters more than symbols.`,
    };
  }
  if (value.length > 200) {
    return { code: "too_long", message: "That password is longer than 200 characters." };
  }
  if (COMMON.has(value.toLowerCase())) {
    return { code: "too_common", message: "That password is too common. Pick something unique to you." };
  }
  return null;
}
