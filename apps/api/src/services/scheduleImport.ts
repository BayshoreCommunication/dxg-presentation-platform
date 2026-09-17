import type pg from "pg";
import { appendAudit } from "@pmp/db";
import { parseSheet, excelSerialToDate } from "@pmp/files";
import type { Actor, DomainError, Result } from "@pmp/domain";
import { err, ok } from "@pmp/domain";

/* ── column mapping (FR-IMP-001) ─────────────────────────────────────────── */

export const IMPORT_FIELDS = [
  "session.title",
  "room.name",
  "session.date",
  "session.start",
  "session.end",
  "speaker.name",
  "speaker.email",
  "speaker.organization",
  "track.name",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

const SYNONYMS: Record<ImportField, string[]> = {
  "session.title": ["session title", "title", "talk", "presentation", "session"],
  "room.name": ["room", "location", "venue room", "hall"],
  "session.date": ["date", "day", "session date"],
  "session.start": ["start", "start time", "from", "begins"],
  "session.end": ["end", "end time", "to", "finish", "ends"],
  "speaker.name": ["speaker name", "speaker", "presenter", "name"],
  "speaker.email": ["speaker email", "email", "e-mail", "contact"],
  "speaker.organization": ["organization", "organisation", "company", "affiliation", "org"],
  "track.name": ["track", "stream", "theme", "category"],
};

const normalise = (value: string): string => value.trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");

/** Auto-mapping is a suggestion: the user can override every column. */
export function autoMap(headers: string[]): (ImportField | null)[] {
  const taken = new Set<ImportField>();
  return headers.map((header) => {
    const key = normalise(header);
    for (const field of IMPORT_FIELDS) {
      if (taken.has(field)) continue;
      if (SYNONYMS[field].some((synonym) => normalise(synonym) === key)) {
        taken.add(field);
        return field;
      }
    }
    for (const field of IMPORT_FIELDS) {
      if (taken.has(field)) continue;
      if (
        SYNONYMS[field].some((synonym) => {
          const candidate = normalise(synonym);
          return key.includes(candidate) || candidate.includes(key);
        })
      ) {
        taken.add(field);
        return field;
      }
    }
    return null;
  });
}

/** Levenshtein distance, used only to suggest a room the user probably meant. */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, index) => index);
  for (let i = 1; i < rows; i += 1) {
    const current = [i, ...Array<number>(cols - 1).fill(0)];
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[cols - 1]!;
}

/**
 * Suggests the room the user probably meant — conservatively. A wrong room means
 * the wrong deck in the wrong room, so a suggestion is offered only for a clear
 * typo (distance 1–2) and never when two rooms are equally close. It is always a
 * suggestion: applying it is an explicit action.
 */
export function closestRoom(value: string, rooms: string[]): string | null {
  const scored = rooms
    .map((room) => ({ name: room, distance: editDistance(normalise(value), normalise(room)) }))
    .sort((a, b) => a.distance - b.distance);

  const best = scored[0];
  if (!best || best.distance === 0 || best.distance > 2) return null;
  const runnerUp = scored[1];
  if (runnerUp && runnerUp.distance === best.distance) return null; // ambiguous
  return best.name;
}

/* ── validation ──────────────────────────────────────────────────────────── */

export type RowIssue = {
  row: number;
  column: ImportField | "row";
  severity: "blocking" | "warning";
  message: string;
  suggestion?: { field: ImportField; value: string };
};

export type StagedRow = {
  row: number;
  title: string;
  room: string;
  starts_at: string | null;
  ends_at: string | null;
  speaker_name: string;
  speaker_email: string;
  organization: string;
  track: string;
  action: "create" | "update" | "unchanged";
};

export type ImportPreview = {
  import_id: string;
  file_name: string;
  headers: string[];
  mapping: (ImportField | null)[];
  total_rows: number;
  blocking: number;
  warnings: number;
  new_speakers: number;
  counts: { create: number; update: number; unchanged: number };
  issues: RowIssue[];
  rows: StagedRow[];
};

const cell = (row: string[], mapping: (ImportField | null)[], field: ImportField): string => {
  const index = mapping.indexOf(field);
  return index < 0 ? "" : (row[index] ?? "").trim();
};

/**
 * A spreadsheet's times are wall-clock times at the venue, not UTC. Reading them
 * as UTC silently shifts every session by the event's offset, so they are
 * converted through the event's own timezone (DST included).
 */
