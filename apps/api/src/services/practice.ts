import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { appendAudit } from "@pmp/db";
import type { Actor, DomainError, Result } from "@pmp/domain";
import { err, ok } from "@pmp/domain";
import { createEvent, configureEvent, activateEvent } from "./events.ts";
import { createSession, setReleasePermission } from "./agendaEdit.ts";
import type { ReleasePermission } from "./agendaEdit.ts";
import { addStation } from "./srr.ts";
import { ingestVersion, storage } from "./ingest.ts";
import { decide } from "./review.ts";

/**
 * Practice events (D-116). A staff member presses "Start a practice event" and gets a
 * realistic event of their own — rooms, a two-day agenda, six made-up speakers, real
 * decks in every state a reviewer meets — to do each job on without any risk:
 *   - it is built through the same services a person uses, so audit, outbox and the
 *     file pipeline (virus scan, inspection, PDF preview) run for real;
 *   - every speaker's address is on `practice.invalid`, a domain that cannot receive mail,
 *     and the dispatcher refuses any email whose event is a practice event, whatever the
 *     address — two locks, either one enough;
 *   - it belongs to a made-up client, never offered for real events, and is never counted
 *     with them. Archiving it (the ordinary Archive button) is how it is put away.
 */

export const PRACTICE_CLIENT = "DXG practice (not a real client)";
/** Practice events one person may have open (not archived) at once. */
export const PRACTICE_LIMIT = 3;

const ZONE = "America/New_York";
const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "practice");

type Outcome = "approved" | "changes_requested" | "waiting" | "waiting_with_warning" | "missing";

/** The agenda: day index, room, times, the talk, its speaker and what happens to their file. */
const TALKS: {
  day: 0 | 1;
  room: string;
  start: string;
  end: string;
  session: string;
  title: string;
  speaker: { name: string; organization: string };
  release: ReleasePermission;
  deck?: string;
  outcome: Outcome;
}[] = [
  {
    day: 0, room: "Ballroom A", start: "09:00", end: "09:45",
    session: "Opening keynote", title: "Care closer to home",
    speaker: { name: "Amara Okafor", organization: "Northwind Health Research" },
    release: "full", deck: "normal-10-slides-notes.pptx", outcome: "approved",
  },
  {
    day: 0, room: "Room 101", start: "10:15", end: "11:00",
    session: "Devices in the field", title: "Remote monitoring at scale",
    speaker: { name: "Marcus Lindqvist", organization: "Halden Medical Devices" },
    release: "pdf_only", deck: "aspect-4x3.pptx", outcome: "changes_requested",
  },
  {
    day: 0, room: "Ballroom B", start: "11:15", end: "12:00",
    session: "Patient voices", title: "What patients told us",
    speaker: { name: "Priya Raman", organization: "Bluestem University Hospital" },
    release: "undecided", deck: "font-missing.pptx", outcome: "waiting",
  },
  {
    day: 1, room: "Ballroom A", start: "09:00", end: "09:45",
    session: "Research methods", title: "Trial design in twenty minutes",
    speaker: { name: "Tomás Herrera", organization: "Coastline Clinical Partners" },
    release: "full", deck: "video-linked-missing.pptx", outcome: "waiting_with_warning",
  },
  {
    day: 1, room: "Room 101", start: "10:15", end: "11:00",
    session: "Data and trust", title: "Data you can trust",
    speaker: { name: "Hannah Becker", organization: "Meridian Data Lab" },
    release: "pdf_only", outcome: "missing",
  },
  {
    day: 1, room: "Ballroom B", start: "14:00", end: "15:00",
    session: "Closing panel", title: "What comes next",
    speaker: { name: "Kenji Watanabe", organization: "Ashgrove Nursing Institute" },
    release: "undecided", outcome: "missing",
  },
];

const CHANGES_NOTE =
  "Your slides are the older square shape (4:3), but the room screens are widescreen (16:9). " +
  "Please change the slide size to widescreen, check nothing moved, and upload it again.";

