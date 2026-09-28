import type pg from "pg";
import { withSystemScope } from "@pmp/db";
import type { Actor } from "@pmp/domain";
import { ensureTemplates, sendBatch } from "./comms.ts";

/**
 * Automatic upload reminders (D-096, FR-COM-002: "configurable event reminder cadence;
 * SOW defaults T-14/T-7/T-2").
 *
 * Until this, the event's "Reminders" setting was free text that nothing read, and the
 * Communications screen promised reminders that were never sent. Now each event carries
 * `settings.reminder_days` — the days before its upload deadline on which the reminder
 * template goes to every speaker still missing a file — and this runs every quarter hour:
 *
 *   - only **active** events with an upload deadline (a draft sends nothing to anyone);
 *   - a reminder day is due from 09:00 on that day, in the *event's* timezone, until the
 *     deadline has passed — and nothing is ever sent before 09:00 event time, a missed day
 *     included (D-102: a caught-up reminder used to go out at 00:39);
 *   - each reminder day runs **once** per event and deadline, recorded in `reminder_runs`, so
 *     a restart, a second worker or a slow tick cannot repeat it — and moving the
 *     deadline starts a fresh set;
 *   - if the API was down across a reminder day, the next run sends **one** reminder for
 *     the most recent day due and records the earlier ones as caught up — never a burst;
 *   - the send is the ordinary batch (`sendBatch`, missing files only), so every guard
 *     applies: no address, a bounced address, test domains (D-090), and anyone emailed
 *     about this event at all — upload link included — in the last 12 hours (D-102).
 */
export const REMINDER_CHOICES = [14, 7, 3, 2, 1] as const;
export const DEFAULT_REMINDER_DAYS = [14, 7, 2];

/** Reminders go out from this hour, event time. */
const SEND_FROM_HOUR = 9;
/**
 * Shorter than the manual 24-hour guard: two reminder days can be a day apart (3 and 2),
 * and each tick lands at a slightly different minute, so a 24-hour guard would silently
 * swallow the second one. Twelve still stops any double send within a day.
 */
const COOLDOWN_HOURS = 12;

/** The system, for the audit trail: no user sent these. */
const SCHEDULER: Actor = { id: null as unknown as string, roles: [], isMachine: true };

/** `YYYY-MM-DD` and the hour, as a wall clock in `timeZone`. */
function localNow(now: Date, timeZone: string): { day: string; hour: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** `day` minus `days`, both `YYYY-MM-DD`. */
function minusDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/** The event's reminder days, sanitised: known choices only, largest first. */
export function reminderDaysOf(settings: Record<string, unknown> | null | undefined): number[] {
  const raw = settings?.reminder_days;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((day): day is number => (REMINDER_CHOICES as readonly unknown[]).includes(day)))].sort(
    (a, b) => b - a,
  );
}

export type ReminderSchedule = {
  days: number[];
  deadline: string | null;
  /** Whether the event can send at all: active, with a deadline and at least one day. */
  on: boolean;
  /** Why not, when it cannot. */
  off_reason: string | null;
  next: { days_before: number; date: string } | null;
  runs: { days_before: number; due_on: string; ran_at: string; outcome: string; queued: number }[];
};

/** What the Communications screen shows about an event's automatic reminders. */
export async function reminderSchedule(tx: pg.PoolClient, eventId: string, now = new Date()): Promise<ReminderSchedule> {
  const { rows } = await tx.query<{ status: string; timezone: string; settings: Record<string, unknown> }>(
    `SELECT status, timezone, settings FROM pmp.events WHERE id = $1`,
    [eventId],
  );
  const event = rows[0];
  const days = reminderDaysOf(event?.settings);
  const deadline =
    typeof event?.settings?.upload_deadline === "string" && event.settings.upload_deadline
      ? event.settings.upload_deadline
      : null;
  // Only the runs for the current deadline: a moved deadline has its own reminders.
  const { rows: runs } = await tx.query<ReminderSchedule["runs"][number]>(
    `SELECT days_before, due_on::text, ran_at::text, outcome, queued
       FROM pmp.reminder_runs WHERE event_id = $1 AND deadline = $2::date ORDER BY days_before DESC`,
    [eventId, deadline ?? "1900-01-01"],
  );
  const off_reason = !event
    ? "No such event."
    : days.length === 0
      ? "Automatic reminders are off for this event."
      : !deadline
        ? "No upload deadline is set, so there is nothing to remind speakers of."
        : event.status !== "active"
          ? "Reminders start once the event is activated."
          : null;
  let next: ReminderSchedule["next"] = null;
  if (event && deadline) {
    const today = localNow(now, event.timezone).day;
    const done = new Set(runs.map((run) => run.days_before));
    const upcoming = days
      .map((daysBefore) => ({ days_before: daysBefore, date: minusDays(deadline, daysBefore) }))
      .filter((step) => !done.has(step.days_before) && step.date >= today && step.date <= deadline);
    // The earliest reminder day still ahead (today included, until it has run).
    next = upcoming.sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  }
  return { days, deadline, on: off_reason === null, off_reason, next, runs };
}

export type ReminderOutcome = { event_id: string; days_before: number; outcome: string; queued: number };

