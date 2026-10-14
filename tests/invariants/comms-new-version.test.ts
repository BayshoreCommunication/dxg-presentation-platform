import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { withSystemScope } from "@pmp/db";
import { signInStaff } from "../helpers/signIn.ts";

/**
 * D-178: a second seeded reminder, "Reminder — new version needed", for speakers who have
 * uploaded but must send another file — asked for changes, or the file failed the virus check.
 * Its audience is those speakers only; the missing-file reminder keeps its own. A practice event
 * (D-116) carries both kinds of speaker, and its mail is recorded but never sent.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";

let up = false;
let admin = "";
let eventId = "";

type Recipient = { speaker_id: string; name: string };
type Comms = { templates: { id: string; name: string }[]; missing: Recipient[]; new_version: Recipient[] };
const json = (cookie: string) => ({ "content-type": "application/json", cookie });

const comms = async (): Promise<Comms> =>
  (await (await fetch(`${API}/events/${eventId}/comms`, { headers: json(admin) })).json()) as Comms;
const sentTo = async (since: Date): Promise<string[]> =>
  withSystemScope(async (tx) =>
    (await tx.query<{ speaker_id: string }>(
      `SELECT speaker_id FROM pmp.communications WHERE event_id = $1 AND created_at >= $2`,
      [eventId, since],
    )).rows.map((row) => row.speaker_id),
  );

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);
  eventId = ((await (await fetch(`${API}/practice-events`, { method: "POST", headers: json(admin) })).json()) as {
    event_id: string;
  }).event_id;
});

after(async () => {
  if (up && eventId) await fetch(`${API}/events/${eventId}/archive`, { method: "POST", headers: json(admin) });
});

describe('"Reminder — new version needed" (D-178)', () => {
  test("a new event gets it beside the missing-file reminder", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const names = (await comms()).templates.map((template) => template.name);
    assert.ok(names.includes("Reminder — file still missing"));
    assert.ok(names.includes("Reminder — new version needed"));
  });

  test("its audience is the speakers asked for a new file — not those missing one", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const data = await comms();
    // The practice event: Marcus Lindqvist was asked for changes; Hannah Becker and Kenji Watanabe
    // have nothing uploaded.
    assert.deepEqual(data.new_version.map((row) => row.name), ["Marcus Lindqvist"]);
    assert.ok(data.missing.every((row) => row.name !== "Marcus Lindqvist"));
  });

  test("sent, it reaches them only; the missing-file reminder still goes to the others", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const data = await comms();
    const newVersion = data.templates.find((template) => template.name === "Reminder — new version needed")!;
    const missing = data.templates.find((template) => template.name === "Reminder — file still missing")!;
    const marcus = data.new_version[0]!.speaker_id;

    const since = new Date();
    const sent = (await (
      await fetch(`${API}/events/${eventId}/comms/send`, {
        method: "POST",
        headers: json(admin),
        body: JSON.stringify({ template_id: newVersion.id, audience: "new_version" }),
      })
    ).json()) as { queued: number };
    assert.equal(sent.queued, 1);
    assert.deepEqual(await sentTo(since), [marcus]);

    const later = new Date();
    await fetch(`${API}/events/${eventId}/comms/send`, {
      method: "POST",
      headers: json(admin),
      body: JSON.stringify({ template_id: missing.id, missing_only: true }),
    });
    const chased = await sentTo(later);
    assert.equal(chased.length, data.missing.length);
    assert.ok(!chased.includes(marcus), "the missing-file reminder doesn't go to a speaker who has uploaded");
  });
});
