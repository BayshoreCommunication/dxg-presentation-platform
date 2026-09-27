import { promises as dns } from "node:dns";
import { checkAddress } from "./validate.ts";
import { isReservedAddress } from "./index.ts";

/**
 * Whether an address can receive mail (D-097) — checked where it is typed, and again by the
 * dispatcher before every send.
 *
 * Syntax and known typos first (`checkAddress`), then the domain's mail servers in DNS:
 * a domain with no MX record — and no A/AAAA record to fall back on (RFC 5321 §5.1) —
 * or with a "null MX" (RFC 7505) refuses all mail, so every message to it would bounce.
 *
 * DNS failing is not the address failing: a timeout or no network lets the address
 * through (`unverified`) rather than blocking someone's work, and the send-time guard
 * and bounce suppression still stand behind it. Reserved test domains (`.invalid` and
 * friends) are never looked up — nothing sends to them (D-090).
 */
export type AddressVerdict =
  | { ok: true; address: string; unverified?: boolean }
  | { ok: false; reason: string; suggestion?: string };

type Resolver = {
  resolveMx(domain: string): Promise<{ exchange: string; priority: number }[]>;
  resolve4(domain: string): Promise<string[]>;
  resolve6(domain: string): Promise<string[]>;
};

const TIMEOUT_MS = 3000;
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; accepts: boolean | null }>();

const NO_DOMAIN = new Set(["ENOTFOUND", "ENODATA", "ENOTIMP", "EREFUSED_NXDOMAIN"]);

const withTimeout = <T>(work: Promise<T>): Promise<T> =>
  Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), TIMEOUT_MS)),
  ]);

/** true: takes mail. false: provably does not. null: could not tell. */
async function domainAcceptsMail(domain: string, resolver: Resolver): Promise<boolean | null> {
  try {
    const mx = await withTimeout(resolver.resolveMx(domain));
    if (mx.length > 0) {
      // A single "." exchange is a null MX: the domain states it takes no mail.
      return !(mx.length === 1 && (mx[0]!.exchange === "" || mx[0]!.exchange === "."));
    }
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    if (!NO_DOMAIN.has(code)) return null;
  }
  // No MX: mail falls back to the domain's own address, if it has one.
  for (const lookup of [resolver.resolve4, resolver.resolve6]) {
    try {
      if ((await withTimeout(lookup.call(resolver, domain))).length > 0) return true;
    } catch (error) {
      const code = (error as { code?: string }).code ?? "";
      if (!NO_DOMAIN.has(code)) return null;
    }
  }
  return false;
}

export async function verifyAddress(raw: string, resolver: Resolver = dns): Promise<AddressVerdict> {
  const syntax = checkAddress(raw);
  if (!syntax.ok) return syntax;
  if (isReservedAddress(syntax.address) || process.env.EMAIL_DNS_CHECK === "0") {
    return { ok: true, address: syntax.address };
  }

  const cached = cache.get(syntax.domain);
  let accepts: boolean | null;
  if (cached && Date.now() - cached.at < CACHE_MS) {
    accepts = cached.accepts;
  } else {
    accepts = await domainAcceptsMail(syntax.domain, resolver);
    // "Could not tell" is not cached: the next attempt may reach DNS.
    if (accepts !== null) cache.set(syntax.domain, { at: Date.now(), accepts });
  }

  if (accepts === false) {
    return { ok: false, reason: `${syntax.domain} does not accept email — check the address for a typo.` };
  }
  return accepts === null ? { ok: true, address: syntax.address, unverified: true } : { ok: true, address: syntax.address };
}

/** For tests: forget cached domains. */
export const clearDomainCache = () => cache.clear();
