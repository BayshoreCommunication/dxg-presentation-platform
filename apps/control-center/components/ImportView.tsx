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

/** What the operator calls these, rather than what the code does. */
const FIELD_LABELS: Record<string, string> = {
  "session.title": "Session title",
  "room.name": "Room / location",
  "session.date": "Session date",
  "session.start": "Start time",
  "session.end": "End time",
  "track.name": "Track",
  "speaker.email": "Presenter email",
  "speaker.first_name": "Presenter first name",
  "speaker.last_name": "Presenter last name",
  "speaker.name": "Presenter name",
  "speaker.organization": "Presenter organization",
};

/** The placeholder shows the shape a value has to take, not a second label. */
const FIELD_HINTS: Record<string, string> = {
  "session.date": "mm/dd/yyyy",
  "session.start": "9:00 AM",
  "session.end": "10:00 AM",
  "speaker.email": "name@example.com",
};

/** The order the editor lists them in: the session, then when, then who. */
const EDITOR_FIELDS = [
  "session.title",
  "room.name",
  "session.date",
  "session.start",
  "session.end",
  "track.name",
  "speaker.first_name",
  "speaker.last_name",
  "speaker.email",
  "speaker.organization",
];

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
  const changed = Object.fromEntries(
    Object.entries(draft).filter(([field, value]) => (row.cells[field] ?? "") !== value),
  );
  const stillMissing = row.missing.filter((field) => !(draft[field] ?? "").trim());

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
      <div className="card" style={{ maxWidth: 620, width: "100%", maxHeight: "86vh", overflow: "auto" }}>
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

          <div className="grid2">
            {EDITOR_FIELDS.map((field) => {
              const isMissing = row.missing.includes(field);
              return (
                <div className="field" key={field}>
                  <label htmlFor={`edit-${field}`}>
                    {FIELD_LABELS[field] ?? field}
                    {isMissing && <span style={{ color: "var(--block)" }}> · required</span>}
                  </label>
                  <input
                    id={`edit-${field}`}
                    style={{
                      width: "100%",
                      ...(isMissing && !(draft[field] ?? "").trim()
                        ? { borderColor: "var(--block)" }
                        : {}),
                    }}
                    placeholder={FIELD_HINTS[field] ?? ""}
                    value={draft[field] ?? ""}
                    onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
                  />
                </div>
              );
            })}
          </div>

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
                            </>
                          ) : (
                            <span className="chip c-bad">missing</span>
                          )}
                        </td>
                        <td>
                          {row.cells["speaker.name"] ||
                            [row.cells["speaker.first_name"], row.cells["speaker.last_name"]]
                              .filter(Boolean)
                              .join(" ") ||
                            row.cells["speaker.email"] || <span className="note">—</span>}
                          {(row.cells["speaker.first_name"] || row.cells["speaker.last_name"]) &&
                            row.cells["speaker.email"] && (
                              <div className="note" style={{ fontSize: 11 }}>
                                {row.cells["speaker.email"]}
                              </div>
                            )}
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