export function zonedToUtc(localIso: string, timeZone: string): Date {
  const guess = new Date(`${localIso}Z`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(guess).map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return new Date(guess.getTime() - (asIfUtc - guess.getTime()));
}

/** Accepts ISO dates, common written dates, and Excel serial numbers. */
function toDateTime(date: string, time: string): string | null {
  if (!date) return null;
  let iso: string | null = null;
  if (/^\d+(\.\d+)?$/.test(date)) iso = excelSerialToDate(Number(date)).slice(0, 10);
  else {
    const parsed = new Date(`${date}T00:00:00Z`);
    iso = Number.isNaN(parsed.getTime())
      ? (() => {
          const loose = new Date(date);
          return Number.isNaN(loose.getTime()) ? null : loose.toISOString().slice(0, 10);
        })()
      : parsed.toISOString().slice(0, 10);
  }
  if (!iso) return null;

  let clock = time.trim();
  if (/^\d+(\.\d+)?$/.test(clock)) {
    const minutes = Math.round(Number(clock) * 24 * 60);
    clock = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  const match = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(clock);
  if (!match && clock) return null;
  let hour = match ? Number(match[1]) : 9;
  const minute = match ? Number(match[2]) : 0;
  const meridiem = match?.[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return `${iso}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

export async function buildPreview(
  tx: pg.PoolClient,
  input: {
    eventId: string;
    fileName: string;
    body: Buffer;
    actorId: string;
    s3Key: string;
    mapping?: (ImportField | null)[];
  },
): Promise<Result<ImportPreview, DomainError>> {
  let sheet: string[][];
  try {
    sheet = parseSheet(input.body, input.fileName);
  } catch {
    return err({
      code: "import.unreadable",
      message: "That file could not be read as a spreadsheet. Save it as .xlsx or .csv and try again.",
    });
  }
  const [headers, ...dataRows] = sheet;
  if (!headers || dataRows.length === 0) {
    return err({ code: "import.empty", message: "The file has no data rows." });
  }

  const mapping = input.mapping ?? autoMap(headers);
  const { rows: roomRows } = await tx.query<{ name: string }>(
    `SELECT name FROM pmp.rooms WHERE event_id = $1`,
    [input.eventId],
  );
  const roomNames = roomRows.map((room) => room.name);

  const { rows: tzRows } = await tx.query<{ timezone: string }>(
    `SELECT timezone FROM pmp.events WHERE id = $1`,
    [input.eventId],
  );
  const timeZone = tzRows[0]?.timezone ?? "UTC";

  const { rows: existingSessions } = await tx.query<{ room: string | null; starts_at: string; title: string }>(
    `SELECT r.name AS room, se.starts_at, s.title
       FROM pmp.slots s JOIN pmp.sessions se ON se.id = s.session_id
       LEFT JOIN pmp.rooms r ON r.id = se.room_id
      WHERE s.event_id = $1`,
    [input.eventId],
  );
  const existingKeys = new Map(
    existingSessions.map((session) => [
      `${normalise(session.room ?? "")}|${new Date(session.starts_at).toISOString()}|${normalise(session.title)}`,
      session,
    ]),
  );

  const { rows: speakerRows } = await tx.query<{ email: string | null }>(
    `SELECT email::text FROM pmp.speakers WHERE event_id = $1 AND merged_into IS NULL`,
    [input.eventId],
  );
  const existingEmails = new Set(speakerRows.map((row) => (row.email ?? "").toLowerCase()));

  const issues: RowIssue[] = [];
  const staged: StagedRow[] = [];
  const newSpeakers = new Set<string>();

  dataRows.forEach((row, index) => {
    const rowNumber = index + 2; // header is row 1, as the user sees it
    const title = cell(row, mapping, "session.title");
    const room = cell(row, mapping, "room.name");
    const date = cell(row, mapping, "session.date");
    const start = cell(row, mapping, "session.start");
    const end = cell(row, mapping, "session.end");
    const speakerName = cell(row, mapping, "speaker.name");
    const speakerEmail = cell(row, mapping, "speaker.email");

    if (!title) {
      issues.push({ row: rowNumber, column: "session.title", severity: "blocking", message: "Session title is empty." });
    }

    if (!room) {
      issues.push({ row: rowNumber, column: "room.name", severity: "blocking", message: "Room is empty." });
    } else if (roomNames.length > 0 && !roomNames.some((name) => normalise(name) === normalise(room))) {
      const suggestion = closestRoom(room, roomNames);
      issues.push({
        row: rowNumber,
        column: "room.name",
        severity: "blocking",
        message: suggestion
          ? `Room “${room}” doesn't match any room on this event. Closest match: ${suggestion}.`
          : `Room “${room}” doesn't match any room on this event.`,
        ...(suggestion ? { suggestion: { field: "room.name" as ImportField, value: suggestion } } : {}),
      });
    }

    const startsAt = toDateTime(date, start);
    const endsAt = toDateTime(date, end || start);
    if (!startsAt) {
      issues.push({
        row: rowNumber,
        column: "session.date",
        severity: "blocking",
        message: `Could not read a date and time from “${date} ${start}”.`,
      });
    }

    if (speakerName && !speakerEmail) {
      issues.push({
        row: rowNumber,
        column: "speaker.email",
        severity: "warning",
        message: "No speaker email — this session imports, but invitations are held until an email is added.",
      });
    }
    if (speakerEmail && !existingEmails.has(speakerEmail.toLowerCase())) newSpeakers.add(speakerEmail.toLowerCase());

    const key = `${normalise(room)}|${startsAt ? zonedToUtc(startsAt, timeZone).toISOString() : ""}|${normalise(title)}`;
    const match = existingKeys.get(key);

    staged.push({
      row: rowNumber,
      title,
      room,
      // Stored as an absolute instant; the spreadsheet's wall-clock time is
      // interpreted in the event's timezone.
      starts_at: startsAt ? zonedToUtc(startsAt, timeZone).toISOString() : null,
      ends_at: endsAt ? zonedToUtc(endsAt, timeZone).toISOString() : null,
      speaker_name: speakerName,
      speaker_email: speakerEmail,
      organization: cell(row, mapping, "speaker.organization"),
      track: cell(row, mapping, "track.name"),
      // Re-import matches on (room, start, title) and updates instead of
      // duplicating (FR-IMP-002).
      action: match ? "unchanged" : "create",
    });
  });

  const counts = {
    create: staged.filter((row) => row.action === "create").length,
    update: staged.filter((row) => row.action === "update").length,
    unchanged: staged.filter((row) => row.action === "unchanged").length,
  };

  const { rows: importRows } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.schedule_imports
       (event_id, client_id, uploaded_by, filename, s3_key, column_mapping, status, row_errors, diff)
     SELECT $1, e.client_id, $2, $3, $4, $5, $6, $7, $8 FROM pmp.events e WHERE e.id = $1
     RETURNING id`,
    [
      input.eventId,
      input.actorId,
      input.fileName,
      input.s3Key,
      JSON.stringify(mapping),
      issues.some((issue) => issue.severity === "blocking") ? "failed" : "validated",
      JSON.stringify(issues),
      JSON.stringify({ total: staged.length, counts }),
    ],
  );

  return ok({
    import_id: importRows[0]?.id ?? "",
    file_name: input.fileName,
    headers,
    mapping,
    total_rows: staged.length,
    blocking: issues.filter((issue) => issue.severity === "blocking").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    new_speakers: newSpeakers.size,
    counts,
    issues,
    rows: staged,
  });
}

/* ── commit (transactional, all or nothing) ──────────────────────────────── */

export async function commitImport(
  tx: pg.PoolClient,
  actor: Actor,
  input: { eventId: string; importId: string; rows: StagedRow[] },
): Promise<Result<{ created: number; updated: number; unchanged: number; speakers: number }, DomainError>> {
  const { rows: eventRows } = await tx.query<{ client_id: string }>(
    `SELECT client_id FROM pmp.events WHERE id = $1`,
    [input.eventId],
  );
  const clientId = eventRows[0]?.client_id;
  if (!clientId) return err({ code: "import.event_not_found", message: "No such event." });

  const blocking = input.rows.filter((row) => !row.title || !row.room || !row.starts_at);
  if (blocking.length > 0) {
    return err({
      code: "import.blocking_errors",
      message: `${blocking.length} row(s) still have blocking errors — fix them or remove them before importing.`,
      detail: { rows: blocking.map((row) => row.row) },
    });
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  const speakers = new Set<string>();

  for (const row of input.rows) {
    const { rows: roomRows } = await tx.query<{ id: string }>(
      `SELECT id FROM pmp.rooms WHERE event_id = $1 AND lower(name) = lower($2)`,
      [input.eventId, row.room],
    );
    let roomId = roomRows[0]?.id;
    if (!roomId) {
      const { rows: inserted } = await tx.query<{ id: string }>(
        `INSERT INTO pmp.rooms (event_id, client_id, name) VALUES ($1, $2, $3) RETURNING id`,
        [input.eventId, clientId, row.room],
      );
      roomId = inserted[0]!.id;
    }

    let trackId: string | null = null;
    if (row.track) {
      const { rows: trackRows } = await tx.query<{ id: string }>(
        `SELECT id FROM pmp.tracks WHERE event_id = $1 AND lower(name) = lower($2)`,
        [input.eventId, row.track],
      );
      trackId =
        trackRows[0]?.id ??
        (
          await tx.query<{ id: string }>(
            `INSERT INTO pmp.tracks (event_id, client_id, name) VALUES ($1,$2,$3) RETURNING id`,
            [input.eventId, clientId, row.track],
          )
        ).rows[0]!.id;
    }

    const dayDate = row.starts_at!.slice(0, 10);
    const { rows: dayRows } = await tx.query<{ id: string }>(
      `INSERT INTO pmp.event_days (event_id, client_id, day_date) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING RETURNING id`,
      [input.eventId, clientId, dayDate],
    );
    const dayId =
      dayRows[0]?.id ??
      (
        await tx.query<{ id: string }>(
          `SELECT id FROM pmp.event_days WHERE event_id = $1 AND day_date = $2`,
          [input.eventId, dayDate],
        )
      ).rows[0]?.id ??
      null;

    // Update-by-key: (room, start, title) identifies a session across re-imports.
    const { rows: existing } = await tx.query<{
      id: string;
      slot_id: string;
      ends_at: string;
      track_id: string | null;
    }>(
      `SELECT se.id, s.id AS slot_id, se.ends_at, se.track_id
         FROM pmp.sessions se JOIN pmp.slots s ON s.session_id = se.id
        WHERE se.event_id = $1 AND se.room_id = $2 AND se.starts_at = $3::timestamptz
          AND lower(s.title) = lower($4)
        LIMIT 1`,
      [input.eventId, roomId, row.starts_at, row.title],
    );

    let slotId: string;
    if (existing[0]) {
      // Matched by key, so this is the same session. It only counts as updated
      // when something actually differs — a re-import of an unchanged file must
      // report every row as unchanged and write nothing.
      const endsDiffer =
        row.ends_at !== null &&
        new Date(existing[0].ends_at).toISOString() !== new Date(row.ends_at).toISOString();
      const trackDiffers = trackId !== null && trackId !== existing[0].track_id;

      if (endsDiffer || trackDiffers) {
        await tx.query(
          `UPDATE pmp.sessions
              SET ends_at = COALESCE($2::timestamptz, ends_at),
                  track_id = COALESCE($3, track_id),
                  day_id = COALESCE($4, day_id),
                  lock_version = lock_version + 1
            WHERE id = $1`,
          [existing[0].id, row.ends_at, trackId, dayId],
        );
        updated += 1;
      } else {
        unchanged += 1;
      }
      slotId = existing[0].slot_id;
    } else {
      const { rows: sessionRows } = await tx.query<{ id: string }>(
        `INSERT INTO pmp.sessions (event_id, client_id, room_id, track_id, day_id, title, starts_at, ends_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz, COALESCE($8::timestamptz, $7::timestamptz + interval '30 minutes'))
         RETURNING id`,
        [input.eventId, clientId, roomId, trackId, dayId, row.title, row.starts_at, row.ends_at],
      );
      const { rows: slotRows } = await tx.query<{ id: string }>(
        `INSERT INTO pmp.slots (session_id, event_id, client_id, title) VALUES ($1,$2,$3,$4) RETURNING id`,
        [sessionRows[0]!.id, input.eventId, clientId, row.title],
      );
      slotId = slotRows[0]!.id;
      created += 1;
    }

    if (row.speaker_name) {
      const { rows: speakerRows } = await tx.query<{ id: string }>(
        row.speaker_email
          ? `SELECT id FROM pmp.speakers WHERE event_id = $1 AND lower(email::text) = lower($2) AND merged_into IS NULL`
          : `SELECT id FROM pmp.speakers WHERE event_id = $1 AND lower(full_name) = lower($2) AND merged_into IS NULL`,
        [input.eventId, row.speaker_email || row.speaker_name],
      );
      let speakerId = speakerRows[0]?.id;
      if (!speakerId) {
        const { rows: inserted } = await tx.query<{ id: string }>(
          `INSERT INTO pmp.speakers (client_id, event_id, email, full_name, organization)
           VALUES ($1,$2,NULLIF($3,'')::citext,$4,NULLIF($5,'')) RETURNING id`,
          [clientId, input.eventId, row.speaker_email, row.speaker_name, row.organization],
        );
        speakerId = inserted[0]!.id;
      } else if (row.organization) {
        await tx.query(`UPDATE pmp.speakers SET organization = COALESCE(organization, $2) WHERE id = $1`, [
          speakerId,
          row.organization,
        ]);
      }
      speakers.add(speakerId);
      await tx.query(
        `INSERT INTO pmp.speaker_assignments (speaker_id, slot_id, event_id, client_id)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [speakerId, slotId, input.eventId, clientId],
      );
    }
  }

  await tx.query(`UPDATE pmp.schedule_imports SET status = 'committed', committed_at = now() WHERE id = $1`, [
    input.importId,
  ]);
  await appendAudit(tx, {
    partitionId: input.eventId,
    clientId,
    actorUserId: actor.id,
    action: "import.committed",
    subjectType: "schedule_import",
    subjectId: input.importId,
    detail: { created, updated, unchanged, speakers: speakers.size },
  });

  return ok({ created, updated, unchanged, speakers: speakers.size });
}
