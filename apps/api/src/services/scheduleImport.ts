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
  "speaker.first_name",
  "speaker.last_name",
  "speaker.email",
  "speaker.organization",
  "track.name",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

const SYNONYMS: Record<ImportField, string[]> = {
  "session.title": ["session title", "title", "talk", "presentation", "session"],
  "room.name": ["room", "location", "venue room", "hall", "session location"],
  "session.date": ["date", "day", "session date"],
  "session.start": ["start", "start time", "from", "begins"],
  "session.end": ["end", "end time", "to", "finish", "ends"],
  "speaker.name": ["speaker name", "speaker", "presenter", "name", "full name"],
  "speaker.first_name": ["first name", "given name", "forename"],
  "speaker.last_name": ["last name", "surname", "family name"],
  "speaker.email": ["speaker email", "email", "e-mail", "contact"],
  "speaker.organization": ["organization", "organisation", "company", "affiliation", "org"],
  "track.name": ["track", "stream", "theme", "category"],
};

const normalise = (value: string): string => value.trim().toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");

/**
 * Some words settle a column on their own, and must be checked before anything else.
 *
 * `Presenter 1 Email` used to map to `speaker.name`, because the substring pass tried
 * `speaker.name` first and the header contains "presenter". `Presenter 2 Email` then
 * took `speaker.email` — so the platform would have filed presenter 1's address as a
 * display name and sent every upload invitation to the *second* presenter. A column
 * that says "email" is an email column and nothing else.
 */
const DECISIVE: [RegExp, ImportField][] = [
  [/\b(e\s*mail|email)\b/, "speaker.email"],
  [/\b(first|given)\s*name\b|\bforename\b/, "speaker.first_name"],
  [/\b(last|family)\s*name\b|\bsurname\b/, "speaker.last_name"],
];

/**
 * Auto-mapping is a suggestion: the user can override every column. Three passes,
 * most certain first, so a confident match elsewhere is never stolen by a loose one.
 *
 * An unmapped column is always preferable to a wrongly mapped one — an operator sees
 * "— ignore —" and fixes it, but sees nothing at all when a column was quietly filed
 * under the wrong field. So a header whose decisive keyword is already spoken for
 * (the second presenter's email, in DXG's template) maps to nothing rather than
 * falling through to the fuzzy pass.
 */
export function autoMap(headers: string[]): (ImportField | null)[] {
  const taken = new Set<ImportField>();
  const result: (ImportField | null)[] = headers.map(() => null);
  const keys = headers.map(normalise);
  // A blank header matched everything: normalise("") is "", and "".includes("") is
  // true, so under the substring pass each empty trailing column of a template
  // claimed the next unused field in order.
  const open = keys.map((key) => key !== "");

  const claim = (index: number, field: ImportField): void => {
    result[index] = field;
    taken.add(field);
    open[index] = false;
  };

  keys.forEach((key, index) => {
    if (!open[index]) return;
    const decisive = DECISIVE.find(([pattern]) => pattern.test(key));
    if (!decisive) return;
    if (!taken.has(decisive[1])) claim(index, decisive[1]);
    else open[index] = false; // spoken for — leave it unmapped rather than guess
  });

  keys.forEach((key, index) => {
    if (!open[index]) return;
    const field = IMPORT_FIELDS.find(
      (candidate) => !taken.has(candidate) && SYNONYMS[candidate].some((synonym) => normalise(synonym) === key),
    );
    if (field) claim(index, field);
  });

  keys.forEach((key, index) => {
    if (!open[index]) return;
    const field = IMPORT_FIELDS.find(
      (candidate) =>
        !taken.has(candidate) &&
        SYNONYMS[candidate].some((synonym) => {
          const word = normalise(synonym);
          // Length guard: without it a two-letter synonym like "to" matches almost
          // any header that happens to contain those letters.
          if (word.length < 3) return false;
          return key.includes(word) || (key.length >= 3 && word.includes(key));
        }),
    );
    if (field) claim(index, field);
  });

  return result;
}

/* ── finding the header row ───────────────────────────────────────────────── */

/**
 * Cells that describe the column rather than fill it. DXG's Preseria template puts
 * two such rows under the headers ("max 255 chars.", "REQUIRED"), and reading them as
 * sessions produced a talk called "max 255 chars." in a room called "max 100 chars.".
 */