/** `amara.okafor@practice.invalid` — a domain that can never receive mail (RFC 2606). */
export const practiceAddress = (name: string): string =>
  `${name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, ".")
    .replace(/^\.|\.$/g, "")}@practice.invalid`;

/** `YYYY-MM-DD` in the event's zone, `offset` days from today. */
function dayFromToday(offset: number): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

/** How many practice events this person has that are not archived. */
export async function openPracticeCount(tx: pg.PoolClient, userId: string): Promise<number> {
  const { rows } = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pmp.events WHERE is_practice AND practice_owner = $1 AND status <> 'archived'`,
    [userId],
  );
  return rows[0]?.n ?? 0;
}

async function practiceClient(tx: pg.PoolClient): Promise<string> {
  // Serialises two first-ever practice events, so only one made-up client is created.
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext('pmp.practice_client'))`);
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM pmp.clients WHERE is_practice OR name = $1 ORDER BY is_practice DESC, created_at LIMIT 1`,
    [PRACTICE_CLIENT],
  );
  if (rows[0]) {
    await tx.query(`UPDATE pmp.clients SET is_practice = true WHERE id = $1 AND NOT is_practice`, [rows[0].id]);
    return rows[0].id;
  }
  const { rows: created } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.clients (name, is_practice) VALUES ($1, true) RETURNING id`,
    [PRACTICE_CLIENT],
  );
  return created[0]!.id;
}

export type PracticeFile = { title: string; speaker: string; state: string };
export type PracticeResult = { event_id: string; name: string; files: PracticeFile[]; approved_version_ids: string[] };

/** Throws a domain error out of a step that cannot fail unless the build itself is wrong. */
function must<T>(result: Result<T, DomainError>, step: string): T {
  if (!result.ok) throw new Error(`practice event: ${step} failed — ${result.error.code}: ${result.error.message}`);
  return result.value;
}

/**
 * Builds one practice event for `owner`, in the caller's transaction. Everything the
 * owner later does on it is done as themselves; the build acts as its project manager.
 */
