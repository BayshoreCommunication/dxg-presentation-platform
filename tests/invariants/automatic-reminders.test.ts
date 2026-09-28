import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { signInStaff } from "../helpers/signIn.ts";
import { removeTestEvents } from "../helpers/cleanup.ts";
import { withSystemScope } from "@pmp/db";
import { runDueReminders } from "../../apps/api/src/services/reminders.ts";

/**
 * Automatic upload reminders (D-096, FR-COM-002).
 *
 * The scheduler is driven here with a clock of the test's choosing, against one event:
 * nothing before a reminder day or before 09:00 on it; each reminder day once; a missed
 * day folded into the next rather than sent as a burst; nothing after the deadline or
 * from a draft; and a moved deadline starts afresh. Every address is `example.invalid`,
 * which the SES transport never sends (D-090).
 */
const API = process.env.API_BASE ?? "http://localhost:4000/api/v1";
const PASSWORD = "dxg-development-password";
const CLIENT = "11111111-1111-4111-8111-111111111111";
const NAME = "Reminder Probe";
const DRAFT_NAME = "Reminder Draft Probe";
const RUN = Date.now();
const TZ = "America/New_York";
const EVENT_DAY = "2031-06-10";

/*
 * Fixed dates: the probe's earlier reminder runs are cleared in `before`, so every run
 * starts from none. (Picking a "fresh" date per run collided with an earlier run's date,
 * whose reminders then — correctly — counted as already sent.)
 */
const DEADLINE = "2031-04-01";
const MOVED = "2031-04-04";

let up = false;
let admin = "";
let eventId = "";
let draftId = "";
let speakerId = "";

