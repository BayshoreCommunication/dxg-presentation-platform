import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { removeTestAccounts } from "../helpers/cleanup.ts";
import { withSystemScope } from "@pmp/db";

/**
 * D-177: "Get the file" on the event overview opens the reminder for one speaker, and its send
 * names that speaker (`speaker_ids`). It must reach that speaker and nobody else — the plain
 * reminder goes to everyone still missing a file — and a speaker asked for changes (who has a
 * file, so isn't "missing") can be reminded on their own.
 *
 * The probe is reused, not recreated, for the reason comms-cadence gives: an event that has
 * sent mail can't be deleted (`communication_events` is append-only), so it is archived after
 * and restored before.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const EVENT_NAME = "Comms One Speaker Probe";
const AGENDA = [
  "Session Title,Session Location,Session Date,Session Start,Session End,Presenter 1 Email,Presenter 1 First Name,Presenter 1 Last Name",
  "One Speaker Talk A,Ballroom A,03/15/2027,9:00 AM,10:00 AM,onespeaker.a@example.invalid,Alpha,Probe",
  "One Speaker Talk B,Ballroom A,03/15/2027,10:00 AM,11:00 AM,onespeaker.b@example.invalid,Bravo,Probe",
].join("\n");

let up = false;
let admin = "";
let eventId = "";
let reminderTemplate = "";
let alpha = "";
let bravo = "";

const json = (cookie: string) => ({ "content-type": "application/json", cookie });
type SendResult = { queued: number; skipped: { reason: string; count: number }[] };

const send = async (body: Record<string, unknown>): Promise<SendResult> =>
  (await (
    await fetch(`${API}/events/${eventId}/comms/send`, { method: "POST", headers: json(admin), body: JSON.stringify(body) })
  ).json()) as SendResult;

/** Emails written for each speaker since `since`. */
const sentTo = async (since: Date): Promise<string[]> =>
  withSystemScope(async (tx) => {
    const { rows } = await tx.query<{ speaker_id: string }>(
      `SELECT speaker_id FROM pmp.communications WHERE event_id = $1 AND created_at >= $2 ORDER BY created_at`,
      [eventId, since],
    );
    return rows.map((row) => row.speaker_id);
  });

/** Ages every send past the cooldown — what waiting a day looks like. */
const ageSends = async (hours: number): Promise<void> => {
  await withSystemScope((tx) =>
    tx.query(`UPDATE pmp.communications SET created_at = created_at - make_interval(hours => $2) WHERE event_id = $1`, [
      eventId,
      hours,
    ]),
  );
};

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);

  const existing = (await (await fetch(`${API}/events`, { headers: json(admin) })).json()) as {
    items?: { id: string; name: string; status: string }[];
  };
  const probe = existing.items?.find((candidate) => candidate.name === EVENT_NAME);
  eventId = probe?.id ?? "";
  if (probe?.status === "archived") {
    const restored = await fetch(`${API}/events/${eventId}/restore`, { method: "POST", headers: json(admin) });
    assert.equal(restored.status, 200, "the archived probe is restored before it is reused");
  }
  if (!eventId) {
    eventId = ((await (
      await fetch(`${API}/events`, {
        method: "POST",
        headers: json(admin),
        body: JSON.stringify({
          client_id: "11111111-1111-4111-8111-111111111111",
          name: EVENT_NAME,
          venue: "Tampa",
          timezone: "America/New_York",
          starts_on: "2027-03-15",
          ends_on: "2027-03-15",
        }),
      })
    ).json()) as { event_id: string }).event_id;
    const preview = (await (
      await fetch(`${API}/events/${eventId}/imports`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "x-file-name": "agenda.csv", cookie: admin },
        body: Buffer.from(AGENDA, "utf8"),
      })
    ).json()) as { upload_id: string; rows: unknown[] };
    await fetch(`${API}/imports/${preview.upload_id}/commit`, {
      method: "POST",
      headers: json(admin),
      body: JSON.stringify({ rows: preview.rows }),
    });
  }

  const comms = (await (await fetch(`${API}/events/${eventId}/comms`, { headers: json(admin) })).json()) as {
    templates: { id: string; name: string }[];
    missing: { speaker_id: string; name: string }[];
  };
  reminderTemplate = comms.templates.find((t) => /reminder/i.test(t.name))!.id;
  alpha = comms.missing.find((row) => row.name.startsWith("Alpha"))!.speaker_id;
  bravo = comms.missing.find((row) => row.name.startsWith("Bravo"))!.speaker_id;
  // Start as a new event would: nobody recently emailed.
  await ageSends(48);
});

after(async () => {
  if (!up) return;
  await removeTestAccounts(["onespeaker."]);
  await withSystemScope((tx) => tx.query(`UPDATE pmp.events SET status = 'archived' WHERE id = $1`, [eventId]));
});

describe("a reminder for one speaker reaches that speaker only (D-177)", () => {
  test("both are missing a file, and only the one named is emailed", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const since = new Date();
    const result = await send({ template_id: reminderTemplate, missing_only: false, speaker_ids: [bravo] });
    assert.equal(result.queued, 1);
    assert.deepEqual(await sentTo(since), [bravo], "Alpha, also missing a file, is not emailed");
  });

  test("the guards still hold for them: pressed again at once, nothing is sent", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const since = new Date();
    const again = await send({ template_id: reminderTemplate, missing_only: false, speaker_ids: [bravo] });
    assert.equal(again.queued, 0, "the resend cooldown applies to a one-speaker send too");
    assert.deepEqual(await sentTo(since), []);
  });

  test("an empty list sends to nobody — never to everyone", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await ageSends(48);
    const since = new Date();
    const none = await send({ template_id: reminderTemplate, missing_only: false, speaker_ids: [] });
    assert.equal(none.queued, 0);
    assert.deepEqual(await sentTo(since), []);
    // …while the plain reminder still reaches everyone missing a file.
    const everyone = await send({ template_id: reminderTemplate, missing_only: true });
    assert.equal(everyone.queued, 2);
    assert.deepEqual((await sentTo(since)).sort(), [alpha, bravo].sort());
  });
});
