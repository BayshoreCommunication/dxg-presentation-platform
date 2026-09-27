import { test } from "node:test";
import assert from "node:assert/strict";
import { ClamdScanner, DevSignatureScanner, scannerFromEnv } from "./scanner.ts";

/**
 * clamd, for real, when CLAMAV_TEST_HOST points at one (`docker compose up clamav`);
 * skipped otherwise. The EICAR string is the industry's harmless test signature.
 */
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const host = process.env.CLAMAV_TEST_HOST;

test("clamd finds the test signature and passes a clean file", { skip: !host && "CLAMAV_TEST_HOST not set" }, async () => {
  const scanner = new ClamdScanner(host!, 3310);
  assert.deepEqual(await scanner.scan(Buffer.from("an ordinary presentation")), { verdict: "clean" });
  const infected = await scanner.scan(Buffer.from(EICAR));
  assert.equal(infected.verdict, "infected");
  assert.match(infected.signature ?? "", /Eicar/i);
});

test("an unreachable clamd fails closed", async () => {
  const result = await new ClamdScanner("127.0.0.1", 1, 2000).scan(Buffer.from("x"));
  assert.equal(result.verdict, "error");
});

test("production refuses to start without ClamAV", () => {
  assert.throws(() => scannerFromEnv({ NODE_ENV: "production" }), /CLAMAV_HOST/);
  assert.ok(scannerFromEnv({}) instanceof DevSignatureScanner);
  assert.ok(scannerFromEnv({ CLAMAV_HOST: "clamav" }) instanceof ClamdScanner);
});
