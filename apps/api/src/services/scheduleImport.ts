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
  // The presentation's own time inside its session (D-031).
  "slot.start",
  "slot.end",
  "slot.duration",
  // Further presenters on the same slot. `speaker_assignments` has always allowed
  // several speakers per slot; until now the import only ever created one.
  "speaker2.first_name",
  "speaker2.last_name",
  "speaker2.email",
  "speaker3.first_name",
  "speaker3.last_name",
  "speaker3.email",
  "speaker4.first_name",
  "speaker4.last_name",
  "speaker4.email",
  "speaker5.first_name",
  "speaker5.last_name",
  "speaker5.email",
  "speaker6.first_name",
  "speaker6.last_name",
  "speaker6.email",
] as const;

/**
 * The prefixes of the presenter blocks, in order. A talk with more than six presenters
 * is a panel, and the schema allows one — but an import screen has to stop somewhere,
 * and six columns of each kind is already more than any DXG sheet has carried.
 *
 * Note the first is `speaker`, not `speaker1`: it predates there being more than one.
 */
export const PRESENTER_PREFIXES = ["speaker", "speaker2", "speaker3", "speaker4", "speaker5", "speaker6"] as const;

const presenterField = (prefix: string, part: "first_name" | "last_name" | "email"): ImportField =>
  `${prefix}.${part}` as ImportField;
export type ImportField = (typeof IMPORT_FIELDS)[number];

