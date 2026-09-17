import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238) over HMAC-SHA1 — what every authenticator app implements.
 * Written against the standard library so enabling MFA adds no dependency and
 * no third party ever sees a secret.
 */
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/[=\s-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of cleaned) {
    const index = BASE32.indexOf(character);
    if (index < 0) throw new Error(`"${character}" is not valid base32`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A 160-bit secret, matching the SHA-1 block the algorithm uses. */
export const generateTotpSecret = (): string => base32Encode(randomBytes(20));

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export const totp = (secret: string, atMs = Date.now(), step = 30, digits = 6): string =>
  hotp(base32Decode(secret), Math.floor(atMs / 1000 / step), digits);

/**
 * Accepts the neighbouring steps as well, because phone clocks drift and people
 * type slowly. One step either side is the usual compromise — wider would mean
 * a stolen code stays usable for longer.
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: { atMs?: number; window?: number; step?: number; digits?: number } = {},
): { valid: boolean; counter?: number } {
  const { atMs = Date.now(), window = 1, step = 30, digits = 6 } = options;
  const cleaned = code.replace(/\s/g, "");
  if (!new RegExp(`^\\d{${digits}}$`).test(cleaned)) return { valid: false };

  const key = base32Decode(secret);
  const current = Math.floor(atMs / 1000 / step);
  for (let drift = -window; drift <= window; drift += 1) {
    const candidate = hotp(key, current + drift, digits);
    const a = Buffer.from(candidate);
    const b = Buffer.from(cleaned);
    if (a.length === b.length && timingSafeEqual(a, b)) return { valid: true, counter: current + drift };
  }
  return { valid: false };
}

/** The URI an authenticator app reads; also printable for manual entry. */
export function otpauthUri(input: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Secrets are read off a screen and typed; grouping makes that bearable. */
export const groupSecret = (secret: string): string => (secret.match(/.{1,4}/g) ?? []).join(" ");

/**
 * Recovery codes for the phone that was lost, broken or wiped. Single use,
 * stored hashed, and the only way back in without an administrator.
 */
export function generateRecoveryCodes(count = 10): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: count }, () => {
    const raw = randomBytes(10);
    const characters = Array.from(raw, (byte) => alphabet[byte % alphabet.length]).join("");
    return `${characters.slice(0, 5)}-${characters.slice(5, 10)}`;
  });
}

export const normaliseRecoveryCode = (code: string): string =>
  code.toLowerCase().replace(/[\s-]/g, "");