export async function createPracticeEvent(
  tx: pg.PoolClient,
  owner: { id: string; displayName: string },
): Promise<Result<PracticeResult, DomainError>> {
  // One build per person at a time, so the limit cannot be raced past.
  await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`pmp.practice:${owner.id}`]);
  if ((await openPracticeCount(tx, owner.id)) >= PRACTICE_LIMIT) {
    return err({
      code: "practice.limit_reached",
      message: `You already have ${PRACTICE_LIMIT} practice events. Archive one you have finished with, then start a new one.`,
    });
  }

  const clientId = await practiceClient(tx);
  // The owner is this event's project manager, whatever they are elsewhere (D-116).
  const actor: Actor = { id: owner.id, roles: ["project_manager"] };

  const startsOn = dayFromToday(14);
  const endsOn = dayFromToday(15);
  const label = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, month: "short", day: "numeric" }).format(new Date());
  let name = `Practice — ${owner.displayName} — ${label}`;
  const { rows: same } = await tx.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM pmp.events WHERE is_practice AND name LIKE $1`,
    [`${name}%`],
  );
  if ((same[0]?.n ?? 0) > 0) name = `${name} (${(same[0]?.n ?? 0) + 1})`;

  const { event_id: eventId } = must(
    await createEvent(tx, actor, clientId, {
      name,
      venue: "Harbourside Convention Centre (practice)",
      timezone: ZONE,
      starts_on: startsOn,
      ends_on: endsOn,
    }),
    "create",
  );
  // Marked before anything else is written to it. `createEvent` has made the owner its
  // project manager — administrators too, since the build acts without their admin role.
  await tx.query(`UPDATE pmp.events SET is_practice = true, practice_owner = $2 WHERE id = $1`, [eventId, owner.id]);

  must(
    await configureEvent(tx, actor, eventId, {
      rooms: ["Ballroom A", "Ballroom B", "Room 101"],
      settings: { upload_deadline: dayFromToday(11), reminder_days: [7, 3, 1] },
    }),
    "configure",
  );

  const slots: string[] = [];
  for (const talk of TALKS) {
    const { slot_id } = must(
      await createSession(tx, actor, eventId, {
        title: talk.session,
        room: talk.room,
        date: talk.day === 0 ? startsOn : endsOn,
        start: talk.start,
        end: talk.end,
        presentation: { title: talk.title },
        presenter: { name: talk.speaker.name, email: practiceAddress(talk.speaker.name), organization: talk.speaker.organization },
      }),
      `session "${talk.session}"`,
    );
    slots.push(slot_id);
  }
  must(await activateEvent(tx, actor, eventId), "activate");
  for (const station of ["Desk 1", "Desk 2"]) must(await addStation(tx, actor, eventId, station), "station");

  const { rows: speakers } = await tx.query<{ id: string; email: string }>(
    `SELECT id, email::text FROM pmp.speakers WHERE event_id = $1`,
    [eventId],
  );
  const speakerId = (talkName: string) => speakers.find((row) => row.email === practiceAddress(talkName))!.id;
  for (const talk of TALKS) {
    must(await setReleasePermission(tx, actor, eventId, speakerId(talk.speaker.name), { release_permission: talk.release }), "release");
  }

  /*
   * The decks go through the real intake — stored, virus-scanned, inspected, queued for
   * their PDF preview — as if each speaker had uploaded theirs. Scan and inspection run
   * inside the upload, so every decision below can be made straight away.
   */
  const files: PracticeFile[] = [];
  const approved: string[] = [];
  for (const [index, talk] of TALKS.entries()) {
    if (!talk.deck) {
      files.push({ title: talk.title, speaker: talk.speaker.name, state: "missing" });
      continue;
    }
    const uploadId = randomUUID();
    await storage.putPart(uploadId, 1, await readFile(path.join(ASSETS, talk.deck)));
    const surname = talk.speaker.name.split(" ").pop();
    const ingested = await ingestVersion(tx, {
      eventId,
      clientId,
      slotId: slots[index]!,
      fileName: `${surname} - ${talk.title}.pptx`,
      uploadId,
      source: "portal",
      speakerId: speakerId(talk.speaker.name),
    });
    if (!ingested.ok) throw new Error(`practice event: upload failed — ${ingested.error.code}`);
    const version = ingested.value;

    let state = "waiting for review";
    // A file the scan held back can't be decided on; it stays as the scan left it.
    if (version.processing_state === "stored" && (talk.outcome === "approved" || talk.outcome === "changes_requested")) {
      const claimed = must(
        await decide(tx, { versionId: version.file_version_id, action: "claim", actor, lockVersion: 0 }),
        "claim",
      );
      const decided = await decide(tx, {
        versionId: version.file_version_id,
        action: talk.outcome === "approved" ? "approve" : "request_changes",
        actor,
        lockVersion: claimed.lock_version,
        ...(talk.outcome === "changes_requested" ? { note: CHANGES_NOTE } : {}),
      });
      must(decided, talk.outcome);
      state = talk.outcome === "approved" ? "approved" : "changes requested";
      if (talk.outcome === "approved") approved.push(version.file_version_id);
    } else if (version.processing_state !== "stored") {
      state = "held back by the virus check";
    } else if (version.inspection_state === "passed_with_warnings") {
      state = "waiting for review, with a warning";
    }
    files.push({ title: talk.title, speaker: talk.speaker.name, state });
  }

  await appendAudit(tx, {
    partitionId: eventId,
    clientId,
    actorUserId: owner.id,
    action: "practice.created",
    subjectType: "event",
    subjectId: eventId,
    detail: { speakers: TALKS.length, files: files.filter((file) => file.state !== "missing").length },
  });

  return ok({ event_id: eventId, name, files, approved_version_ids: approved });
}