const ANNOTATION = [
  /^(required|optional)$/i,
  /^max \d+ chars\.?$/i,
  /^(mm\/dd\/yyyy|dd\/mm\/yyyy|yyyy-mm-dd)$/i,
  /^h?h:mm(\s*(am\/pm))?$/i,
  /^number\s*\(/i,
];

const isAnnotationRow = (row: string[]): boolean => {
  const filled = row.map((cell) => cell.trim()).filter(Boolean);
  if (filled.length === 0) return false;
  const marked = filled.filter((cell) => ANNOTATION.some((pattern) => pattern.test(cell))).length;
  // A clear majority, not merely one cell: a real session whose title happens to read
  // like a format hint must still reach validation and be seen.
  return marked / filled.length >= 0.6;
};

export type HeaderRow = { index: number; headers: string[]; firstDataRow: number };

/**
 * Vendor templates open with a banner ("PRESERIA IMPORT TEMPLATE … Version: v.1.3"),
 * so the header row is not row 1. `buildPreview` used to destructure
 * `const [headers, ...dataRows] = sheet`, which mapped the banner as the header and
 * fed the annotation rows in as data.
 *
 * The row that maps to the most known fields wins. Only the first few rows are
 * considered — a header further down is a differently broken file, and guessing
 * deeper would risk skipping real sessions silently.
 */
export function findHeaderRow(sheet: string[][], searchDepth = 5): HeaderRow {
  let best = { index: 0, score: -1 };
  sheet.slice(0, searchDepth).forEach((row, index) => {
    const score = autoMap(row).filter(Boolean).length;
    if (score > best.score) best = { index, score };
  });

  const headers = sheet[best.index] ?? [];
  let firstDataRow = best.index + 1;
  while (firstDataRow < sheet.length && isAnnotationRow(sheet[firstDataRow]!)) firstDataRow += 1;
  return { index: best.index, headers, firstDataRow };
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

/**
 * The calendar date a human wrote, never an instant.
 *
 * This used to go through `new Date(value).toISOString().slice(0, 10)`, which resolves
 * the string as an instant in the *server's* timezone and then reads the date back in
 * UTC. Anywhere east of Greenwich that is the previous day: in Asia/Dhaka (UTC+6),
 * `03/01/2026` came back as `2026-02-28`. Production runs on UTC and would never have
 * shown it, so every agenda imported on a developer machine was quietly a day early.
 *
 * The date parts are read with the same clock that parsed them, so no offset is ever
 * applied. `mm/dd/yyyy` — what DXG's template uses — is matched explicitly rather than
 * left to the engine, since that is the one format whose meaning is genuinely
 * ambiguous between locales.
 */
export function toCalendarDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Excel serials are day counts from an epoch, so UTC is exact here.
  if (/^\d+(\.\d+)?$/.test(trimmed)) return excelSerialToDate(Number(trimmed)).slice(0, 10);

  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slashed) {
    const [, month, day, year] = slashed;
    return `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
  }

  const dashed = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (dashed) return dashed[0].slice(0, 10);

  // Anything else ("May 16 2023") goes to the engine, but the parts are read back
  // with the local getters that parsed it rather than through UTC.
  const loose = new Date(trimmed);
  if (Number.isNaN(loose.getTime())) return null;
  return [
    String(loose.getFullYear()),
    String(loose.getMonth() + 1).padStart(2, "0"),
    String(loose.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Accepts ISO dates, common written dates, and Excel serial numbers. */
export function toDateTime(date: string, time: string): string | null {
  if (!date) return null;
  const iso = toCalendarDate(date);
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
  // The header row is found rather than assumed: vendor templates open with a banner
  // and put annotation rows ("max 255 chars.", "REQUIRED") under the real headers.
  const { headers, firstDataRow } = findHeaderRow(sheet);
  const dataRows = sheet.slice(firstDataRow);
  if (headers.length === 0 || dataRows.length === 0) {
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
    // The row number the operator sees in their spreadsheet, so an error names a row
    // they can actually go and look at.
    const rowNumber = firstDataRow + index + 1;
    const title = cell(row, mapping, "session.title");
    const room = cell(row, mapping, "room.name");
    const date = cell(row, mapping, "session.date");
    const start = cell(row, mapping, "session.start");
    const end = cell(row, mapping, "session.end");
    // A sheet either carries one name column or splits it. DXG's template splits it,
    // so first and last are joined here rather than in the mapping layer.
    const speakerName =
      cell(row, mapping, "speaker.name") ||
      [cell(row, mapping, "speaker.first_name"), cell(row, mapping, "speaker.last_name")]
        .filter(Boolean)
        .join(" ");
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

    if (!speakerName && speakerEmail) {
      issues.push({
        row: rowNumber,
        column: "speaker.name",
        severity: "warning",
        message: "No presenter name — the session imports and the address is kept, but mail will not be personalised.",
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

/**
 * A display name for a presenter identified only by an address. It never invents a
 * surname: `wallace@branch-productions.com` becomes `Wallace`, not `Wallace Branch`.
 * Deliberately plain, so it reads as something to correct on the Speakers screen
 * rather than as a real name someone typed.
 */
export function provisionalName(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

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

    /*
     * DXG's template fills the presenter's email and leaves the name columns empty on
     * every row. Keyed on the name alone, that imported the whole agenda with no
     * speakers and no assignments at all — the sessions arrived and nobody could be
     * invited to fill them, which is the entire point of the import.
     *
     * `speakers.full_name` is NOT NULL, so a provisional name is derived from the
     * address rather than the row being dropped.
     */
    const displayName = row.speaker_name || provisionalName(row.speaker_email);
    if (displayName) {
      const { rows: speakerRows } = await tx.query<{ id: string }>(
        row.speaker_email
          ? `SELECT id FROM pmp.speakers WHERE event_id = $1 AND lower(email::text) = lower($2) AND merged_into IS NULL`
          : `SELECT id FROM pmp.speakers WHERE event_id = $1 AND lower(full_name) = lower($2) AND merged_into IS NULL`,
        [input.eventId, row.speaker_email || displayName],
      );
      let speakerId = speakerRows[0]?.id;
      if (!speakerId) {
        const { rows: inserted } = await tx.query<{ id: string }>(
          `INSERT INTO pmp.speakers (client_id, event_id, email, full_name, organization)
           VALUES ($1,$2,NULLIF($3,'')::citext,$4,NULLIF($5,'')) RETURNING id`,
          [clientId, input.eventId, row.speaker_email, displayName, row.organization],
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
