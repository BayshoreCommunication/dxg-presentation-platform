import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";

/**
 * A presenter has two kinds of credential and both have to work.
 *
 * An **access code** is read off a screen and typed, so it is stored normalised —
 * `normaliseCode` folds case, drops the grouping dashes and repairs the characters
 * people confuse: O for 0, I and L for 1. A **magic-link token** is a UUID nobody
 * types; the invitation and reminder mails carry it in the URL and it is stored
 * exactly as minted.
 *
 * `presenterLogin` looked up only the normalised form, so a magic link could never
 * work: the UUID was uppercased, its dashes stripped and every O and I rewritten
 * before hashing, giving something the row had never held. Following the link
 * pre-filled the code and the portal then said the code was wrong — the worst shape
 * of bug, because the speaker has no reason to doubt a link they were sent.
 *
 * These pin both credentials and the refusal, because a fix that accepts everything
 * would pass the first two on its own.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const EVENT = "22222222-2222-4222-8222-222222222222";
const PASSWORD = "dxg-development-password";

let up = false;
let staff = "";
let speakerId = "";
let speakerEmail = "";

const login = (email: string, code: string) =>
  fetch(`${API}/portal/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code }),
  });

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  staff = await signInStaff(API, "admin@example.invalid", PASSWORD);

  const speakers = (await (
    await fetch(`${API}/events/${EVENT}/speakers`, { headers: { cookie: staff } })
  ).json()) as { items: { id: string; email: string | null }[] };
  const speaker = speakers.items.find((candidate) => candidate.email);
  speakerId = speaker?.id ?? "";
  speakerEmail = speaker?.email ?? "";
});

describe("a presenter can sign in with either credential", () => {
  /*
   * Issued first and used last, because issuing a credential revokes the ones before
   * it — so each test mints its own rather than sharing one and racing the revocation.
   */
  const issueCode = async (): Promise<string> =>
    (
      (await (
        await fetch(`${API}/speakers/${speakerId}/credentials`, {
          method: "POST",
          headers: { cookie: staff },
        })
      ).json()) as { access_code: string }
    ).access_code;

  const issueLink = async (): Promise<string> =>
    (
      (await (
        await fetch(`${API}/speakers/${speakerId}/invite`, {
          method: "POST",
          headers: { cookie: staff, "content-type": "application/json" },
          body: "{}",
        })
      ).json()) as { token: string }
    ).token;

  test("the magic-link token from an invitation works", async (t: TestContext) => {
    if (!up || !speakerId) return t.skip("API not running");
    const token = await issueLink();
    // A UUID: the thing `normaliseCode` mangles.
    assert.match(token, /^[0-9a-f-]{36}$/);
    const response = await login(speakerEmail, token);
    assert.equal(response.status, 200, "a link that was emailed to a speaker must sign them in");
    const body = (await response.json()) as { principal: { kind: string } };
    assert.equal(body.principal.kind, "presenter");
  });

  test("an access code typed exactly works", async (t: TestContext) => {
    if (!up || !speakerId) return t.skip("API not running");
    const code = await issueCode();
    assert.equal((await login(speakerEmail, code)).status, 200);
  });

  /*
   * The reason access codes are normalised at all: they are read off a screen and
   * typed, so the grouping dashes and the case are not part of the secret.
   */
  test("an access code typed sloppily still works", async (t: TestContext) => {
    if (!up || !speakerId) return t.skip("API not running");
    const code = await issueCode();
    const sloppy = code.toLowerCase().replace(/-/g, "");
    assert.equal((await login(speakerEmail, sloppy)).status, 200);
  });

  test("a code that is neither is still refused", async (t: TestContext) => {
    if (!up || !speakerId) return t.skip("API not running");
    const response = await login(speakerEmail, "AAAA-BBBB-CCCC");
    assert.equal(response.status, 401);
    assert.equal(((await response.json()) as { code: string }).code, "auth.invalid_credentials");
  });

  test("someone else's credential does not sign this speaker in", async (t: TestContext) => {
    if (!up || !speakerId) return t.skip("API not running");
    const token = await issueLink();
    // The token is real; the address is not the one it was issued to.
    const response = await login("nobody@example.invalid", token);
    assert.equal(response.status, 401);
  });
});
