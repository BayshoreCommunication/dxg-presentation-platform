import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { verifyAddress, clearDomainCache } from "./verify.ts";

/** A DNS stand-in: each domain answers as told; anything unknown does not exist. */
const fakeDns = (records: Record<string, { mx?: string[]; a?: string[]; fail?: string }>) => {
  const answer = (domain: string, kind: "mx" | "a") => {
    const entry = records[domain];
    if (entry?.fail) return Promise.reject(Object.assign(new Error(entry.fail), { code: entry.fail }));
    const found = kind === "mx" ? entry?.mx : entry?.a;
    if (!found || found.length === 0) return Promise.reject(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));
    return Promise.resolve(found);
  };
  return {
    resolveMx: (domain: string) =>
      answer(domain, "mx").then((list) => (list as string[]).map((exchange, priority) => ({ exchange, priority }))),
    resolve4: (domain: string) => answer(domain, "a") as Promise<string[]>,
    resolve6: () => Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" })),
  };
};

beforeEach(() => clearDomainCache());

test("a domain with mail servers is accepted", async () => {
  const verdict = await verifyAddress("jane@company.com", fakeDns({ "company.com": { mx: ["mx.company.com"] } }));
  assert.deepEqual(verdict, { ok: true, address: "jane@company.com" });
});

test("a domain with no MX but an address still takes mail (RFC 5321 fallback)", async () => {
  const verdict = await verifyAddress("jane@small.org", fakeDns({ "small.org": { a: ["192.0.2.1"] } }));
  assert.equal(verdict.ok, true);
});

test("a domain that does not exist is refused", async () => {
  const verdict = await verifyAddress("jane@no-such-domain-xyz.com", fakeDns({}));
  assert.equal(verdict.ok, false);
  if (!verdict.ok) assert.match(verdict.reason, /does not accept email/);
});

test("a null MX (RFC 7505) is refused", async () => {
  const verdict = await verifyAddress("jane@nomail.com", fakeDns({ "nomail.com": { mx: ["."] } }));
  assert.equal(verdict.ok, false);
});

test("DNS failing lets the address through, marked unverified", async () => {
  const verdict = await verifyAddress("jane@slow.com", fakeDns({ "slow.com": { fail: "ETIMEOUT" } }));
  assert.deepEqual(verdict, { ok: true, address: "jane@slow.com", unverified: true });
});

test("syntax and typos are refused before any lookup", async () => {
  const neverCalled = fakeDns({});
  const typo = await verifyAddress("jane@gmial.com", neverCalled);
  assert.equal(typo.ok, false);
  if (!typo.ok) assert.equal(typo.suggestion, "jane@gmail.com");
  assert.equal((await verifyAddress("not an address", neverCalled)).ok, false);
});

test("reserved test domains are never looked up", async () => {
  const verdict = await verifyAddress("probe@example.invalid", {
    resolveMx: () => Promise.reject(new Error("should not be called")),
    resolve4: () => Promise.reject(new Error("should not be called")),
    resolve6: () => Promise.reject(new Error("should not be called")),
  });
  assert.equal(verdict.ok, true);
});
