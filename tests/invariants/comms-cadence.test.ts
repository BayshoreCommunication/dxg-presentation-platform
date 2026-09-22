import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { withSystemScope } from "@pmp/db";

/**
 * FR-COM-002: "Configurable event reminder cadence; SOW defaults T-14/T-7/T-2."
 *
 * The guard that stops a speaker being emailed twice had no time bound — a speaker who
 * had ever received a template was skipped from it forever. So of the three reminders
 * the SOW asks for, only the first could ever be sent, and a speaker who lost their
 * link could never be put back in a batch.
 *
 * SCREEN_SPECS §9 states the rule as idempotent by `(batch_id, speaker_id)`: re-running
 * *a batch* must not re-send, a later batch may. There is no `batch_id` column, which is
 * why "the same batch" had been approximated as "this template, ever"; the approximation
 * is now a day, which keeps the half that matters.
 *
 * Both halves are load-bearing, so both are tested: pressing twice in a minute must send
 * once, and the next reminder in the cadence must go out.
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const EVENT_NAME = "Comms Cadence Probe";
const AGENDA = [
  "Session Title,Session Location,Session Date,Session Start,Session End,Presenter 1 Email,Presenter 1 First Name,Presenter 1 Last Name",
  "Cadence Talk,Ballroom A,03/14/2027,9:00 AM,10:00 AM,cadence@example.invalid,Cadence,Probe",
].join("\n");

let up = false;
let admin = "";
let eventId = "";
let reminderTemplate = "";

const json = (cookie: string) => ({ "content-type": "application/json", cookie });

type SendResult = { queued: number; skipped: { reason: string; count: number }[] };

const send = async (): Promise<SendResult> =>
  (await (
    await fetch(`${API}/events/${eventId}/comms/send`, {
      method: "POST",
      headers: json(admin),
      body: JSON.stringify({ template_id: reminderTemplate, missing_only: true }),
    })
  ).json()) as SendResult;

/** Ages every send so the cooldown has passed — what waiting a day looks like. */
const ageSends = async (hours: number): Promise<void> => {
  await withSystemScope(async (tx) => {
    await tx.query(
      `UPDATE pmp.communications SET created_at = created_at - make_interval(hours => $2)
        WHERE event_id = $1`,
      [eventId, hours],
    );
  });
};

const emailsSent = async (): Promise<number> =>
  withSystemScope(async (tx) => {
    const { rows } = await tx.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pmp.communications WHERE event_id = $1`,
      [eventId],
    );
    return Number(rows[0]!.n);
  });

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);

  /*
   * Reused if it is already there, not created afresh.
   *
   * Sending mail writes `communications` and, through the dispatcher, the
   * `communication_events` that record delivery — and `communication_events` is
   * append-only, so `pmp_app` is refused DELETE on it outright. A probe that has sent
   * therefore cannot be removed, only archived, which is the system behaving as
   * designed: sending is history. Creating a new one each run would leave an archived
   * row behind every time, which is the pile-up the cleanup helpers exist to prevent.
   * One probe, reused, and the assertions below count deltas so a reused event with
   * mail already against it reads the same as a fresh one.
   */
  const existing = (await (
    await fetch(`${API}/events`, { headers: json(admin) })
  ).json()) as { items?: { id: string; name: string }[] };
  eventId = existing.items?.find((candidate) => candidate.name === EVENT_NAME)?.id ?? "";

  if (!eventId) {
    const created = (await (
      await fetch(`${API}/events`, {
        method: "POST",
        headers: json(admin),
        body: JSON.stringify({
          client_id: "11111111-1111-4111-8111-111111111111",
          name: EVENT_NAME,
          venue: "Tampa",
          timezone: "America/New_York",
          starts_on: "2027-03-14",
          ends_on: "2027-03-14",
        }),
      })
    ).json()) as { event_id: string };
    eventId = created.event_id;
  }

  // A speaker with a talk and no file — the only kind a reminder targets.
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

  const comms = (await (await fetch(`${API}/events/${eventId}/comms`, { headers: json(admin) })).json()) as {
    templates: { id: string; name: string }[];
  };
  reminderTemplate = comms.templates.find((t) => /reminder/i.test(t.name))!.id;

  /*
   * Anything this probe sent on a previous run is aged past the cooldown, so the suite
   * starts where a brand-new event would: nobody recently emailed. Without it the
   * first test measures the tail of the last run rather than the rule.
   */
  await ageSends(48);
});

after(async () => {
  if (!up) return;
  /*
   * The event stays, archived. See the note in `before`: it has sent mail, the
   * dispatcher recorded delivery against it, and `communication_events` is append-only
   * with DELETE refused to `pmp_app` outright. A probe that has sent cannot be removed
   * — which is the schema behaving as designed, not an obstacle to work around. It is
   * reused on the next run instead, so exactly one ever exists.
   */
  await withSystemScope(async (tx) => {
    await tx.query(`UPDATE pmp.events SET status = 'archived' WHERE id = $1`, [eventId]);
  });
});

describe("a reminder can be sent more than once, but not twice over", () => {
  test("the first reminder goes out", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const before = await emailsSent();
    const result = await send();
    assert.equal(result.queued, 1);
    assert.equal(await emailsSent(), before + 1);
  });

  test("pressing again straight away sends nothing, and says why", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const before = await emailsSent();
    const result = await send();
    assert.equal(result.queued, 0);
    assert.equal(await emailsSent(), before, "a second press must not email anyone twice");
    assert.match(result.skipped[0]!.reason, /last 24 hours/);
  });

  /*
   * The case the old rule made impossible. The closest pair in the SOW's cadence is
   * T-7 to T-2, five days apart; a day is enough to prove the bound is a bound.
   */
  test("the next reminder in the cadence goes out once the day has passed", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await ageSends(25);
    const before = await emailsSent();
    const result = await send();
    assert.equal(result.queued, 1, "under the old rule this speaker was finished with forever");
    assert.equal(await emailsSent(), before + 1);
  });

  test("and a third, so a full T-14 · T-7 · T-2 cadence can be sent", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await ageSends(25);
    const before = await emailsSent();
    assert.equal((await send()).queued, 1);
    assert.equal(await emailsSent(), before + 1);
  });
});