const SYNONYMS: Record<ImportField, string[]> = {
  // Not bare "session": "Session Start" contains it, and claimed the title on the
  // substring pass whenever a sheet had no explicit title column to take it first.
  "session.title": ["session title", "title", "talk"],
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
  "slot.start": ["presentation start"],
  "slot.end": ["presentation end"],
  "slot.duration": ["presentation duration", "duration"],
  "speaker2.first_name": ["presenter 2 first name", "speaker 2 first name"],
  "speaker2.last_name": ["presenter 2 last name", "speaker 2 last name"],
  "speaker2.email": ["presenter 2 email", "speaker 2 email"],
  "speaker3.first_name": ["presenter 3 first name", "speaker 3 first name"],
  "speaker3.last_name": ["presenter 3 last name", "speaker 3 last name"],
  "speaker3.email": ["presenter 3 email", "speaker 3 email"],
  "speaker4.first_name": ["presenter 4 first name", "speaker 4 first name"],
  "speaker4.last_name": ["presenter 4 last name", "speaker 4 last name"],
  "speaker4.email": ["presenter 4 email", "speaker 4 email"],
  "speaker5.first_name": ["presenter 5 first name", "speaker 5 first name"],
  "speaker5.last_name": ["presenter 5 last name", "speaker 5 last name"],
  "speaker5.email": ["presenter 5 email", "speaker 5 email"],
  "speaker6.first_name": ["presenter 6 first name", "speaker 6 first name"],
  "speaker6.last_name": ["presenter 6 last name", "speaker 6 last name"],
  "speaker6.email": ["presenter 6 email", "speaker 6 email"],
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
 *
 * Each entry lists the field for the first column of that kind and, where there is
 * one, the field for the second. **Which presenter a column belongs to is decided by
 * the order the columns appear, not by the number in the heading** — DXG's sheet
 * labels presenter 1's surname `Presenter 2 Last Name` (D-029), so trusting the label
 * would file it under the second presenter and leave the first with no surname. The
 * positional rule reads that sheet and our corrected one identically.
 */
const DECISIVE: { pattern: RegExp; fields: ImportField[] }[] = [
  // Checked before the plain start/end rules: "Presentation Start" is the slot's time,
  // "Session Start" is the session's, and only the qualifier tells them apart.
  { pattern: /\bpresentation\s+start\b/, fields: ["slot.start"] },
  { pattern: /\bpresentation\s+end\b/, fields: ["slot.end"] },
  { pattern: /\bduration\b/, fields: ["slot.duration"] },
  // After the presentation rules above, so the qualifier decides which time a column
  // is. Decisive rather than left to the substring pass, because "Session Start" would
  // otherwise be matched by whatever loose synonym happened to come first.
  { pattern: /\bstarts?\b/, fields: ["session.start"] },
  { pattern: /\bends?\b|\bfinish(es)?\b/, fields: ["session.end"] },
  { pattern: /\b(e\s*mail|email)\b/, fields: PRESENTER_PREFIXES.map((p) => presenterField(p, "email")) },
  {
    pattern: /\b(first|given)\s*name\b|\bforename\b/,
    fields: PRESENTER_PREFIXES.map((p) => presenterField(p, "first_name")),
  },
  {
    pattern: /\b(last|family)\s*name\b|\bsurname\b/,
    fields: PRESENTER_PREFIXES.map((p) => presenterField(p, "last_name")),
  },
  // Our own template's "Presenter Organization" mapped to `speaker.name`, because the
  // substring pass tries `speaker.name` first and the header contains "presenter".
  // The organization then became the speaker's display name and the first/last name
  // columns were discarded — mapped, but beaten by the `speaker.name ||` precedence.
  { pattern: /\b(organisation|organization|company|affiliation)\b/, fields: ["speaker.organization"] },
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
    const decisive = DECISIVE.find((rule) => rule.pattern.test(key));
    if (!decisive) return;
    // The first unclaimed field of this kind: the first email column is presenter 1's,
    // the second is presenter 2's, whatever the headings call them.
    const field = decisive.fields.find((candidate) => !taken.has(candidate));
    if (field) claim(index, field);
    else open[index] = false; // all spoken for — unmapped rather than guessed
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

/* ── the blank template we hand out ────────────────────────────────── */

/**
 * The columns of DXG's own agenda sheet (the Preseria import template, v.1.3), in its
 * order, with its format hints and its REQUIRED/OPTIONAL row.
 *
 * Matching it exactly is the point: this is the sheet event organisers already receive
 * and fill in, so a template of ours with different columns would be a second format
 * to reconcile rather than a help. `field` is what the importer reads the column as —
 * `null` means we recognise the column and deliberately do not map it.
 */
const TEMPLATE_COLUMNS: { heading: string; field: ImportField | null; hint: string; required: boolean }[] = [
  { heading: "Session Title", field: "session.title", hint: "max 255 chars.", required: true },
  { heading: "Session Location", field: "room.name", hint: "max 100 chars.", required: true },
  { heading: "Session Date", field: "session.date", hint: "mm/dd/yyyy", required: true },
  { heading: "Session Start", field: "session.start", hint: "h:mm AM/PM", required: true },
  { heading: "Session End", field: "session.end", hint: "h:mm AM/PM", required: true },
  /*
   * A Preseria "session" can hold several presentations, and these three describe a
   * presentation inside one — which is what a slot is. `slots` gained its own times in
   * migration 010 so these could land somewhere instead of being read as nothing.
   */
  { heading: "Presentation Start", field: "slot.start", hint: "h:mm AM/PM", required: false },
  { heading: "Presentation End", field: "slot.end", hint: "h:mm AM/PM", required: false },
  { heading: "Presentation Duration", field: "slot.duration", hint: "number ( 0 - 999 min. )", required: false },
  { heading: "Presenter 1 Email", field: "speaker.email", hint: "max 80 chars.", required: true },
  { heading: "Presenter 1 First Name", field: "speaker.first_name", hint: "max 80 chars.", required: true },
  /*
   * DXG's sheet labels this one "Presenter 2 Last Name", which is a mistake at source:
   * it sits between "Presenter 1 First Name" and "Presenter 2 Email" and is marked
   * REQUIRED, where presenter 2's fields are all optional. It is presenter 1's surname.
   *
   * Ours says so. Reproducing the wrong label would invite organisers to put the second
   * presenter's surname in the first presenter's column — a data fault we would be
   * manufacturing, in a template we hand out. Files still carrying the original label
   * import identically, because the mapper takes the first unclaimed match.
   */
  { heading: "Presenter 1 Last Name", field: "speaker.last_name", hint: "max 80 chars.", required: true },
  /*
   * A second presenter is a second row in `speaker_assignments`, which has always
   * allowed several speakers per slot. These were carried-but-unmapped until D-031.
   */
  { heading: "Presenter 2 Email", field: "speaker2.email", hint: "max 80 chars.", required: false },
  { heading: "Presenter 2 First Name", field: "speaker2.first_name", hint: "max 80 chars.", required: false },
  { heading: "Presenter 2 Last Name", field: "speaker2.last_name", hint: "max 80 chars.", required: false },
];

const csvCell = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/**
 * The agenda template, as CSV.
 *
 * It deliberately mirrors the vendor template's shape — a banner row, then headings,
 * then a format-hint row and a REQUIRED/OPTIONAL row — because that is the layout DXG
 * already works in, and because `findHeaderRow` has to cope with exactly this shape
 * anyway. Handing out a template the importer reads by a different path than the files
 * it actually receives would mean testing the easy case forever.
 *
 * The example row is annotation too, and is dropped on import for the same reason the
 * hint rows are: it is marked EXAMPLE in the first cell.
 */
export function agendaTemplateCsv(eventName?: string): string {
  const banner = [
    `DXG AGENDA TEMPLATE (US Date/Time Format)${eventName ? ` \u2014 ${eventName}` : ""}`,
    "Version: 1",
    "Date Format: mm/dd/yyyy",
    "Time Format: h:mm AM/PM",
    "The three rows below the headings are guidance \u2014 delete them or leave them, they are ignored",
  ];
  const pad = (row: string[]): string[] => [
    ...row,
    ...Array(Math.max(0, TEMPLATE_COLUMNS.length - row.length)).fill(""),
  ];
  const rows = [
    pad(banner),
    TEMPLATE_COLUMNS.map((column) => column.heading),
    TEMPLATE_COLUMNS.map((column) => column.hint),
    TEMPLATE_COLUMNS.map((column) => (column.required ? "REQUIRED" : "OPTIONAL")),
    pad([
      "EXAMPLE \u2014 delete this row",
      "Ballroom A",
      "03/14/2027",
      "9:00 AM",
      "10:00 AM",
      "", // Presentation Start
      "", // Presentation End
      "", // Presentation Duration
      "presenter@example.com",
      "Alex",
      "Okonkwo",
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/**
 * The starting point for an agenda typed in rather than uploaded: the template's
 * headings and nothing else.
 *
 * A manual agenda is the same import as a file one, with an empty file — which keeps
 * one validation path, one commit and one row editor for both. The rows themselves
 * come from `buildPreview`'s `blankRows`, since a row of empty cells does not survive
 * parsing.
 */
export function manualAgendaCsv(): string {
  return TEMPLATE_COLUMNS.map((column) => csvCell(column.heading)).join(",") + "\r\n";
}

/* ── finding the header row ───────────────────────────────────────────────── */

/**
 * Cells that describe the column rather than fill it. DXG's Preseria template puts
 * two such rows under the headers ("max 255 chars.", "REQUIRED"), and reading them as
 * sessions produced a talk called "max 255 chars." in a room called "max 100 chars.".
 */
const ANNOTATION = [
  /^(required|optional)$/i,
  /^(room or venue name|name@example\.com|max \d+ chars\.?)$/i,
  /^max \d+ chars\.?$/i,
  /^(mm\/dd\/yyyy|dd\/mm\/yyyy|yyyy-mm-dd)$/i,
  /^h?h:mm(\s*(am\/pm))?$/i,
  /^number\s*\(/i,
];

/**
 * Our own template's sample row, so someone who fills the file in underneath it
 * without deleting it does not import a session called "EXAMPLE — delete this row".
 *
 * Keyed on the first cell alone, because the ratio rule below cannot see it: a
 * demonstration row is *made of* plausible session data, and only its title gives it
 * away — two of its ten cells look like annotation, which is nowhere near a majority.
 */
const isExampleRow = (row: string[]): boolean => /^example\b/i.test((row[0] ?? "").trim());

const isAnnotationRow = (row: string[]): boolean => {
  const filled = row.map((cell) => cell.trim()).filter(Boolean);
  if (filled.length === 0) return false;
  if (isExampleRow(row)) return true;
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
  /**
   * Every mapped field's current cell value, after any correction the operator has
   * typed. This is what the row editor shows and edits: the whole row as the file
   * states it, not the handful of derived values the table happens to display.
   */
  cells: Partial<Record<ImportField, string>>;
  /** Which of REQUIRED_FIELDS this row still has no usable value for. */
  missing: string[];
  starts_at: string | null;
  ends_at: string | null;
  /** The presentation's own time inside the session, when the file gives one. */
  slot_starts_at: string | null;
  slot_ends_at: string | null;
  speaker_name: string;
  speaker_email: string;
  /**
   * Everyone presenting this slot, presenter 1 first. One entry per filled presenter
   * block; a block naming nobody is skipped rather than carried as a blank.
   */
  presenters: { name: string; email: string }[];
  organization: string;
  track: string;
  action: "create" | "update" | "unchanged";
};

/**
 * Cells the operator typed on the review screen, keyed by the row number they see.
 *
 * They are expressed as *cell values* — exactly what the spreadsheet would have said —
 * rather than as finished domain values, so a correction re-enters `buildPreview` at
 * the same point the file did. Nothing about parsing dates, resolving the venue's
 * timezone or recomputing the (room, start, title) match key has to be repeated in the
 * browser, and a fixed row is validated by the same code that rejected it.
 */
export type RowOverrides = Record<number, Partial<Record<ImportField, string>>>;

/** Without these a row cannot become a session, so the commit refuses it. */
/*
 * `session.end` was missing from this list while `TEMPLATE_COLUMNS` marked it REQUIRED
 * and DXG's own sheet prints REQUIRED under it — the same split the fifty-third entry
 * found for `session.start`, and this one had a database constraint behind it.
 * `endsAt` falls back to the start when no end is given, `sessions` carries
 * CHECK (ends_at > starts_at), and so a file with no Session End column passed the
 * preview with no blocking errors and failed the commit with a 500 naming no row.
 */
export const REQUIRED_FIELDS = [
  "session.title",
  "room.name",
  "session.date",
  "session.start",
  "session.end",
] as const;

export type ImportPreview = {
  import_id: string;
  file_name: string;
  /** The event's timezone, so the screen renders and edits times in it, not the browser's. */
  timezone: string;
  required_fields: readonly string[];
  headers: string[];
  mapping: (ImportField | null)[];
  total_rows: number;
  blocking: number;
  warnings: number;
  new_speakers: number;
  counts: { create: number; update: number; unchanged: number };
  issues: RowIssue[];
  rows: StagedRow[];
  /** Row numbers the operator removed; absent from `rows` and never committed. */
  excluded: readonly number[];
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
  /*
   * An absent clock used to default to 09:00. That invented a start time for any
   * session whose time cell was blank — and because the row then had a usable
   * `starts_at`, it also passed the required-field check that the template's REQUIRED
   * row and the row editor both promise to enforce. On the optional
   * `Presentation Start` it invented a slot time on every row that left it empty.
   */
  if (!clock) return null;
  const match = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(clock);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
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
    overrides?: RowOverrides;
    /**
     * Rows the operator is typing in rather than importing (D-045), appended after whatever
     * the file carried. They start empty and are filled through `overrides`, exactly
     * as a correction to a file's own row is — so a typed row is parsed, converted to
     * the venue's timezone and validated by the code that reads a spreadsheet, not by
     * a second implementation of it.
     *
     * Added here rather than as blank lines in the body because `parseCsv` drops rows
     * whose every cell is empty: a blank row written into the file would never survive
     * to be filled in.
     */
    blankRows?: number;
    /**
     * Rows the operator has taken out, by row number.
     *
     * Taken out rather than renumbered: a file's row numbers are the file's, and an
     * error that names row 12 has to mean the twelfth row of the spreadsheet the
     * operator is looking at. Shifting the rows below a removal would also detach
     * every correction typed into them, since `overrides` is keyed by row number.
     * Skipping is what leaves both intact.
     */
    excluded?: readonly number[];
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
  const dataRows = [
    ...sheet.slice(firstDataRow),
    ...Array.from({ length: Math.max(0, input.blankRows ?? 0) }, (): string[] => []),
  ];
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

    // Before anything is read from it: a removed row is not a row with no problems,
    // it is absent — from the table, the counts, the issue list and the commit.
    if (input.excluded?.includes(rowNumber)) return;

    /*
     * A cell the operator typed on the review screen wins over the file's. Read here,
     * at the single point every field is pulled from the row, so an override is
     * indistinguishable from the file having said it — including for the match key and
     * the timezone conversion below.
     */
    const patch = input.overrides?.[rowNumber];
    const at = (field: ImportField): string =>
      (patch?.[field] ?? cell(row, mapping, field)).trim();

    const title = at("session.title");
    const room = at("room.name");
    const date = at("session.date");
    const start = at("session.start");
    const end = at("session.end");
    // A sheet either carries one name column or splits it. DXG's template splits it,
    // so first and last are joined here rather than in the mapping layer.
    const speakerName =
      at("speaker.name") ||
      [at("speaker.first_name"), at("speaker.last_name")].filter(Boolean).join(" ");
    const speakerEmail = at("speaker.email");

    /*
     * Everyone this row names, presenter 1 first. Computed here rather than further
     * down because the new-speaker count below needs it: counting only presenter 1 is
     * what made the count say 5 for a file that created 6.
     */
    const presenters = PRESENTER_PREFIXES.map((prefix) => ({
      name: [at(`${prefix}.first_name` as ImportField), at(`${prefix}.last_name` as ImportField)]
        .filter(Boolean)
        .join(" "),
      email: at(`${prefix}.email` as ImportField),
    })).filter((presenter) => presenter.name || presenter.email);

    if (!title) {
      issues.push({ row: rowNumber, column: "session.title", severity: "blocking", message: "Session title is empty." });
    }

    if (!room) {
      issues.push({
        row: rowNumber,
        column: "room.name",
        severity: "blocking",
        message: "Session location is empty.",
      });
    } else if (roomNames.length > 0 && !roomNames.some((name) => normalise(name) === normalise(room))) {
      /*
       * A location the event does not have yet is not an error (D-050).
       *
       * This was blocking, on the reasoning that an unrecognised room is a typo. It
       * cannot tell a typo from a location that is simply new — "Virtual" is not a
       * misspelling of anything — and the agenda is the authority on where a session
       * happens. An event's first import defines its locations; every later one was
       * forbidden from adding another, so an agenda with online sessions could not be
       * imported at all.
       *
       * The typo case survives as advice rather than a refusal. `closestRoom` is
       * deliberately narrow — within an edit distance of two, and silent when two
       * rooms are equally close — so a suggestion means "you probably meant this",
       * and its absence means the name looks nothing like anything here, which is
       * what a genuinely new location looks like.
       */
      const suggestion = closestRoom(room, roomNames);
      issues.push({
        row: rowNumber,
        column: "room.name",
        severity: "warning",
        message: suggestion
          ? `Session location “${room}” is not on this event. Did you mean ${suggestion}?`
          : `Session location “${room}” is new — it will be added to this event.`,
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

    /*
     * A window that runs backwards is refused here because the database refuses it
     * anyway — `sessions` has CHECK (ends_at > starts_at) and `slots` has
     * CHECK (ends_at >= starts_at). Without this the row passed the preview with no
     * blocking errors and the commit failed with "Unexpected server error", naming no
     * row, after the operator had already reviewed and pressed Import. A rule the
     * database holds and the screen does not is a rule the operator meets at the worst
     * possible moment.
     */
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      issues.push({
        row: rowNumber,
        column: "session.end",
        severity: "blocking",
        message: `The session ends at ${end} and starts at ${start} — it cannot end before it starts.`,
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
    /*
     * Everyone the row names, not just presenter 1. The count said 5 for a file that
     * created 6 speakers — a co-presenter was invisible to the number an operator uses
     * to decide whether to commit, which is the one job that number has.
     */
    for (const presenter of presenters) {
      const address = presenter.email.toLowerCase();
      if (address && !existingEmails.has(address)) newSpeakers.add(address);
    }

    /*
     * The presentation's own time. `Presentation Duration` is minutes, and is only
     * consulted when no end time was given — a sheet carrying both and disagreeing
     * means the published end wins, since that is the one an attendee was told.
     */
    const slotStartText = at("slot.start");
    const slotStart = slotStartText ? toDateTime(date, slotStartText) : null;
    const durationText = at("slot.duration");
    const durationMinutes = /^\d{1,3}$/.test(durationText) ? Number(durationText) : null;
    const slotEndText = at("slot.end");
    let slotEnd = slotEndText ? toDateTime(date, slotEndText) : null;
    if (!slotEnd && slotStart && durationMinutes !== null) {
      const from = zonedToUtc(slotStart, timeZone);
      slotEnd = new Date(from.getTime() + durationMinutes * 60_000).toISOString();
    }
    // Only when the file gave both: an end derived from a duration cannot precede its
    // own start, since a duration is a positive number of minutes.
    if (slotStart && slotEndText && slotEnd && new Date(slotEnd) < new Date(slotStart)) {
      issues.push({
        row: rowNumber,
        column: "slot.end",
        severity: "blocking",
        message: `The presentation ends at ${slotEndText} and starts at ${slotStartText} — it cannot end before it starts.`,
      });
    }

    /*
     * A presentation happens *inside* its session, so its window has to sit within the
     * session's. Nothing in the database enforces this — `slots` and `sessions` carry
     * their times independently — which is exactly why it belongs here: a talk
     * recorded as starting before the room opens or running past the session it
     * belongs to is wrong in a way no constraint will ever catch, and it would reach
     * the room schedule and the speaker's portal looking authoritative.
     *
     * Compared as absolute instants, because an end derived from a duration is already
     * UTC while one read from a cell is still wall-clock in the event's zone.
     */
    const asInstant = (value: string): number =>
      new Date(value.endsWith("Z") ? value : zonedToUtc(value, timeZone).toISOString()).getTime();

    if (startsAt && endsAt && (slotStart || slotEnd)) {
      const sessionFrom = asInstant(startsAt);
      const sessionTo = asInstant(endsAt);
      if (slotStart && asInstant(slotStart) < sessionFrom) {
        issues.push({
          row: rowNumber,
          column: "slot.start",
          severity: "blocking",
          message: `The presentation starts at ${slotStartText}, before its session starts at ${start}.`,
        });
      }
      if (slotEnd && asInstant(slotEnd) > sessionTo) {
        issues.push({
          row: rowNumber,
          column: "slot.end",
          severity: "blocking",
          message: slotEndText
            ? `The presentation ends at ${slotEndText}, after its session ends at ${end}.`
            : `The presentation runs ${durationMinutes} minutes from ${slotStartText}, which ends after its session ends at ${end}.`,
        });
      }
    }
    if (at("slot.start") && !slotStart) {
      issues.push({
        row: rowNumber,
        column: "slot.start",
        severity: "warning",
        message: `Could not read a presentation start time from \u201c${at("slot.start")}\u201d — the session's own time is used instead.`,
      });
    }


    const key = `${normalise(room)}|${startsAt ? zonedToUtc(startsAt, timeZone).toISOString() : ""}|${normalise(title)}`;
    const match = existingKeys.get(key);

    /*
     * Named per field rather than as one "incomplete" flag, so the screen can put an
     * input exactly where the value is missing instead of making the operator hunt
     * through a row for what is wrong. A date that could not be parsed counts as
     * missing: the cell is there, but nothing usable came out of it.
     */
    const missing: string[] = [];
    if (!title) missing.push("session.title");
    if (!room) missing.push("room.name");
    // One check, two fields: a start instant needs both cells, and neither is usable
    // on its own. An unparseable date counts as missing — the cell is there, but
    // nothing came out of it.
    if (!startsAt) missing.push("session.date", "session.start");
    /*
     * `missing` is written out field by field rather than derived from
     * REQUIRED_FIELDS, because one parse covers two of them — and that is exactly how
     * `session.end` came to be REQUIRED in the template, REQUIRED on DXG's own sheet,
     * and absent from this list. Adding it to the constant alone changed what the
     * template prints and nothing about what the screen enforces.
     */
    if (!end.trim()) missing.push("session.end");

    staged.push({
      row: rowNumber,
      title,
      room,
      cells: Object.fromEntries(IMPORT_FIELDS.map((field) => [field, at(field)])),
      missing,
      // Stored as an absolute instant; the spreadsheet's wall-clock time is
      // interpreted in the event's timezone.
      starts_at: startsAt ? zonedToUtc(startsAt, timeZone).toISOString() : null,
      ends_at: endsAt ? zonedToUtc(endsAt, timeZone).toISOString() : null,
      slot_starts_at: slotStart ? zonedToUtc(slotStart, timeZone).toISOString() : null,
      // Already absolute when derived from a duration; converted when read from a cell.
      slot_ends_at: slotEnd
        ? slotEnd.endsWith("Z")
          ? slotEnd
          : zonedToUtc(slotEnd, timeZone).toISOString()
        : null,
      presenters,
      speaker_name: speakerName,
      speaker_email: speakerEmail,
      organization: at("speaker.organization"),
      track: at("track.name"),
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
    timezone: timeZone,
    required_fields: REQUIRED_FIELDS,
    headers,
    mapping,
    total_rows: staged.length,
    blocking: issues.filter((issue) => issue.severity === "blocking").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    new_speakers: newSpeakers.size,
    counts,
    issues,
    rows: staged,
    excluded: input.excluded ?? [],
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

  /*
   * The event's locations, read once and keyed the way `buildPreview` compares them.
   *
   * Not the per-row `lower(name) = lower(...)` lookup this used to do: `normalise`
   * also folds separators and repeated spaces, and matching on `lower()` alone let
   * "Main  Hall" miss the lookup and be created a second time beside "Main Hall".
   * Now that an unrecognised location is created rather than refused (D-050), this
   * is the only thing standing between a stray double space and a duplicate.
   */
  const { rows: roomRows } = await tx.query<{ id: string; name: string }>(
    `SELECT id, name FROM pmp.rooms WHERE event_id = $1`,
    [input.eventId],
  );
  const roomIds = new Map(roomRows.map((room) => [normalise(room.name), room.id]));


  /*
   * This check is made against the instants about to be inserted rather than against
   * the preview's issue list, which this function never sees: the rows arrive from the
   * browser and a client is not a place to hold a rule. `sessions` carries
   * CHECK (ends_at > starts_at) and `slots` CHECK (ends_at >= starts_at), so a
   * backwards window — or a session whose end is missing, which makes `ends_at` equal
   * its own start — used to pass every check here and fail at the INSERT: a 500 and
   * "Unexpected server error", after the operator had reviewed the file and pressed
   * Import, naming no row.
   */
  const impossible = (row: StagedRow): boolean => {
    const at = (value: string | null) => (value === null ? null : new Date(value).getTime());
    const from = at(row.starts_at);
    const to = at(row.ends_at);
    const slotFrom = at(row.slot_starts_at);
    const slotTo = at(row.slot_ends_at);

    // A window that runs backwards, which the database would refuse.
    if (from !== null && to !== null && to <= from) return true;
    if (slotFrom !== null && slotTo !== null && slotTo < slotFrom) return true;
    // A presentation outside the session it belongs to, which nothing would refuse.
    if (from !== null && slotFrom !== null && slotFrom < from) return true;
    if (to !== null && slotTo !== null && slotTo > to) return true;
    return false;
  };

  const blocking = input.rows.filter(
    (row) => !row.title || !row.room || !row.starts_at || impossible(row),
  );
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
    let roomId = roomIds.get(normalise(row.room));
    if (!roomId) {
      // A location the event does not have yet, which the agenda is the authority on
      // (D-050). Recorded in the map as well as the table, so a second row naming the
      // same new location joins it instead of creating it twice.
      const { rows: inserted } = await tx.query<{ id: string }>(
        `INSERT INTO pmp.rooms (event_id, client_id, name) VALUES ($1, $2, $3) RETURNING id`,
        [input.eventId, clientId, row.room],
      );
      roomId = inserted[0]!.id;
      roomIds.set(normalise(row.room), roomId);
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
      // A slot's own time can arrive in a later revision of the agenda, so it is
      // applied on update too. COALESCE keeps a time the file no longer carries
      // rather than silently clearing one somebody is relying on.
      if (row.slot_starts_at || row.slot_ends_at) {
        await tx.query(
          `UPDATE pmp.slots SET starts_at = COALESCE($2::timestamptz, starts_at),
                                ends_at   = COALESCE($3::timestamptz, ends_at)
            WHERE id = $1`,
          [slotId, row.slot_starts_at, row.slot_ends_at],
        );
      }
    } else {
      const { rows: sessionRows } = await tx.query<{ id: string }>(
        `INSERT INTO pmp.sessions (event_id, client_id, room_id, track_id, day_id, title, starts_at, ends_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz, COALESCE($8::timestamptz, $7::timestamptz + interval '30 minutes'))
         RETURNING id`,
        [input.eventId, clientId, roomId, trackId, dayId, row.title, row.starts_at, row.ends_at],
      );
      const { rows: slotRows } = await tx.query<{ id: string }>(
        `INSERT INTO pmp.slots (session_id, event_id, client_id, title, starts_at, ends_at)
         VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz) RETURNING id`,
        [
          sessionRows[0]!.id,
          input.eventId,
          clientId,
          row.title,
          row.slot_starts_at,
          row.slot_ends_at,
        ],
      );
      slotId = slotRows[0]!.id;
      created += 1;
    }

    /*
     * Everyone on the slot, in the order the file names them.
     *
     * A second (or sixth) presenter is another row in `speaker_assignments`, not
     * another slot — people presenting one talk share the talk, its file and its
     * approval, which is exactly what that table expresses.
     *
     * DXG's template fills the presenter's email and leaves the name columns empty on
     * every row, so a presenter identified only by an address still has to become a
     * speaker: keyed on the name alone, that imported whole agendas with no speakers
     * and no assignments at all — sessions arrived and nobody could be invited to fill
     * them, which is the entire point of the import. `speakers.full_name` is NOT NULL,
     * so a provisional name is derived from the address rather than the row dropped.
     */
    for (const [index, presenter] of row.presenters.entries()) {
      const displayName = presenter.name || provisionalName(presenter.email);
      if (!displayName) continue;
      // The sheet has one organization column and it sits in presenter 1's block, so
      // it is presenter 1's. Applying it to everyone would put the first presenter's
      // employer against the name of every co-presenter.
      const organization = index === 0 ? row.organization : "";

      const { rows: found } = await tx.query<{ id: string }>(
        presenter.email
          ? `SELECT id FROM pmp.speakers WHERE event_id = $1 AND lower(email::text) = lower($2) AND merged_into IS NULL`
          : `SELECT id FROM pmp.speakers WHERE event_id = $1 AND lower(full_name) = lower($2) AND merged_into IS NULL`,
        [input.eventId, presenter.email || displayName],
      );

      let speakerId = found[0]?.id;
      if (!speakerId) {
        const { rows: inserted } = await tx.query<{ id: string }>(
          `INSERT INTO pmp.speakers (client_id, event_id, email, full_name, organization)
           VALUES ($1,$2,NULLIF($3,'')::citext,$4,NULLIF($5,'')) RETURNING id`,
          [clientId, input.eventId, presenter.email, displayName, organization],
        );
        speakerId = inserted[0]!.id;
      } else if (organization) {
        await tx.query(`UPDATE pmp.speakers SET organization = COALESCE(organization, $2) WHERE id = $1`, [
          speakerId,
          organization,
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
