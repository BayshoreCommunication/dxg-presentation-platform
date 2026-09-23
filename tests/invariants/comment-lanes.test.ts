import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { getOwnerPool, closePool } from "@pmp/db";
import { signInStaff, cookieFrom } from "../helpers/signIn.ts";

/**
 * Comment audiences are enforced where the reader is, not trusted to the screen
 * (FR-REV-003, SCREEN_SPECS §8, D-070). A reviewer writes internal, client-lane and
 * speaker notes on the same file; the speaker's portal returns the speaker note and
 * nothing else, while staff see all three with the version each was left on.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const EVENT = "22222222-2222-4222-8222-222222222222";
const PASSWORD = "dxg-development-password";
const MARK = `lane-probe-${Date.now()}`;

let up = false;
let staff = "";
let versionId = "";
let speakerId = "";
let speakerEmail = "";

const json = (cookie: string) => ({ "content-type": "application/json", cookie });

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  staff = await signInStaff(API, "admin@example.invalid", PASSWORD);

  // A submitted file on the seeded event, and the speaker who gives that talk.
  const { rows } = await getOwnerPool().query<{ version_id: string; speaker_id: string; email: string }>(
    `SELECT fv.id AS version_id, sp.id AS speaker_id, sp.email::text AS email
       FROM pmp.file_versions fv
       JOIN pmp.files f ON f.id = fv.file_id
       JOIN pmp.speaker_assignments sa ON sa.slot_id = f.slot_id
       JOIN pmp.speakers sp ON sp.id = sa.speaker_id
      WHERE fv.event_id = $1 AND sp.email IS NOT NULL
      ORDER BY fv.created_at DESC LIMIT 1`,
    [EVENT],
  );
  versionId = rows[0]?.version_id ?? "";
  speakerId = rows[0]?.speaker_id ?? "";
  speakerEmail = rows[0]?.email ?? "";

  for (const lane of ["internal", "client_visible", "speaker_visible"]) {
    const response = await fetch(`${API}/file-versions/${versionId}/comments`, {
      method: "POST",
      headers: json(staff),
      body: JSON.stringify({ lane, body: `${MARK} ${lane}` }),
    });
    assert.equal(response.status, 201, `a ${lane} comment is accepted`);
  }
});

after(async () => {
  if (!up) return closePool();
  // Test notes on the seeded event would read as real ones on the review screen.
  await getOwnerPool().query(`DELETE FROM pmp.comments WHERE body LIKE $1`, [`${MARK}%`]);
  // An open pool keeps this file's process alive and held the whole suite ~70 s.
  await closePool();
});

describe("comment audiences", () => {
  test("staff see every lane, with the version each note was left on", async (t: TestContext) => {
    if (!up || !versionId) return t.skip("API not running");
    const { items } = (await (
      await fetch(`${API}/file-versions/${versionId}/comments`, { headers: { cookie: staff } })
    ).json()) as { items: { lane: string; body: string; version_number: number }[] };
    const mine = items.filter((item) => item.body.startsWith(MARK));
    assert.deepEqual(mine.map((item) => item.lane).sort(), ["client_visible", "internal", "speaker_visible"]);
    for (const item of mine) assert.equal(typeof item.version_number, "number");
  });

  test("the speaker's portal returns the speaker note and nothing else", async (t: TestContext) => {
    if (!up || !speakerId) return t.skip("API not running");
    const { access_code } = (await (
      await fetch(`${API}/speakers/${speakerId}/credentials`, { method: "POST", headers: { cookie: staff } })
    ).json()) as { access_code: string };
    const login = await fetch(`${API}/portal/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: speakerEmail, code: access_code }),
    });
    assert.equal(login.status, 200);
    const presenter = cookieFrom(login);

    const { items } = (await (await fetch(`${API}/portal/talks`, { headers: { cookie: presenter } })).json()) as {
      items: { feedback: { body: string }[] }[];
    };
    const seen = items.flatMap((talk) => talk.feedback.map((note) => note.body)).filter((body) => body.startsWith(MARK));
    assert.deepEqual(seen, [`${MARK} speaker_visible`], "internal and client-lane notes never reach a speaker");
  });

  test("an empty comment is refused", async (t: TestContext) => {
    if (!up || !versionId) return t.skip("API not running");
    const response = await fetch(`${API}/file-versions/${versionId}/comments`, {
      method: "POST",
      headers: json(staff),
      body: JSON.stringify({ lane: "internal", body: "   " }),
    });
    assert.equal(response.status, 400);
  });
});
