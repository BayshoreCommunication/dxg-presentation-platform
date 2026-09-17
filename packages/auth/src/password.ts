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
 */
const COMMON = new Set([
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

export function checkPassword(password: string): PasswordProblem | null {
  const value = password.normalize("NFKC");
  if (value.length < 12) {
    return { code: "too_short", message: "Use at least 12 characters — length matters more than symbols." };
  }
  if (value.length > 200) {
    return { code: "too_long", message: "That password is longer than 200 characters." };
  }
  if (COMMON.has(value.toLowerCase())) {
    return { code: "too_common", message: "That password is too common. Pick something unique to you." };
  }
  return null;
}
