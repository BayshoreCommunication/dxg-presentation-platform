"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportPreview, StagedRow } from "@/lib/api";
import {
  uploadImport,
  AGENDA_EXTENSIONS,
  AGENDA_MAX_BYTES,
  AGENDA_MAX_LABEL,
  startManualImport,
  addImportRow,
  removeImportRow,
  remapImport,
  commitImport,
  setImportCells,
  downloadAgendaTemplate,
  saveBlob,
  ApiError,
} from "@/lib/api";
import { formatBytes } from "@pmp/format";
import { Chip } from "@/components/Chip";
import { DateField, TimeField } from "@/components/DateTimeField";

/**
 * The headings DXG's own agenda sheet uses (D-029), so a field in this dialog and a
 * column in the spreadsheet are recognisably the same thing. They were labelled in
 * this platform's words — "Room / location", "Start time" — which read as different
 * fields to someone holding the sheet they were filled from.
 */
const FIELD_LABELS: Record<string, string> = {
  "session.title": "Session Title",
  "room.name": "Session Location",
  "session.date": "Session Date",
  "session.start": "Session Start",
  "session.end": "Session End",
  "slot.start": "Presentation Start",
  "slot.end": "Presentation End",
  "slot.duration": "Presentation Duration",
  "speaker.email": "Presenter 1 Email",
  "speaker.first_name": "Presenter 1 First Name",
  "speaker.last_name": "Presenter 1 Last Name",
  "speaker.name": "Presenter 1 Name",
  "track.name": "Track",
};

/**
 * What a presenter's fields are called when they sit under a "Presenter N" heading.
 * The heading already says which presenter it is, so the full name is repetition —
 * "Presenter 2 First Name" three times over, in a block titled "Presenter 2".
 *
 * `FIELD_LABELS` keeps the fully-qualified name, which is still what the input's
 * accessible name uses: a short visible label inside a longer accessible one is what
 * WCAG 2.5.3 asks for, and it keeps a field unambiguous when read out of context.
 */
const PRESENTER_SHORT_LABELS: Record<string, string> = {
  first_name: "First Name",
  last_name: "Last Name",
  email: "Email",
};

const shortLabel = (field: string): string | undefined =>
  PRESENTER_SHORT_LABELS[field.split(".")[1] ?? ""];

/**
 * The same, for the Presentation box: it is headed "Presentation" and then said
 * "Presentation Start", "Presentation End", "Presentation Duration" inside it.
 *
 * The Session box repeats itself the same way and is deliberately left alone: "Session
 * Start" and "Presentation Start" are the two fields in this dialog most easily
 * confused, and shortening both would leave the box heading as the only thing telling
 * them apart.
 */
const PRESENTATION_SHORT_LABELS: Record<string, string> = {
  "slot.start": "Start",
  "slot.end": "End",
  "slot.duration": "Duration",
};

/** Presenter 2 onwards, so a sixth presenter is labelled without listing eighteen keys. */
["speaker2", "speaker3", "speaker4", "speaker5", "speaker6"].forEach((prefix, index) => {
  const ordinal = index + 2;
  FIELD_LABELS[`${prefix}.email`] = `Presenter ${ordinal} Email`;
  FIELD_LABELS[`${prefix}.first_name`] = `Presenter ${ordinal} First Name`;
  FIELD_LABELS[`${prefix}.last_name`] = `Presenter ${ordinal} Last Name`;
});

/** The placeholder shows the shape a value has to take, not a second label. */
const FIELD_HINTS: Record<string, string> = {
  "session.date": "mm/dd/yyyy",
  "session.start": "h:mm AM/PM",
  "session.end": "h:mm AM/PM",
  "slot.start": "h:mm AM/PM",
  "slot.end": "h:mm AM/PM",
  "speaker.email": "name@example.com",
};

/**
 * `Track` is not in DXG's sheet (D-029) so it is not in the editor. The importer still
 * reads a Track column when a file happens to carry one; a row's value is preserved
 * because only changed cells are sent.
 */
const SESSION_TEXT_FIELDS = ["session.title", "room.name"];
const SESSION_WHEN_FIELDS = ["session.date", "session.start", "session.end"];
const PRESENTATION_FIELDS = ["slot.start", "slot.end", "slot.duration"];
/**
 * Mirrors PRESENTER_PREFIXES in the importer. The first is `speaker`, not `speaker1`:
 * it predates there being more than one.
 */
const PRESENTER_PREFIXES = ["speaker", "speaker2", "speaker3", "speaker4", "speaker5", "speaker6"];
const presenterFields = (prefix: string) => [
  `${prefix}.first_name`,
  `${prefix}.last_name`,
  `${prefix}.email`,
];

const TIME_FIELDS = new Set(["session.start", "session.end", "slot.start", "slot.end"]);
const DATE_FIELDS = new Set(["session.date"]);

/**
 * A clock cell as `<input type="time">` wants it. Returns null when the cell holds
 * something no picker can represent — `not-a-date`, a half-typed value — so the caller
 * can fall back to a text box rather than render an empty picker and quietly discard
 * the evidence of what was wrong.
 */
const toTimeInput = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const match = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(trimmed);
  if (!match) return null;
  let hour = Number(match[1]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
};

/** Minutes between two `HH:MM` clock values; negative when the second is earlier. */
const minutesBetween = (from: string, to: string): number => {
  const parts = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  return parts(to) - parts(from);
};

