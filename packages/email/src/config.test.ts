import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sesConfigFromEnv } from "./index.ts";

const KEYS = ["AWS_REGION", "SES_REGION", "MAIL_FROM", "SES_CONFIGURATION_SET", "MAIL_REPLY_TO"];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("sesConfigFromEnv", () => {
  test("refuses to start without a region", () => {
    process.env.MAIL_FROM = "noreply@av-rfpilot.com";
    assert.throws(() => sesConfigFromEnv(), /AWS_REGION/);
  });

  test("refuses to start without a from address", () => {
    process.env.AWS_REGION = "us-east-2";
    assert.throws(() => sesConfigFromEnv(), /MAIL_FROM/);
  });

  test("names every missing variable at once, not just the first", () => {
    assert.throws(() => sesConfigFromEnv(), (e: Error) => /AWS_REGION/.test(e.message) && /MAIL_FROM/.test(e.message));
  });

  test("SES_REGION substitutes for AWS_REGION", () => {
    process.env.SES_REGION = "eu-west-1";
    process.env.MAIL_FROM = "noreply@av-rfpilot.com";
    assert.equal(sesConfigFromEnv().region, "eu-west-1");
  });

  // The From domain is a vendor domain shared with RFPilot, so a speaker replying
  // must reach a real mailbox rather than noreply@. Losing this silently would send
  // every reply into the void, which is exactly the kind of failure nobody notices.
  test("carries MAIL_REPLY_TO through to the config", () => {
    process.env.AWS_REGION = "us-east-2";
    process.env.MAIL_FROM = "noreply@av-rfpilot.com";
    process.env.MAIL_REPLY_TO = "dxgrfptool@gmail.com";
    assert.equal(sesConfigFromEnv().replyTo, "dxgrfptool@gmail.com");
  });

  test("leaves replyTo undefined when unset, rather than empty-string", () => {
    process.env.AWS_REGION = "us-east-2";
    process.env.MAIL_FROM = "noreply@av-rfpilot.com";
    assert.equal(sesConfigFromEnv().replyTo, undefined);
  });
});