const json = () => ({ "content-type": "application/json", cookie: admin });
const call = (method: string, path: string, body?: unknown) =>
  fetch(`${API}${path}`, { method, headers: json(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** Noon-ish or a given hour on `date`, New York time in June (EDT, UTC−4) — close enough for day logic. */
const at = (date: string, hour: number) => new Date(`${date}T${String(hour + 4).padStart(2, "0")}:00:00Z`);
const before_ = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
};

const run = (now: Date, id = eventId) => withSystemScope((tx) => runDueReminders(tx, { now, eventId: id }));

const remindersTo = (speaker: string) =>
  withSystemScope(async (tx) => {
    const { rows } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pmp.communications c
         JOIN pmp.communication_templates t ON t.id = c.template_id
        WHERE c.speaker_id = $1 AND t.name ~* 'reminder'`,
      [speaker],
    );
    return rows[0]!.n;
  });

/** What waiting half a day looks like to the 12-hour guard: the sends are made older. */
const ageSends = () =>
  withSystemScope((tx) =>
    tx.query(`UPDATE pmp.communications SET created_at = created_at - interval '13 hours' WHERE speaker_id = $1`, [
      speakerId,
    ]),
  );

async function eventWithSpeaker(name: string, email: string): Promise<{ id: string; speaker: string }> {
  const existing = (await (await call("GET", "/events")).json()) as { items: { id: string; name: string; status: string }[] };
  const probe = existing.items.find((item) => item.name === name);
  let id = probe?.id ?? "";
  if (probe?.status === "archived") assert.equal((await call("POST", `/events/${id}/restore`)).status, 200);
  if (!id) {
    const created = (await (
      await call("POST", "/events", {
        client_id: CLIENT,
        name,
        venue: "Probe Venue",
        timezone: TZ,
        starts_on: EVENT_DAY,
        ends_on: EVENT_DAY,
      })
    ).json()) as { event_id: string };
    id = created.event_id;
  }
  const title = `Reminder Talk ${RUN}`;
  assert.equal(
    (await call("POST", `/events/${id}/sessions`, { title, room: "Probe Room", track: "", date: EVENT_DAY, start: "09:00", end: "10:00" }))
      .status,
    201,
  );
  const agenda = (await (await call("GET", `/events/${id}/agenda`)).json()) as {
    items: { presentations: { slot_id: string; title: string }[] }[];
  };
  const slot = agenda.items.flatMap((item) => item.presentations).find((talk) => talk.title === title)!;
  const added = (await (
    await call("POST", `/events/${id}/speakers`, { name: `Reminder Speaker ${RUN}`, email, organization: "", slot_id: slot.slot_id })
  ).json()) as { speaker_id: string };
  assert.equal(
    (await call("PATCH", `/events/${id}`, { settings: { upload_deadline: DEADLINE, reminder_days: [14, 7, 2] } })).status,
    200,
  );
  return { id, speaker: added.speaker_id };
}

before(async () => {
  try {
    up = (await fetch(`${API.replace("/api/v1", "")}/ops/health`)).ok;
  } catch {
    up = false;
  }
  if (!up) return;
  admin = await signInStaff(API, "admin@example.invalid", PASSWORD);

  // Reused and left archived: the reminders it sends are history, so it cannot be deleted.
  const main = await eventWithSpeaker(NAME, `reminder.${RUN}@example.invalid`);
  eventId = main.id;
  speakerId = main.speaker;
  await withSystemScope((tx) => tx.query(`DELETE FROM pmp.reminder_runs WHERE event_id = $1`, [eventId]));
  const status = (await (await call("GET", `/events/${eventId}/draft`)).json()) as { status: string };
  if (status.status !== "active") assert.equal((await call("POST", `/events/${eventId}/activate`)).status, 200);

  // A draft with the same set-up, which must send nothing. Deleted afterwards.
  draftId = (await eventWithSpeaker(DRAFT_NAME, `reminder.draft.${RUN}@example.invalid`)).id;
});

after(async () => {
  if (!up) return;
  if (speakerId) await call("DELETE", `/events/${eventId}/speakers/${speakerId}`);
  if (eventId) await call("POST", `/events/${eventId}/archive`);
  await removeTestEvents([DRAFT_NAME]);
});

describe("automatic reminders (D-096)", () => {
  test("nothing goes before the first reminder day", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.deepEqual(await run(at(before_(DEADLINE, 15), 12)), []);
    assert.equal(await remindersTo(speakerId), 0);
  });

  test("on the day, nothing goes before 09:00 event time", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.deepEqual(await run(at(before_(DEADLINE, 14), 8)), []);
  });

  test("from 09:00 the reminder goes to the speaker missing a file — once", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    const sent = await run(at(before_(DEADLINE, 14), 10));
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.days_before, 14);
    assert.equal(sent[0]!.outcome, "sent");
    assert.equal(await remindersTo(speakerId), 1);

    assert.deepEqual(await run(at(before_(DEADLINE, 14), 11)), [], "the same day does not run twice");
    assert.equal(await remindersTo(speakerId), 1);
  });

  test("a missed reminder day is folded into the next, not sent as a burst", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await ageSends();
    // A missed day waits for 09:00 like any other (D-102): it used to go out at 00:39.
    assert.deepEqual(await run(at(before_(DEADLINE, 3), 1)), [], "nothing is sent in the night");
    // The 7-day reminder was never run (the server was "down"); the 2-day one is now due.
    const sent = await run(at(before_(DEADLINE, 2), 10));
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.days_before, 2);
    assert.equal(await remindersTo(speakerId), 2, "one more email, not two");

    const comms = (await (await call("GET", `/events/${eventId}/comms`)).json()) as {
      reminders: { on: boolean; runs: { days_before: number; outcome: string }[]; next: unknown };
    };
    assert.equal(comms.reminders.on, true);
    assert.deepEqual(
      comms.reminders.runs.map((row) => `${row.days_before}:${row.outcome}`),
      ["14:sent", "7:caught_up", "2:sent"],
    );
  });

  test("nothing goes after the deadline", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.deepEqual(await run(at(before_(DEADLINE, -1), 10)), []);
  });

  test("moving the deadline starts a fresh set of reminders", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await ageSends();
    assert.equal((await call("PATCH", `/events/${eventId}`, { settings: { upload_deadline: MOVED } })).status, 200);
    const sent = await run(at(before_(MOVED, 2), 10));
    assert.equal(sent.length, 1, "the new deadline's reminder goes");
    assert.equal(await remindersTo(speakerId), 3);
  });

  test("a speaker just sent their upload link is not reminded of it (D-102)", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    await ageSends();
    assert.equal(
      (await call("PATCH", `/events/${eventId}`, { settings: { reminder_days: [14, 7, 2, 1] } })).status,
      200,
    );
    // The upload-link email, just sent. Recorded directly: the real endpoint sends once per
    // speaker ever, and this speaker has had reminders already, which count as that.
    await withSystemScope((tx) =>
      tx.query(
        `INSERT INTO pmp.communications (event_id, client_id, speaker_id, template_id, to_address, subject, status)
         SELECT e.id, e.client_id, $2, t.id, 'reminder.link@example.invalid', 'Please upload', 'sent'
           FROM pmp.events e
           JOIN pmp.communication_templates t ON t.event_id = e.id AND t.name !~* 'reminder'
          WHERE e.id = $1
          LIMIT 1`,
        [eventId, speakerId],
      ),
    );

    const sent = await run(at(before_(MOVED, 1), 10));
    assert.equal(sent.length, 1, "the 1-day reminder runs");
    assert.equal(sent[0]!.queued, 0, "but the speaker emailed minutes ago is skipped");
    assert.equal(await remindersTo(speakerId), 3);
  });

  test("turning reminders off stops them", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.equal((await call("PATCH", `/events/${eventId}`, { settings: { reminder_days: [] } })).status, 200);
    assert.deepEqual(await run(at(before_(MOVED, 1), 10)), []);
    const comms = (await (await call("GET", `/events/${eventId}/comms`)).json()) as { reminders: { on: boolean } };
    assert.equal(comms.reminders.on, false);
  });

  test("a draft event sends nothing", async (t: TestContext) => {
    if (!up) return t.skip("API not running");
    assert.deepEqual(await run(at(before_(DEADLINE, 14), 10), draftId), []);
  });
});
