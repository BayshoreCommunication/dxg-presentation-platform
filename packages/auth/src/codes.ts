import { randomBytes, createHash } from "node:crypto";

/**
 * Presenter access codes are read aloud, written on a badge, and typed on a
 * phone at 7am, so the alphabet excludes characters that get confused: 0/O,
 * 1/I/L, 5/S, 2/Z, 8/B. 3 groups of 4 from a 26-character alphabet is ~56 bits.
 */
const ALPHABET = "ACDEFGHJKMNPQRTUVWXY3467９".replace("９", "9");

export function generateAccessCode(groups = 3, size = 4): string {
  const needed = groups * size;
  const out: string[] = [];
  // Rejection sampling keeps every character equally likely; modulo alone would
  // quietly bias the alphabet.
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  while (out.length < needed) {
    for (const byte of randomBytes(needed)) {
      if (byte >= limit) continue;
      out.push(ALPHABET[byte % ALPHABET.length]!);
      if (out.length === needed) break;
    }
  }
  return Array.from({ length: groups }, (_, group) =>
    out.slice(group * size, group * size + size).join(""),
  ).join("-");
}

/** People type codes with stray spaces, lowercase, and the wrong dashes. */
export function normaliseCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s‐-―_]/g, "")
    .replace(/-/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

export const hashSecret = (secret: string): Buffer => createHash("sha256").update(secret).digest();

/** Session tokens are opaque and high-entropy; only their hash is stored. */
export const generateSessionToken = (): string => randomBytes(32).toString("base64url");

export type LockoutState = { locked: boolean; until: Date | null; remaining: number };

/**
 * Lockout after repeated failures, with a window that grows. Long enough to stop
 * online guessing, short enough that a technician who fat-fingered a password
 * twice is not locked out of a live event.
 */
export function lockoutFor(failedLogins: number, now: Date): Date | null {
  if (failedLogins < 5) return null;
  const minutes = Math.min(30, 2 ** (failedLogins - 5));
  return new Date(now.getTime() + minutes * 60_000);
}

export function lockoutState(lockedUntil: Date | null, failedLogins: number, now: Date): LockoutState {
  const locked = lockedUntil !== null && lockedUntil > now;
  return {
    locked,
    until: locked ? lockedUntil : null,
    remaining: Math.max(0, 5 - failedLogins),
  };
}