/** The same, for a date cell. `mm/dd/yyyy` in, ISO out; the importer reads both. */
const toDateInput = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slashed) {
    return `${slashed[3]}-${slashed[1]!.padStart(2, "0")}-${slashed[2]!.padStart(2, "0")}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
};

/**
 * Date and clock, split, so a table of sessions reads down its columns.
 *
 * Both take the event's timezone explicitly. The single helper these replaced had
 * `America/New_York` hardcoded, which quietly showed New York clock times for an event
 * in Berlin (SCREEN_SPECS §2: "no browser-local drift", and no other city's either).
 */
const day = (iso: string | null, timeZone: string) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone }) : "—";

const clock = (iso: string | null, timeZone: string) =>
  iso
    ? new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone })
    : "—";

/**
 * One titled block of the row editor, boxed off from its neighbours.
 *
 * The groups were headings over a continuous run of inputs, which read as one long
 * form: a session's end time and a presentation's start time sat adjacent and looked
 * like the same kind of thing, which is exactly the confusion the two sets of times
 * invite. Separating them costs a little height and removes the question.
 */
function Section({ heading, note, children }: { heading: string; note?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: "10px 12px 12px",
        marginBottom: 12,
      }}
    >
      <div className="kl" style={{ marginBottom: note ? 4 : 8 }}>
        {heading}
      </div>
      {note && (
        <div className="note" style={{ marginBottom: 8 }}>
          {note}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * The whole row, in a dialog, with every field the importer reads.
 *
 * It replaced an input rendered into the offending table cell. That was direct, but it
 * showed a value with nothing around it: an operator typing a room could not see the
 * session it belonged to, or the date beside it, which is exactly the context needed to
 * know *which* room it should be. Here the missing field is the one to fill and the
 * rest of the row is the evidence for what to put in it.
 */
function RowEditor({
  row,
  label,
  problems,
  timeZone,
  busy,
  onCancel,
  onSave,
}: {
  row: StagedRow;
  /** What this row is called on screen — not always `row.row`; see `rowLabel`. */
  label: number;
  problems: {
    column: string;
    severity: string;
    message: string;
    suggestion?: { field: string; value: string };
  }[];
  timeZone: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (cells: Record<string, string>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({ ...row.cells });
  /*
   * How many presenter blocks are shown. Everyone the file already named, and never
   * fewer than one — a talk has a presenter. Empty blocks are not shown by default:
   * eighteen boxes on every row of an eleven-row agenda is the noise D-030 removed.
   */
  const [presenterCount, setPresenterCount] = useState(() => {
    const filled = PRESENTER_PREFIXES.filter((prefix) =>
      presenterFields(prefix).some((field) => (row.cells[field] ?? "").trim() !== ""),
    ).length;
    return Math.max(1, filled);
  });

  /*
   * Travis: if there is any error, Save is disabled. Read from the inputs themselves
   * rather than from a second copy of the rules — `:invalid` is exactly the browser's
   * verdict on the `min`/`max` above, so the button and the red borders can never
   * disagree about whether the row is fixable.
   *
   * Deliberately *not* driven by `problems`, the issues the server returned for this
   * row: those are what the operator opened the dialog to fix, and disabling Save on
   * them would make a blocking row permanently unfixable.
   */
  const formRef = useRef<HTMLDivElement>(null);
  const [outOfRange, setOutOfRange] = useState(false);
  useEffect(() => {
    const el = formRef.current;
    // `input:invalid` is the browser's verdict on min/max; `[aria-invalid]` covers the
    // dropdowns, which hold an out-of-window value the file supplied rather than one
    // the operator could have chosen.
    if (el) setOutOfRange(el.querySelectorAll('input:invalid, [aria-invalid="true"]').length > 0);
  });

  const changed = Object.fromEntries(
    Object.entries(draft).filter(([field, value]) => (row.cells[field] ?? "") !== value),
  );

  /*
   * Leaving costs something only when something was typed. `changed` is already the
   * difference between the boxes and the row behind them, so it answers this too —
   * and it answers it for a session being invented as well as a row being corrected,
   * where the row behind is empty and every value is a change.
   */
  const dirty = Object.keys(changed).length > 0;
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  /*
   * Both ways out ask. The backdrop is the easier one to hit by accident — a click
   * anywhere outside the card — and it was the one that would have quietly thrown
   * away a filled-in session.
   */
  const leave = () => (dirty ? setConfirmingDiscard(true) : onCancel());
  const stillMissing = row.missing.filter((field) => !(draft[field] ?? "").trim());

  const set = (field: string, value: string) => setDraft({ ...draft, [field]: value });

  /** One labelled control, picking the input its field deserves. */
  const renderField = (field: string, visible?: string) => {
    const isMissing = row.missing.includes(field);
    const value = draft[field] ?? "";
    const empty = !value.trim();
    const border = isMissing && empty ? { borderColor: "var(--block)" } : {};
    const full = FIELD_LABELS[field] ?? field;

    const label = (
      <label htmlFor={`edit-${field}`}>
        {visible ?? full}
        {isMissing && <span style={{ color: "var(--block)" }}> · required</span>}
      </label>
    );

    if (field === "slot.duration") {
      /*
       * Read-only, and derived wherever it can be (D-040). A duration is stored
       * nowhere — no table has a column for it, and the importer only ever turns one
       * into an end time — so it is not a second fact about a presentation but a
       * second spelling of the one the Start and End already give. Two editable
       * spellings of one fact is how a row comes to read 5:10 PM → 5:25 PM beside
       * "55 min". Length is set by setting the times.
       *
       * It keeps the shape of the inputs it sits between rather than becoming a line
       * of prose: the three fields describe one thing, and a box among boxes is read
       * as part of the same group. Disabled rather than merely `readOnly`, so that it
       * looks unavailable as well as behaving that way.
       */
      const minutes = /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : null;
      const startClock = toTimeInput((draft["slot.start"] ?? "").trim());
      const endClock = toTimeInput((draft["slot.end"] ?? "").trim());
      const derived = startClock && endClock ? minutesBetween(startClock, endClock) : null;
      // Falls back to zero rather than to an empty box: a presentation with no times of
      // its own has no length of its own — it runs with its session — and "0 min" says
      // that in the same shape as every other value this field shows.
      const shown = derived ?? minutes ?? 0;

      return (
        <div className="field" key={field}>
          <label htmlFor={`edit-${field}`}>{visible ?? full}</label>
          <input
            id={`edit-${field}`}
            style={{ width: "100%" }}
            value={`${shown} min`}
            disabled
            readOnly
            aria-label={`${full} in minutes`}
          />
        </div>
      );
    }

    if (TIME_FIELDS.has(field) || DATE_FIELDS.has(field)) {
      const isDate = DATE_FIELDS.has(field);
      const picker = isDate ? toDateInput(value) : toTimeInput(value);

      /*
       * Each clock is bounded by the ones it has to agree with, so the wrong answer is
       * never offered rather than merely marked afterwards: a presentation cannot
       * reach outside its session, and neither end of a pair can cross the other.
       *
       * The bounds are mutual, which is what makes an already-broken row fixable: a row
       * arriving 10:25 → 10:10 shows both fields red, and correcting *either* one puts
       * the other back in range, because each reads the other's current value.
       *
       * Still only what the browser can enforce for typing and stepping — a pasted
       * value lands regardless — so the same rules are held in `buildPreview` and again
       * in `commitImport`. Both sides read the same fields on this screen, so there is
       * no second copy of the rule to drift.
       */
      const clock = (name: string) => toTimeInput((draft[name] ?? "").trim()) || undefined;
      const later = (a?: string, b?: string) => (a && b ? (a > b ? a : b) : (a ?? b));
      const earlier = (a?: string, b?: string) => (a && b ? (a < b ? a : b) : (a ?? b));
      const sessionFrom = clock("session.start");
      const sessionTo = clock("session.end");

      const bounds: { min?: string; max?: string } =
        field === "slot.start"
          ? { min: sessionFrom, max: earlier(clock("slot.end"), sessionTo) }
          : field === "slot.end"
            ? { min: later(clock("slot.start"), sessionFrom), max: sessionTo }
            : field === "session.start"
              ? { max: sessionTo }
              : field === "session.end"
                ? { min: sessionFrom }
                : {};


      if (picker !== null) {
        /*
         * The DXG dashboard's picker (D-044). For a clock the bounds are handed
         * to `filterTime`, which removes the times the session does not allow
         * from the list rather than marking a bad answer afterwards — the point
         * D-043 made with a hand-rolled `<select>`, now the library's own job.
         *
         * A value the file supplied that the window excludes is still displayed,
         * because the selected time renders whether or not the filter offers it;
         * the field is marked and Save refuses it, exactly as before.
         */
        const stranded =
          picker !== "" &&
          !isDate &&
          ((bounds.min !== undefined && picker < bounds.min) ||
            (bounds.max !== undefined && picker > bounds.max));
        const invalid = stranded || (isMissing && empty);

        return (
          <div className="field" key={field}>
            {label}
            {isDate ? (
              <DateField
                id={`edit-${field}`}
                value={picker}
                onChange={(next) => set(field, next)}
                invalid={invalid}
                {...(visible && visible !== full ? { ariaLabel: full } : {})}
              />
            ) : (
              <TimeField
                id={`edit-${field}`}
                value={picker}
                onChange={(next) => set(field, next)}
                min={bounds.min}
                max={bounds.max}
                invalid={invalid}
                {...(visible && visible !== full ? { ariaLabel: full } : {})}
              />
            )}
          </div>
        );
      }

      // Unreadable: a picker cannot show it, and blanking it would hide the very thing
      // the operator was sent here to fix.
      return (
        <div className="field" key={field}>
          {label}
          <input
            id={`edit-${field}`}
            style={{ width: "100%", borderColor: "var(--block)" }}
            value={value}
            placeholder={FIELD_HINTS[field] ?? ""}
            {...(visible && visible !== full ? { "aria-label": full } : {})}
            onChange={(event) => set(field, event.target.value)}
          />
          <div className="note" style={{ fontSize: 11 }}>
            Not a {isDate ? "date" : "time"} we can read — clear it to use the picker.
          </div>
        </div>
      );
    }

    return (
      <div className="field" key={field}>
        {label}
        <input
          id={`edit-${field}`}
          style={{ width: "100%", ...border }}
          placeholder={FIELD_HINTS[field] ?? ""}
          value={value}
          {...(visible && visible !== full ? { "aria-label": full } : {})}
          onChange={(event) => set(field, event.target.value)}
        />
      </div>
    );
  };

  /**
   * Fields across one line, each taking an equal share of it — and wrapping rather
   * than crushing when the dialog is too narrow for them. `auto-fit` with a floor is
   * what keeps a three-up row of times on one line at 560px and lets it fall to two
   * on a phone, without a breakpoint to maintain.
   */
  const line = (fields: string[], labelFor?: (field: string) => string | undefined) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${fields.length > 2 ? 148 : 190}px, 1fr))`,
        gap: 10,
      }}
    >
      {fields.map((field) => renderField(field, labelFor?.(field)))}
    </div>
  );

  const sessionTitle = row.cells["session.title"] || "untitled session";

  return (
    <div
      role="dialog"
      aria-modal="true"
      // The visible title is truncated; the accessible name is not, since there is no
      // hovering an ellipsis with a screen reader.
      aria-label={`Edit row ${row.row}: ${sessionTitle}`}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8,12,20,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 50,
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) leave();
      }}
    >
      <div
        ref={formRef}
        className="card"
        style={{ maxWidth: 560, width: "100%", maxHeight: "86vh", overflow: "auto" }}
      >
        {/*
          `.chd` is a card header built for a short name beside a short meta string, and
          the meta here is whatever the spreadsheet put in the title cell — ninety
          characters of conference-speak is normal. Left to the shared rule the title
          took the width it wanted, wrapped to three lines of monospace, and squeezed
          "Row 6" into "Row" / "6" stacked in the corner: the row number is what this
          dialog is *about*, and it had become the smallest thing in its own header.

          So the number never shrinks, and the title takes one line and ellipses.
          Nothing is lost by truncating it — `Session Title` is the first field in the
          dialog, in full and editable — but the whole string is on the element's
          `title` for a hover and in the dialog's accessible name, because a screen
          reader gets no ellipsis to hover over.
        */}
        <div className="chd" style={{ gap: 12 }}>
          <h3 style={{ flexShrink: 0 }}>Row {label}</h3>
          <span
            className="m"
            title={sessionTitle}
            style={{
              // `minWidth: 0` is what actually permits a flex item to be narrower than
              // its content; without it the ellipsis never appears and it overflows.
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textAlign: "right",
            }}
          >
            {sessionTitle}
          </span>
        </div>
        <div className="cbd">
          {/*
            A row nobody has typed into yet is not a row with problems. Its cells are
            all empty, so validation reports every required field missing and a date it
            could not read from "" — three sentences restating the `· required` markers
            on the fields below, in red, before the operator has done anything. A file's
            rows are never in this state: the parser drops a row whose every cell is
            empty, so this is only ever a just-added row on a typed agenda.
          */}
          {problems.length > 0 && Object.values(row.cells).some((value) => (value ?? "").trim()) && (
            <div
              className={problems.some((problem) => problem.severity === "blocking") ? "err" : "note"}
              style={{ marginBottom: 12 }}
            >
              {problems.map((problem, index) => (
                <div key={index}>
                  {problem.message}
                  {/* The typo suggestion the validation card used to carry — moved
                      here, where the field it fills is on screen. It still only fills
                      the box: applying it is not committing it. */}
                  {problem.suggestion && (
                    <button
                      className="btn"
                      style={{ marginLeft: 8, padding: "2px 9px" }}
                      onClick={() =>
                        setDraft({ ...draft, [problem.suggestion!.field]: problem.suggestion!.value })
                      }
                    >
                      Use &ldquo;{problem.suggestion.value}&rdquo;
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <Section heading="Session">
            {line(SESSION_TEXT_FIELDS)}
            <div style={{ marginTop: 10 }}>{line(SESSION_WHEN_FIELDS)}</div>
          </Section>

          <Section heading="Presentation">
            {line(PRESENTATION_FIELDS, (field) => PRESENTATION_SHORT_LABELS[field])}
          </Section>

          <Section heading="Presenters">
            {PRESENTER_PREFIXES.slice(0, presenterCount).map((prefix, index) => (
              <div key={prefix} style={{ marginBottom: index === presenterCount - 1 ? 0 : 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div className="kl">Presenter {index + 1}</div>
                  {index > 0 && (
                    <button
                      className="btn"
                      style={{ padding: "2px 9px" }}
                      onClick={() => {
                        /*
                         * Shift the ones below up rather than leaving a hole. Clearing
                         * in place would put presenter 3 in a block labelled 2 on the
                         * next render, or leave a hidden block still holding a name —
                         * which is how a presenter nobody meant to keep gets imported.
                         */
                        const next = { ...draft };
                        for (let at = index; at < PRESENTER_PREFIXES.length; at += 1) {
                          const here = PRESENTER_PREFIXES[at]!;
                          const below = PRESENTER_PREFIXES[at + 1];
                          presenterFields(here).forEach((field, part) => {
                            next[field] = below ? (draft[presenterFields(below)[part]!] ?? "") : "";
                          });
                        }
                        setDraft(next);
                        setPresenterCount(Math.max(1, presenterCount - 1));
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
                {line(presenterFields(prefix), shortLabel)}
              </div>
            ))}

            {presenterCount < PRESENTER_PREFIXES.length && (
              <button
                className="btn"
                style={{ marginTop: 12 }}
                onClick={() => setPresenterCount(presenterCount + 1)}
              >
                + Add another presenter
              </button>
            )}
          </Section>

          <div className="note" style={{ marginTop: 10 }}>
            Times are read in {timeZone}, the event&rsquo;s own timezone. Nothing is written to the event
            until you import.
          </div>

          {/*
            The question replaces the buttons rather than sitting above them, so the
            two things that can now happen are the only two things on offer — a
            "Discard" beside the "Save row" it undoes is a misclick waiting to happen.
          */}
          {confirmingDiscard ? (
            <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
              <b>Discard what you have typed?</b>
              <button className="btn" disabled={busy} onClick={onCancel}>
                Discard
              </button>
              <button className="btn pri" disabled={busy} onClick={() => setConfirmingDiscard(false)}>
                Keep editing
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button
                className="btn pri"
                disabled={busy || !dirty || stillMissing.length > 0 || outOfRange}
                title={
                  outOfRange
                    ? "A time here is outside the range its field allows — the red boxes."
                    : stillMissing.length > 0
                      ? `Still needed: ${stillMissing.map((field) => FIELD_LABELS[field] ?? field).join(", ")}`
                      : undefined
                }
                onClick={() => onSave(changed)}
              >
                Save row
              </button>
              <button className="btn" disabled={busy} onClick={leave}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Screen 3 — upload, map, validate, then commit all at once or not at all.
 *
 * Also step 2 of the create-event wizard (D-026), which is why it takes `embedded`:
 * the same screen, minus the page heading and the "you are finished, go here next"
 * ending that belongs to the standalone route. One component rather than two, so a
 * fix to the mapping table cannot land on only one of them.
 */
export function ImportView({
  eventId,
  embedded = false,
  onCommitted,
}: {
  eventId: string;
  embedded?: boolean;
  onCommitted?: (result: { created: number; updated: number; unchanged: number }) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rows, setRows] = useState<StagedRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committed, setCommitted] = useState<{ created: number; updated: number; unchanged: number } | null>(
    null,
  );
  /** The row number whose editor is open, if any. */
  const [editing, setEditing] = useState<number | null>(null);
  /*
   * A session being typed that does not exist yet — "+ Add session" opens the editor
   * over nothing rather than appending a row first. The row was previously created on
   * the server the moment the button was pressed, so cancelling the dialog left an
   * empty row behind: three changes of mind, three rows reading "missing".
   */
  const [adding, setAdding] = useState(false);
  /** Set while a file is over the drop area, so the area can say it will take it. */
  const [dragging, setDragging] = useState(false);
  /*
   * dragenter and dragleave fire for every element the pointer crosses, including the
   * text inside the zone, so a single boolean flickers off as soon as the file passes
   * over a child. Counting entries against leaves is what makes the state survive the
   * crossing.
   */
  const dragDepth = useRef(0);
  /** Bytes sent of bytes total, while a file is going up. */
  const [sending, setSending] = useState<{ name: string; sent: number; total: number } | null>(null);

  function apply(next: ImportPreview) {
    setPreview(next);
    setRows(next.rows);
    setCommitted(null);
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  /*
   * The column-mapping table is gone (D-028) — it asked every operator to audit a
   * machine's work on every import, and the sessions table shows what was understood
   * far more directly. What it also was, though, is the only way to correct a heading
   * the mapper did not recognise, and without that a file whose room column is called
   * something unexpected has *every* row missing a room and no way to say so once.
   * So the repair survives, scoped to the case that actually breaks: a required field
   * with no column at all.
   */
  const unmappedRequired: string[] = preview
    ? (preview.required_fields ?? []).filter((field) => !preview.mapping.includes(field))
    : [];

  /*
   * The validation card listed every issue as its own paragraph, so eleven rows each
   * missing a presenter name produced eleven identical sentences above a table that
   * already had eleven rows in it. The same facts are now attached to the row they
   * belong to: the row is coloured, and its message is in the editor that fixes it.
   */
  const problemsByRow = new Map<
    number,
    { column: string; severity: string; message: string; suggestion?: { field: string; value: string } }[]
  >();
  for (const issue of preview?.issues ?? []) {
    problemsByRow.set(issue.row, [...(problemsByRow.get(issue.row) ?? []), issue]);
  }

  /*
   * A row that cannot be imported. Not only one missing a required value: a room that
   * matches nothing on the event is `blocking` too, and counting only `missing` let it
   * through — the import committed and created a second room from the typo, which is
   * the duplicate the check exists to prevent. SCREEN_SPECS §3 has always said a
   * commit with blocking errors is refused; this is the screen honouring it.
   */
  const isBlocked = (row: StagedRow): boolean =>
    row.missing.length > 0 ||
    (problemsByRow.get(row.row) ?? []).some((problem) => problem.severity === "blocking");

  const blockingRows = rows.filter(isBlocked);

  /*
   * What a row is called on screen. A file's rows keep the number they have in the
   * file, so an error names a row the operator can go and look at. A typed agenda has
   * no file to look at, and its first row is internally row 2 — the header occupies
   * row 1 — so counting from one is both clearer and the only honest answer.
   */
  const rowLabel = (row: StagedRow): number =>
    preview?.manual ? rows.findIndex((candidate) => candidate.row === row.row) + 1 : row.row;

  /*
   * What the screen will accept, checked before anything is sent. The server refuses
   * the same things, but it refuses them after the whole file has gone up — a 60 MB
   * .pptx dropped here should be turned away immediately, and named, rather than
   * uploaded and then rejected.
   */
  const rejectionFor = (file: File): string | null => {
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!AGENDA_EXTENSIONS.includes(extension as (typeof AGENDA_EXTENSIONS)[number])) {
      return `“${file.name}” is ${extension || "not a spreadsheet"}. The agenda has to be ${AGENDA_EXTENSIONS.join(" or ")}.`;
    }
    if (file.size > AGENDA_MAX_BYTES) {
      return `“${file.name}” is ${formatBytes(file.size)}. The limit is ${AGENDA_MAX_LABEL}.`;
    }
    return null;
  };

  const upload = (file: File): void => {
    const rejection = rejectionFor(file);
    if (rejection) {
      setError(rejection);
      return;
    }
    setError(null);
    setSending({ name: file.name, sent: 0, total: file.size });
    void run(async () => {
      try {
        apply(
          await uploadImport(eventId, file, (sent, total) =>
            setSending({ name: file.name, sent, total }),
          ),
        );
      } finally {
        setSending(null);
      }
    });
  };

  const saveRow = (rowNumber: number, cells: Record<string, string>): void => {
    void run(async () => {
      apply(await setImportCells(preview!.upload_id, rowNumber, cells));
      setEditing(null);
    });
  };



  return (
    <>
      {!embedded && (
        <h1 className="htitle">
          {preview?.manual ? "Enter schedule" : "Import schedule"}
          {preview && !preview.manual && (
            <>
              {" · "}
              <span className="mono" style={{ fontSize: 16 }}>
                {preview.file_name}
              </span>
            </>
          )}
        </h1>
      )}

      {error && <div className="err">{error}</div>}

      {!preview && (
        <div className="card">
          <div className="cbd">
            <input
              ref={inputRef}
              type="file"
              accept={AGENDA_EXTENSIONS.join(",")}
              style={{ display: "none" }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload(file);
                // Cleared so choosing the same file twice — after fixing it — still
                // fires a change event.
                event.target.value = "";
              }}
            />

            {/*
              The drop area does one thing (D-048). It used to carry three buttons of
              equal weight — upload, type it in, download a template — which read as a
              choice to make before the obvious action, inside a box whose dashed
              border promises a file can be dropped on it. Only uploading belongs in
              here; the other two routes are a line underneath.
            */}
            <div
              onDragEnter={(event) => {
                event.preventDefault();
                dragDepth.current += 1;
                setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => {
                dragDepth.current -= 1;
                if (dragDepth.current <= 0) setDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                dragDepth.current = 0;
                setDragging(false);
                const file = event.dataTransfer.files[0];
                if (file) upload(file);
              }}
              style={{
                border: `2px dashed ${dragging ? "var(--blue)" : "var(--line)"}`,
                background: dragging ? "var(--info-soft)" : undefined,
                borderRadius: 10,
                padding: 26,
                textAlign: "center",
                transition: "border-color 120ms ease, background-color 120ms ease",
              }}
            >
              {sending ? (
                <>
                  <div className="mono" style={{ fontSize: 13 }}>
                    {sending.name}
                  </div>
                  <div className="bar blue" style={{ margin: "10px auto 6px", maxWidth: 280 }}>
                    <i
                      style={{
                        width: `${sending.total > 0 ? Math.round((sending.sent / sending.total) * 100) : 0}%`,
                        transition: "width 120ms linear",
                      }}
                    />
                  </div>
                  {/*
                    The bytes arriving is not the end of the wait: the server then
                    parses every row and validates it, which on a long sheet is the
                    longer half. Saying "uploading" through that would be a bar that
                    sits full while nothing appears to happen.
                  */}
                  <div className="note">
                    {sending.sent < sending.total
                      ? `Uploading… ${formatBytes(sending.sent)} of ${formatBytes(sending.total)}`
                      : "Reading the file…"}
                  </div>
                </>
              ) : (
                <>
                  <svg
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={dragging ? "var(--blueDark)" : "var(--slate)"}
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    style={{ display: "block", margin: "0 auto 8px" }}
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <path d="M12 3v13" />
                    <path d="m7 8 5-5 5 5" />
                  </svg>
                  <b>{dragging ? "Drop it here" : "Drop the agenda here"}</b>
                  <div className="note" style={{ margin: "4px 0 0" }}>
                    or{" "}
                    <button
                      className="btn"
                      style={{ padding: "3px 10px" }}
                      disabled={busy}
                      onClick={() => inputRef.current?.click()}
                    >
                      choose a file
                    </button>
                  </div>
                  {/* Stated before anyone tries, not only when something is refused. */}
                  <div className="note" style={{ marginTop: 10 }}>
                    {AGENDA_EXTENSIONS.join(" or ")} · up to {AGENDA_MAX_LABEL} · every row is checked
                    before anything is written
                  </div>
                </>
              )}
            </div>

            {/*
              The other two ways in (D-045), out of the drop area and level with each
              other: neither is the upload, and neither is a fallback for the other.
            */}
            <div className="note" style={{ marginTop: 12, textAlign: "center" }}>
              No file to upload?{" "}
              <button
                className="btn"
                style={{ padding: "3px 10px" }}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const next = await startManualImport(eventId);
                    apply(next);
                    if (next.rows[0]) setEditing(next.rows[0].row);
                  })
                }
              >
                Enter it manually
              </button>{" "}
              or{" "}
              <button
                className="btn"
                style={{ padding: "3px 10px" }}
                disabled={busy}
                onClick={() => void run(async () => downloadAgendaTemplate(eventId))}
              >
                ↓ Download the template
              </button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <>
          {blockingRows.length > 0 && (
            <div className="err" style={{ marginBottom: 12 }}>
              <b>
                {blockingRows.length} of {rows.length} row{rows.length === 1 ? "" : "s"} cannot be
                imported yet.
              </b>{" "}
              {/* The note under the Import button already says it is all-or-nothing, and
                  on a typed agenda the row in question is the one just opened. */}
              {!preview.manual && (
                <>
                  They are marked in red below — open <b>Edit</b> on each one to fill in what is
                  missing. Import stays unavailable until every row is complete, because it is
                  all-or-nothing.
                </>
              )}
            </div>
          )}

          <div className="krow">
            <div className="kpi">
              <div className="kl">Rows</div>
              <div className="kv num">{preview.total_rows}</div>
            </div>
            <div className="kpi">
              <div className="kl">Incomplete rows</div>
              <div className="kv num" style={{ color: blockingRows.length ? "var(--block)" : "var(--ok)" }}>
                {blockingRows.length}
              </div>
            </div>
            <div className="kpi">
              <div className="kl">Warnings</div>
              <div className="kv num" style={{ color: "var(--warn)" }}>
                {preview.warnings}
              </div>
            </div>
            <div className="kpi">
              <div className="kl">New speakers</div>
              <div className="kv num">{preview.new_speakers}</div>
            </div>
          </div>

          {unmappedRequired.length > 0 && (
            <div className="card" style={{ borderColor: "var(--block)" }}>
              <div className="chd">
                <h3>Which column is this?</h3>
                <span className="m">{unmappedRequired.length} required field(s) not recognised</span>
              </div>
              <div className="cbd">
                <div className="note" style={{ marginBottom: 10 }}>
                  Every column in your file was read, but nothing in it looked like the field(s) below.
                  Point each one at the right column and the whole file is re-read — otherwise every row
                  will be missing the same value.
                </div>
                {unmappedRequired.map((field) => (
                  <div key={field} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                    <span className="mono" style={{ minWidth: 130 }}>
                      {FIELD_LABELS[field] ?? field}
                    </span>
                    <select
                      aria-label={`column for ${field}`}
                      value=""
                      onChange={(event) =>
                        void run(async () => {
                          const index = Number(event.target.value);
                          const mapping = [...preview.mapping];
                          // A column can only carry one field, so releasing it first
                          // keeps the mapping honest rather than silently duplicated.
                          const previous = mapping.indexOf(field);
                          if (previous >= 0) mapping[previous] = null;
                          mapping[index] = field;
                          apply(await remapImport(preview.upload_id, mapping));
                        })
                      }
                    >
                      <option value="">Choose the column…</option>
                      {preview.headers.map((header, index) => (
                        <option key={header + String(index)} value={index}>
                          {header || `(column ${index + 1}, no heading)`}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="chd">
              <h3>{preview.manual ? "Sessions" : `Sessions read from ${preview.file_name}`}</h3>
              <span className="m">
                {preview.counts.create} new · {preview.counts.update} updated ·{" "}
                {preview.counts.unchanged} unchanged — matched on room + start + title · times in{" "}
                {preview.timezone}
              </span>
            </div>
            <div className="cbd" style={{ padding: "0 0 4px" }}>
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Session</th>
                    <th>Room</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Presenter</th>
                    <th>Track</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const problems = problemsByRow.get(row.row) ?? [];
                    const blocked = isBlocked(row);
                    const warned = !blocked && problems.length > 0;
                    return (
                      <tr
                        key={row.row}
                        // Two shades, not one: a blocked row stops the import and a
                        // warned row does not, and colouring them alike would make the
                        // eleven rows that merely lack a presenter name look as urgent
                        // as the one with no date.
                        style={{
                          background: blocked
                            ? "color-mix(in srgb, var(--block) 12%, transparent)"
                            : warned
                              ? "color-mix(in srgb, var(--warn) 12%, transparent)"
                              : undefined,
                        }}
                      >
                        <td className="mono">{rowLabel(row)}</td>
                        <td>{row.title || <span className="chip c-bad">missing</span>}</td>
                        <td>{row.room || <span className="chip c-bad">missing</span>}</td>
                        <td className="note">{day(row.starts_at, preview.timezone)}</td>
                        <td className="note">
                          {row.starts_at ? (
                            <>
                              {clock(row.starts_at, preview.timezone)}
                              {row.ends_at && row.ends_at !== row.starts_at
                                ? `–${clock(row.ends_at, preview.timezone)}`
                                : ""}
                              {/*
                                The presentation's own window, when the file gives one.
                                It imports either way, but a row carrying one looked
                                identical to a row that did not — unreviewable before
                                committing it.
                              */}
                              {row.slot_starts_at && (
                                <div style={{ fontSize: 11, opacity: 0.75 }}>
                                  talk {clock(row.slot_starts_at, preview.timezone)}
                                  {row.slot_ends_at && row.slot_ends_at !== row.slot_starts_at
                                    ? `–${clock(row.slot_ends_at, preview.timezone)}`
                                    : ""}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="chip c-bad">missing</span>
                          )}
                        </td>
                        <td>
                          {/*
                            Everyone the row names, not just presenter 1. A co-presenter
                            was invisible here, so an operator could approve an import
                            without seeing who it was about to create.

                            Name over address: a mis-mapped column shows up as an address
                            where a name belongs, which is how the operator catches what
                            the mapping table used to be asked to.
                          */}
                          {row.presenters.length === 0 && <span className="note">—</span>}
                          {row.presenters.map((presenter, index) => (
                            <div key={index} style={{ marginTop: index === 0 ? 0 : 4 }}>
                              {presenter.name || presenter.email}
                              {presenter.name && presenter.email && (
                                <div className="note" style={{ fontSize: 11 }}>
                                  {presenter.email}
                                </div>
                              )}
                            </div>
                          ))}
                          {row.cells["speaker.organization"] && (
                            <div className="note" style={{ fontSize: 11 }}>
                              {row.cells["speaker.organization"]}
                            </div>
                          )}
                        </td>
                        <td className="note">{row.cells["track.name"] || "—"}</td>
                        <td>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <Chip
                              status={
                                blocked
                                  ? "needs_revision"
                                  : row.action === "create"
                                    ? "submitted"
                                    : row.action === "update"
                                      ? "needs_revision"
                                      : "canceled"
                              }
                              label={blocked ? "incomplete" : row.action}
                            />
                            {/*
                              On a typed agenda every row is opened here, including a
                              complete one: the editor is how the row was filled in, so
                              hiding it once the row validates would leave no way back
                              to a value that is wrong rather than missing.
                            */}
                            {(preview.manual || problems.length > 0) && (
                              <button
                                className={blocked ? "btn pri" : "btn"}
                                style={{ padding: "3px 10px" }}
                                title={problems.map((problem) => problem.message).join("\n")}
                                onClick={() => setEditing(row.row)}
                              >
                                Edit
                              </button>
                            )}
                            {preview.manual && rows.length > 1 && (
                              <button
                                className="btn"
                                style={{ padding: "3px 10px" }}
                                disabled={busy}
                                onClick={() =>
                                  void run(async () =>
                                    apply(await removeImportRow(preview.upload_id, row.row)),
                                  )
                                }
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {preview.manual && (
                <div style={{ padding: "10px 14px 6px" }}>
                  <button className="btn" disabled={busy} onClick={() => setAdding(true)}>
                    + Add session
                  </button>
                </div>
              )}
            </div>
          </div>

          {committed ? (
            <div className="card" style={{ borderColor: "var(--ok)" }}>
              <div className="cbd">
                <b>Imported.</b> {committed.created} created · {committed.updated} updated ·{" "}
                {committed.unchanged} unchanged.
                {!preview.manual && " Re-importing the same file now reports every row as unchanged."}
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                  {!embedded && (
                    <button className="btn" onClick={() => router.push(`/events/${eventId}`)}>
                      Open command center →
                    </button>
                  )}
                  <button className="btn" onClick={() => setPreview(null)}>
                    Add more sessions
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
              <button
                className="btn pri"
                disabled={busy || blockingRows.length > 0}
                title={
                  blockingRows.length > 0
                    ? `${blockingRows.length} row(s) still have blocking errors`
                    : undefined
                }
                onClick={() =>
                  void run(async () => {
                    const result = await commitImport(preview.import_id, eventId, rows);
                    setCommitted(result);
                    onCommitted?.(result);
                    router.refresh();
                  })
                }
              >
                Import {rows.length} session{rows.length === 1 ? "" : "s"}
              </button>
              <button
                className="btn"
                disabled={busy || preview.issues.length === 0}
                onClick={() => {
                  // This used to raise a toast listing row numbers. SCREEN_SPECS §3
                  // calls for a CSV the operator can take back to whoever produced the
                  // agenda, which a toast cannot be.
                  const escape = (value: string) =>
                    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
                  const csv = [
                    ["Row", "Column", "Severity", "Problem"],
                    ...preview.issues.map((issue) => [
                      String(issue.row),
                      issue.column,
                      issue.severity,
                      issue.message,
                    ]),
                  ]
                    .map((row) => row.map(escape).join(","))
                    .join("\r\n");
                  saveBlob(new Blob([csv], { type: "text/csv" }), `import errors — ${preview.file_name}.csv`);
                }}
              >
                ↓ Download error report
              </button>
              {blockingRows.length > 0 && (
                <span className="note" style={{ alignSelf: "center" }}>
                  Import is all-or-nothing — fix the {blockingRows.length} blocking row
                  {blockingRows.length === 1 ? "" : "s"} first.
                </span>
              )}
            </div>
          )}
        </>
      )}

      {editing !== null &&
        (() => {
          const row = rows.find((candidate) => candidate.row === editing);
          if (!row) return null;
          /*
           * Abandoning the first row of a typed agenda abandons the agenda. The row
           * exists on the server — an import has to have one — so leaving it would put
           * the operator in front of a table of one empty row, which is the same "I
           * changed my mind and it kept something" the new-row draft avoids. The
           * preview is dropped instead and the screen goes back to offering the three
           * ways in. Only while it is untouched: once a value is in it, Cancel means
           * cancel this edit.
           */
          const untouched = Object.values(row.cells).every((value) => !(value ?? "").trim());
          const abandonsTheAgenda = Boolean(preview?.manual) && rows.length === 1 && untouched;
          return (
            <RowEditor
              row={row}
              label={rowLabel(row)}
              problems={problemsByRow.get(editing) ?? []}
              timeZone={preview?.timezone ?? "UTC"}
              busy={busy}
              onCancel={() => {
                setEditing(null);
                if (abandonsTheAgenda) setPreview(null);
              }}
              onSave={(cells) => saveRow(editing, cells)}
            />
          );
        })()}

      {/*
        A session that does not exist yet. It is given the shape of a row so the editor
        does not have to know the difference — every required field missing, nothing
        filled — and saving is what creates it, in one request carrying the values.
      */}
      {adding &&
        preview &&
        (() => {
          const draft: StagedRow = {
            row: (rows[rows.length - 1]?.row ?? 1) + 1,
            title: "",
            room: "",
            cells: {},
            presenters: [],
            slot_starts_at: null,
            slot_ends_at: null,
            missing: [...(preview.required_fields ?? [])],
            starts_at: null,
            ends_at: null,
            speaker_name: "",
            speaker_email: "",
            organization: "",
            track: "",
            action: "create",
          };
          return (
            <RowEditor
              row={draft}
              label={rows.length + 1}
              problems={[]}
              timeZone={preview.timezone}
              busy={busy}
              onCancel={() => setAdding(false)}
              onSave={(cells) =>
                void run(async () => {
                  apply(await addImportRow(preview.upload_id, cells));
                  setAdding(false);
                })
              }
            />
          );
        })()}

    </>
  );
}
