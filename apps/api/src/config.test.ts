import { test } from "node:test";
import assert from "node:assert/strict";
import { productionProblems, rateLimiter } from "./config.ts";

const READY = {
  NODE_ENV: "production",
  STAFF_BASE: "https://pmp.av-rfpilot.com",
  PORTAL_BASE: "https://speakers.av-rfpilot.com",
  PGHOST: "postgres",
  PGPASSWORD: "x",
  FILE_STORAGE: "s3",
  S3_BUCKET: "pmp-files",
  CLAMAV_HOST: "clamav",
  MAIL_TRANSPORT: "ses",
  MAIL_FROM: "noreply@av-rfpilot.com",
  TRUST_PROXY: "1",
};

test("a complete production configuration has no problems", () => {
  assert.deepEqual(productionProblems(READY), []);
});

test("development needs nothing", () => {
  assert.deepEqual(productionProblems({}), []);
});

test("each unsafe production setting is named", () => {
  const problems = productionProblems({
    ...READY,
    PORTAL_BASE: "http://localhost:3001",
    FILE_STORAGE: "local",
    CLAMAV_HOST: "",
    TRUST_PROXY: "",
    DEV_MFA_SECRET: "GEZD",
  });
  for (const expected of [/PORTAL_BASE must be an https/, /FILE_STORAGE must be s3/, /CLAMAV_HOST/, /TRUST_PROXY/, /DEV_MFA_SECRET/]) {
    assert.ok(problems.some((problem) => expected.test(problem)), `${expected} in ${JSON.stringify(problems)}`);
  }
});

test("the rate limiter allows the limit, then refuses until the window passes", () => {
  const check = rateLimiter(3, 1000);
  const at = 1_000_000;
  assert.equal(check("1.2.3.4", at).allowed, true);
  assert.equal(check("1.2.3.4", at).allowed, true);
  assert.equal(check("1.2.3.4", at).allowed, true);
  const fourth = check("1.2.3.4", at + 10);
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.retryAfterSeconds, 1);
  assert.equal(check("5.6.7.8", at).allowed, true, "another address has its own count");
  assert.equal(check("1.2.3.4", at + 1001).allowed, true, "a new window starts over");
});
