import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff, cookieFrom } from "../helpers/signIn.ts";

/**
 * The 2026-10-05 review's security findings, each held shut.
 *
 * - `/api/V1/…` reached every handler with the staff gate, event resolver and rate
 *   limits skipped, because routes matched case-insensitively and those checks did not.
 * - An id without dashes (or in braces) is one Postgres accepts but the event resolver
 *   did not recognise, so it was passed through unresolved and unscoped.
 * - An encoded slash in an upload id reached the file system as a path.
 * - Finishing an upload never re-checked the talk, so a speaker could add a version to
 *   anyone's talk — any event's, or one locked as final.
 * - Any staff role could mint a speaker's sign-in link, and merge speakers into a speaker
 *   on another event.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const ROOT = API.replace("/api/v1", "");
const PASSWORD = "dxg-development-password";
const MEDTECH = "22222222-2222-4222-8222-222222222222";

let up = false;
let admin = "";
let reviewer = "";

type Speaker = { id: string; email: string | null; slot: string };
const speakers: Record<string, Speaker> = {};

const json = (cookie: string) => ({ "content-type": "application/json", cookie });
const post = (path: string, body: unknown, cookie: string) =>
  fetch(`${API}${path}`, { method: "POST", headers: json(cookie), body: JSON.stringify(body) });
const dashless = (id: string) => id.replace(/-/g, "");

before(async () => {
  try {
    up = (await fetch(`${ROOT}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);
  reviewer = await signInStaff(API, "c.delgado@example.invalid", PASSWORD);
  const agenda = (await (await fetch(`${API}/events/${MEDTECH}/agenda`, { headers: { cookie: admin } })).json()) as {
    items: { presentations: { slot_id: string; speakers: { id: string; name: string }[] }[] }[];
  };
  const list = (await (await fetch(`${API}/events/${MEDTECH}/speakers`, { headers: { cookie: admin } })).json()) as {
    items: { id: string; email: string | null }[];
  };
  for (const session of agenda.items) {
    for (const talk of session.presentations) {
      for (const person of talk.speakers) {
        const email = list.items.find((row) => row.id === person.id)?.email ?? null;
        speakers[person.name] = { id: person.id, email, slot: talk.slot_id };
      }
    }
  }
});

describe("a path means exactly what it says", () => {
  test("the API's prefix in another case is not a route", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await fetch(`${ROOT}/api/v1/timezones`)).status, 401, "the real path still asks for a session");
    assert.equal((await fetch(`${ROOT}/api/V1/timezones`)).status, 404, "no gate-free twin");
  });

  test("a route segment in another case is not a route either", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const slot = Object.values(speakers)[0]!.slot;
    assert.equal((await fetch(`${API}/slots/${slot}`, { headers: { cookie: admin } })).status, 200, "fixture: the real path works");
    assert.equal((await fetch(`${ROOT}/api/v1/Slots/${slot}`, { headers: { cookie: admin } })).status, 404);
  });

  test("an id is only an id in its dashed form", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const slot = Object.values(speakers)[0]!.slot;
    assert.equal((await fetch(`${API}/slots/${dashless(slot)}`, { headers: { cookie: admin } })).status, 404, "no dashes");
    assert.equal((await fetch(`${API}/slots/%7B${slot}%7D`, { headers: { cookie: admin } })).status, 404, "in braces");
  });

  test("an encoded slash never reaches a handler", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const response = await fetch(`${API}/portal/uploads/..%2F..%2Flibrary/parts/1`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", cookie: admin },
      body: Buffer.from("x"),
    });
    assert.equal(response.status, 400);
  });
});

describe("a speaker uploads only to their own talk", () => {
  test("finishing an upload on someone else's talk is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const [me, other] = Object.values(speakers).filter((person) => person.email);
    assert.ok(me && other && me.slot !== other.slot, "fixture: two speakers on different talks");
    const { access_code } = (await (await post(`/speakers/${me.id}/credentials`, {}, admin)).json()) as { access_code: string };
    const login = await post("/portal/login", { email: me.email, code: access_code }, "");
    assert.equal(login.status, 200, "fixture: the speaker signs in");
    const presenter = cookieFrom(login);

    const body = Buffer.from("PK not really a deck");
    const started = await post("/portal/uploads", { slot_id: me.slot, file_name: "deck.pptx", total_bytes: body.length }, presenter);
    assert.equal(started.status, 201, "starting on their own talk is fine");
    const { upload_id } = (await started.json()) as { upload_id: string };
    await fetch(`${API}/portal/uploads/${upload_id}/parts/1`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream", cookie: presenter },
      body,
    });

    const response = await post(`/portal/uploads/${upload_id}/complete`, { slot_id: other.slot, file_name: "deck.pptx" }, presenter);
    assert.equal(response.status, 422);
    assert.equal(((await response.json()) as { code: string }).code, "portal.not_your_talk");
  });
});

describe("staff can only do what their role allows", () => {
  test("a content reviewer cannot mint a speaker's sign-in link", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const someone = Object.values(speakers)[0]!;
    const refused = await post(`/speakers/${someone.id}/invite`, {}, reviewer);
    assert.equal(refused.status, 403);
    assert.equal((await post(`/speakers/${someone.id}/invite`, {}, admin)).status, 201, "an admin still can");
  });

  test("a content reviewer cannot merge speakers", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const [a, b] = Object.values(speakers);
    const response = await post(`/speakers/${a!.id}/merge`, { into: b!.id }, reviewer);
    assert.equal(response.status, 403);
  });

  test("a merge into a speaker who is not on this event is refused", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const someone = Object.values(speakers)[0]!;
    const nobody = "00000000-0000-4000-8000-000000000000";
    assert.equal((await post(`/speakers/${someone.id}/merge`, { into: nobody }, admin)).status, 404);
    assert.equal((await post(`/speakers/${someone.id}/merge`, { into: dashless(nobody) }, admin)).status, 404);
  });
});
