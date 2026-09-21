"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImportPreview, StagedRow } from "@/lib/api";
import { uploadImport, remapImport, commitImport, IMPORT_FIELDS, ApiError } from "@/lib/api";
import { Chip } from "@/components/Chip";

const time = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "America/New_York",
      })
    : "—";

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
  const [toast, setToast] = useState<string | null>(null);
  const [committed, setCommitted] = useState<{ created: number; updated: number; unchanged: number } | null>(
    null,
  );

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

  /** Applying a suggestion edits the staged row only — it never commits. */
  function applySuggestion(rowNumber: number, value: string) {
    setRows((current) =>
      current.map((row) => (row.row === rowNumber ? { ...row, room: value } : row)),
    );
    setToast(`Row ${rowNumber} set to “${value}” — re-validate or import to apply it`);
    setTimeout(() => setToast(null), 3500);
  }

  const blockingRows = rows.filter((row) => !row.title || !row.room || !row.starts_at);

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
              <button className="btn pri" disabled={busy} onClick={() => inputRef.current?.click()}>
                Choose file…
              </button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <>
          <div className="krow">
            <div className="kpi">
              <div className="kl">Rows</div>
              <div className="kv num">{preview.total_rows}</div>
            </div>
            <div className="kpi">
              <div className="kl">Blocking errors</div>
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

          <div className="card">
            <div className="chd">
              <h3>Column mapping</h3>
              <span className="m">
                auto-mapped {preview.mapping.filter(Boolean).length} / {preview.headers.length}
              </span>
            </div>
            <div className="cbd" style={{ padding: "0 0 4px" }}>
              <table>
                <thead>
                  <tr>
                    <th>Source column</th>
                    <th>Platform field</th>
                    <th>Mapped</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.headers.map((header, index) => (
                    <tr key={header + String(index)}>
                      <td>{header}</td>
                      <td>
                        <select
                          className="mono"
                          value={preview.mapping[index] ?? ""}
                          onChange={(event) =>
                            void run(async () => {
                              const mapping = [...preview.mapping];
                              mapping[index] = event.target.value || null;
                              apply(await remapImport(preview.upload_id, mapping));
                            })
                          }
                        >
                          <option value="">— ignore —</option>
                          {IMPORT_FIELDS.map((field) => (
                            <option key={field} value={field}>
                              {field}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{preview.mapping[index] ? "✓" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="chd">
              <h3>Validation</h3>
              <span className="m">{preview.issues.length} items</span>
            </div>
            <div className="cbd">
              {preview.issues.length === 0 && <div className="note">Every row validated cleanly.</div>}
              {preview.issues.map((issue, index) => (
                <div
                  className={`lane ${issue.severity === "blocking" ? "cli" : "int"}`}
                  key={`${issue.row}-${index}`}
                >
                  <b>Row {issue.row} ·</b> {issue.message}
                  {issue.suggestion && (
                    <button
                      className="btn"
                      style={{ marginLeft: 8, padding: "3px 10px" }}
                      onClick={() => applySuggestion(issue.row, issue.suggestion!.value)}
                    >
                      Apply fix
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="chd">
              <h3>Preview</h3>
              <span className="m">
                {preview.counts.create} create · {preview.counts.update} update ·{" "}
                {preview.counts.unchanged} unchanged — re-import matches on room + start + title
              </span>
            </div>
            <div className="cbd" style={{ padding: "0 0 4px" }}>
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Session</th>
                    <th>Room</th>
                    <th>Starts</th>
                    <th>Speaker</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.row}>
                      <td className="mono">{row.row}</td>
                      <td>{row.title || <span className="chip c-bad">missing</span>}</td>
                      <td>{row.room || <span className="chip c-bad">missing</span>}</td>
                      <td className="note">{time(row.starts_at)}</td>
                      <td className="note">{row.speaker_name || "—"}</td>
                      <td>
                        <Chip
                          status={
                            row.action === "create"
                              ? "submitted"
                              : row.action === "update"
                                ? "needs_revision"
                                : "canceled"
                          }
                          label={row.action}
                        />
                      </td>
                    </tr>
                  ))}
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
                disabled={busy}
                onClick={() =>
                  setToast("Error report: " + preview.issues.map((issue) => `row ${issue.row}`).join(", "))
                }
              >
                Download error report
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

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </>
  );
}
