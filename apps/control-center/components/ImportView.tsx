"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportPreview, StagedRow } from "@/lib/api";
import {
  uploadImport,
  remapImport,
  commitImport,
  setImportCells,
  downloadAgendaTemplate,
  saveBlob,
  ApiError,
} from "@/lib/api";
import { Chip } from "@/components/Chip";

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
 * The slider's range. It starts at 5 rather than 0 — a zero-minute presentation is not
 * a thing, so the lowest position it can reach is the shortest real one. "Not set"
 * stays reachable through Clear, and is what an untouched slider still means.
 * A file carrying more than the maximum is shown rather than clamped.
 */
const DURATION_MIN = 5;
const DURATION_MAX = 240;
const DURATION_STEP = 5;

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
  problems,
  timeZone,
  busy,
  onCancel,
  onSave,
}: {
  row: StagedRow;
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

  const changed = Object.fromEntries(
    Object.entries(draft).filter(([field, value]) => (row.cells[field] ?? "") !== value),
  );
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
      const minutes = /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : null;
      // A file may carry a duration past the slider's range. Showing it as a number
      // rather than clamping it keeps the operator's data theirs.
      const beyondSlider = minutes !== null && minutes > DURATION_MAX;
      return (
        <div className="field" key={field}>
          <label htmlFor={`edit-${field}`} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span>{visible ?? full}</span>
            <span className="note">{minutes === null ? "not set" : `${minutes} min`}</span>
            {/* On the label line, not beside the slider: in a third of the dialog's
                width the two together left the button clipped off the edge. */}
            {minutes !== null && (
              <button
                className="btn"
                style={{ padding: "0 6px", fontSize: 11, marginLeft: "auto" }}
                onClick={() => set(field, "")}
              >
                Clear
              </button>
            )}
          </label>
          <input
            id={`edit-${field}`}
            type="range"
            min={DURATION_MIN}
            max={DURATION_MAX}
            step={DURATION_STEP}
            value={minutes !== null && !beyondSlider ? minutes : DURATION_MIN}
            style={{ width: "100%" }}
            aria-label={`${full} in minutes`}
            onChange={(event) => set(field, event.target.value)}
          />
          {beyondSlider && (
            <div className="note" style={{ fontSize: 11 }}>
              {minutes} minutes — longer than the slider goes; Clear to change it.
            </div>
          )}
        </div>
      );
    }

    if (TIME_FIELDS.has(field) || DATE_FIELDS.has(field)) {
      const isDate = DATE_FIELDS.has(field);
      const picker = isDate ? toDateInput(value) : toTimeInput(value);
      if (picker !== null) {
        return (
          <div className="field" key={field}>
            {label}
            <input
              id={`edit-${field}`}
              type={isDate ? "date" : "time"}
              style={{ width: "100%", ...border }}
              value={picker}
              {...(visible && visible !== full ? { "aria-label": full } : {})}
              onChange={(event) => set(field, event.target.value)}
            />
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit row ${row.row}`}
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
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div className="card" style={{ maxWidth: 560, width: "100%", maxHeight: "86vh", overflow: "auto" }}>
        <div className="chd">
          <h3>Row {row.row}</h3>
          <span className="m">{row.cells["session.title"] || "untitled session"}</span>
        </div>
        <div className="cbd">
          {problems.length > 0 && (
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

          <Section
            heading="Presentation"
            note="Its own time inside the session — leave blank if it runs with the session. Duration is only used when there is no end time."
          >
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

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button
              className="btn pri"
              disabled={busy || Object.keys(changed).length === 0 || stillMissing.length > 0}
              title={
                stillMissing.length > 0
                  ? `Still needed: ${stillMissing.map((field) => FIELD_LABELS[field] ?? field).join(", ")}`
                  : undefined
              }
              onClick={() => onSave(changed)}
            >
              Save row
            </button>
            <button className="btn" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          </div>
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

  const blockingRows = rows.filter((row) => row.missing.length > 0);

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
          Import schedule
          {preview && (
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
            <div style={{ border: "2px dashed var(--line)", borderRadius: 10, padding: 26, textAlign: "center" }}>
              <b>Upload the agenda</b>
              <div className="note" style={{ margin: "4px 0 10px" }}>
                .xlsx or .csv · columns are auto-mapped and every row is validated before anything is
                written
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.csv"
                style={{ display: "none" }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void run(async () => apply(await uploadImport(eventId, file)));
                }}
              />
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                <button className="btn pri" disabled={busy} onClick={() => inputRef.current?.click()}>
                  Choose file…
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => void run(async () => downloadAgendaTemplate(eventId))}
                >
                  ↓ Download blank template
                </button>
              </div>
              <div className="note" style={{ marginTop: 10 }}>
                No agenda yet? Download the template, fill it in and upload it here. Required columns
                are marked in the file.
              </div>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <>
          {blockingRows.length > 0 && (
            <div className="err" style={{ marginBottom: 12 }}>
              <b>
                {blockingRows.length} of {rows.length} row{rows.length === 1 ? "" : "s"} still
                {blockingRows.length === 1 ? " needs" : " need"} a required value.
              </b>{" "}
              They are marked in red below — open <b>Edit</b> on each one to fill in what is missing.
              Import stays unavailable until every row is complete, because it is all-or-nothing.
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
              <h3>Sessions read from {preview.file_name}</h3>
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
                    const blocked = row.missing.length > 0;
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
                        <td className="mono">{row.row}</td>
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
                            {problems.length > 0 && (
                              <button
                                className={blocked ? "btn pri" : "btn"}
                                style={{ padding: "3px 10px" }}
                                title={problems.map((problem) => problem.message).join("\n")}
                                onClick={() => setEditing(row.row)}
                              >
                                Edit
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {committed ? (
            <div className="card" style={{ borderColor: "var(--ok)" }}>
              <div className="cbd">
                <b>Imported.</b> {committed.created} created · {committed.updated} updated ·{" "}
                {committed.unchanged} unchanged. Re-importing the same file now reports every row as
                unchanged.
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                  {!embedded && (
                    <button className="btn" onClick={() => router.push(`/events/${eventId}`)}>
                      Open command center →
                    </button>
                  )}
                  <button className="btn" onClick={() => setPreview(null)}>
                    Import another file
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
                Import {rows.length} sessions
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
          return (
            <RowEditor
              row={row}
              problems={problemsByRow.get(editing) ?? []}
              timeZone={preview?.timezone ?? "UTC"}
              busy={busy}
              onCancel={() => setEditing(null)}
              onSave={(cells) => saveRow(editing, cells)}
            />
          );
        })()}

    </>
  );
}