/**
 * Sends every reminder that is due. `now` and `eventId` exist for tests: one clock, one event.
 * Runs in one transaction under an advisory lock, so two API instances never both send.
 */
export async function runDueReminders(
  tx: pg.PoolClient,
  options: { now?: Date; eventId?: string } = {},
): Promise<ReminderOutcome[]> {
  const now = options.now ?? new Date();
  const { rows: lock } = await tx.query<{ got: boolean }>(
    `SELECT pg_try_advisory_xact_lock(hashtext('pmp.automatic_reminders')) AS got`,
  );
  if (!lock[0]?.got) return [];

  const { rows: events } = await tx.query<{
    id: string;
    client_id: string;
    timezone: string;
    settings: Record<string, unknown>;
  }>(
    `SELECT id, client_id, timezone, settings
       FROM pmp.events
      WHERE status = 'active'
        AND COALESCE(settings ->> 'upload_deadline', '') <> ''
        AND jsonb_typeof(settings -> 'reminder_days') = 'array'
        AND ($1::uuid IS NULL OR id = $1)`,
    [options.eventId ?? null],
  );

  const outcomes: ReminderOutcome[] = [];
  for (const event of events) {
    const deadline = String(event.settings.upload_deadline);
    const days = reminderDaysOf(event.settings);
    if (days.length === 0) continue;
    const { day: today, hour } = localNow(now, event.timezone);
    if (today > deadline) continue;
    // Never before 09:00 event time — a missed day waits for the morning too (D-102).
    if (hour < SEND_FROM_HOUR) continue;

    const { rows: ran } = await tx.query<{ days_before: number }>(
      `SELECT days_before FROM pmp.reminder_runs WHERE event_id = $1 AND deadline = $2::date`,
      [event.id, deadline],
    );
    const done = new Set(ran.map((row) => row.days_before));
    // Due: its day has come (it is past 09:00, checked above), and it has not run.
    const due = days
      .map((daysBefore) => ({ daysBefore, dueOn: minusDays(deadline, daysBefore) }))
      .filter(({ daysBefore, dueOn }) => !done.has(daysBefore) && dueOn <= today);
    if (due.length === 0) continue;

    // The most recent day due is sent; any earlier ones were missed and are folded into it.
    const [send, ...missed] = [...due].sort((a, b) => a.daysBefore - b.daysBefore);
    const templates = await ensureTemplates(tx, event.id);
    const template = templates.find((row) => /reminder/i.test(row.name));

    let outcome: "sent" | "failed" = "failed";
    let queued = 0;
    let detail: Record<string, unknown> = {};
    if (!template) {
      detail = { error: "This event has no reminder template." };
    } else {
      const result = await sendBatch(tx, SCHEDULER, {
        eventId: event.id,
        templateId: template.id,
        missingOnly: true,
        cooldownHours: COOLDOWN_HOURS,
        cooldownAnyTemplate: true,
      });
      if (result.ok) {
        outcome = "sent";
        queued = result.value.queued;
        detail = { skipped: result.value.skipped, template_id: template.id };
      } else {
        detail = { error: result.error.message, code: result.error.code };
      }
    }

    await tx.query(
      `INSERT INTO pmp.reminder_runs (event_id, client_id, deadline, days_before, due_on, outcome, queued, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (event_id, deadline, days_before) DO NOTHING`,
      [event.id, event.client_id, deadline, send!.daysBefore, send!.dueOn, outcome, queued, JSON.stringify(detail)],
    );
    for (const skipped of missed) {
      await tx.query(
        `INSERT INTO pmp.reminder_runs (event_id, client_id, deadline, days_before, due_on, outcome, detail)
         VALUES ($1, $2, $3, $4, $5, 'caught_up', $6) ON CONFLICT (event_id, deadline, days_before) DO NOTHING`,
        [event.id, event.client_id, deadline, skipped.daysBefore, skipped.dueOn, JSON.stringify({ folded_into: send!.daysBefore })],
      );
    }
    outcomes.push({ event_id: event.id, days_before: send!.daysBefore, outcome, queued });
  }
  return outcomes;
}

/** Every quarter hour, in the worker process (D-103). Off with REMINDERS_DISABLED=1. */
const TICK_MS = Number(process.env.REMINDER_TICK_MS ?? 15 * 60 * 1000);
let ticking: NodeJS.Timeout | undefined;
let first: NodeJS.Timeout | undefined;
let running: Promise<void> = Promise.resolve();

export function startReminderScheduler(): void {
  if (process.env.REMINDERS_DISABLED === "1" || ticking) return;
  const tick = () => {
    running = withSystemScope((tx) => runDueReminders(tx))
      .then((sent) => {
        for (const run of sent) {
          console.error(`[reminders] event ${run.event_id} · ${run.days_before} days before · ${run.outcome} · ${run.queued} queued`);
        }
      })
      .catch((error) => console.error("[reminders] run failed", error));
  };
  // A minute after start, so a restart does not race the rest of boot.
  first = setTimeout(tick, 60_000);
  ticking = setInterval(tick, TICK_MS);
}

/** Stops the schedule and waits for a run in progress (it is one short transaction). */
export async function stopReminderScheduler(): Promise<void> {
  if (first) clearTimeout(first);
  if (ticking) clearInterval(ticking);
  first = ticking = undefined;
  await running;
}
