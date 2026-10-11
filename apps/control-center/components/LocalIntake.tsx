"use client";

import { useState } from "react";
import type { UsbResult } from "@/lib/api";
import { beginSrrUpload, putSrrPart, ApiError } from "@/lib/api";
import { Chip } from "@/components/Chip";
import { WhyNot } from "@/components/WhyNot";
import { Icon } from "@/components/Icon";

/**
 * Local intake (was "USB intake", D-152): the three steps for a file the speaker brings —
 * on a USB drive or saved on the desk's computer; the browser's file picker reaches both.
 * Ordered by the rules, not by the layout: nothing is compared or accepted before the
 * scan, and acceptance needs a reason (FR-SRR-002/003/004). Used on a check-in and
 * straight from the Speaker Ready Room.
 */
export function LocalIntake({
  submit,
  approvedNumber,
  lastImport,
  outcomeNote,
  onDone,
}: {
  /** Finishes the uploaded file on the server: on a check-in, or for a talk. */
  submit: (body: { upload_id: string; file_name: string; reason: string }) => Promise<UsbResult>;
  approvedNumber?: number;
  /** What the last import on this check-in did, so a refresh doesn't lose it (R37, D-112). */
  lastImport?: string | null;
  /** A last sentence for the outcome, e.g. that it can be confirmed as final on this check-in. */
  outcomeNote?: string;
  onDone: (message: string) => void | Promise<void>;
}) {
  const [result, setResult] = useState<UsbResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What intake still needs, said before anything is uploaded (R35, D-111): the
  // reason used to be refused only after the whole file had gone up.
  const blocked =
    !reason.trim() && !file
      ? "To import, write a reason and choose the file — from a USB drive or this computer."
      : !reason.trim()
        ? "To import, write a reason for the new version."
        : !file
          ? "To import, choose the file — from a USB drive or this computer."
          : null;

  async function scanAndImport() {
    if (!file || !reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const session = await beginSrrUpload();
      const total = Math.max(1, Math.ceil(file.size / session.part_size));
      for (let part = 1; part <= total; part += 1) {
        const start = (part - 1) * session.part_size;
        await putSrrPart(session.upload_id, part, await file.slice(start, start + session.part_size).arrayBuffer());
      }
      const done = await submit({ upload_id: session.upload_id, file_name: file.name, reason });
      setResult(done);
      await onDone(done.message);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <div className="err">{error}</div>}
      <div className="card">
        <div className="chd">
          {/* Plain intake words (R36, D-112). */}
          <h3>1 · Virus check</h3>
          {result ? (
            <Chip
              status={result.scan_result === "clean" ? "synchronized_onsite" : "attention"}
              label={result.scan_result === "clean" ? "Clean" : "Held back"}
            />
          ) : (
            <Chip status="canceled" label="Choose the file" />
          )}
        </div>
        <div className="cbd">
          <p className="note" style={{ marginTop: 0 }}>
            Nothing is stored until the file passes the virus check. A file that fails is held back, and
            the room keeps what it already has.
          </p>
          {!result && lastImport && <div className="note" style={{ marginBottom: 8 }}>{lastImport}</div>}
          <div className="field">
            <label>Reason (required)</label>
            <input
              style={{ width: "100%" }}
              placeholder="e.g. speaker added a closing slide onsite"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <div className="field">
            <label>File — from a USB drive or saved on this computer</label>
            <input
              type="file"
              accept=".pptx,.ppt,.pdf,.key"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          <div style={{ marginTop: 10 }}>
            <button
              className="btn pri"
              disabled={busy || blocked !== null}
              title={blocked ?? undefined}
              onClick={() => void scanAndImport()}
            >
              <Icon name="intake" />
              {busy ? "Checking…" : "Check & import file"}
            </button>
            <WhyNot reason={blocked} />
          </div>
          {result && <div className={result.scan_result === "clean" ? "lane int" : "err"}>{result.message}</div>}
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>2 · Comparison vs the {result?.compared_with?.basis ?? "approved"} version</h3>
          {result?.scan_result === "clean" ? (
            <Chip status="submitted" label={`v${result.version_number} vs v${result.compared_with?.version_number ?? "—"}`} />
          ) : (
            <Chip status="canceled" label="After the virus check" />
          )}
        </div>
        <div className="cbd" style={{ padding: result?.comparison.length ? "0 0 4px" : undefined }}>
          {result?.scan_result === "clean" && result.comparison.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th />
                  <th>v{result.compared_with?.version_number ?? "—"}</th>
                  <th>v{result.version_number}</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {result.comparison.map((row) => (
                  <tr key={row.field}>
                    <td>{row.field}</td>
                    <td className="num">{row.approved}</td>
                    <td className="num">{row.incoming}</td>
                    <td>
                      <Chip
                        status={row.delta === "unchanged" ? "synchronized_onsite" : "needs_revision"}
                        label={row.delta}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="note">
              {result?.scan_result === "clean" ? "This is the talk's first file — nothing to compare with." : "Shown once the file passes the virus check."}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>3 · Outcome</h3>
        </div>
        <div className="cbd">
          <p className="note" style={{ marginTop: 0 }}>
            An accepted version goes to re-approval. The room keeps playing the approved copy until
            the new one is approved and loaded onto the room PC by hand — it is never replaced without warning.
          </p>
          {result?.scan_result === "clean" ? (
            <div className="lane spk">
              <b>v{result.version_number} is in.</b> It now needs a reviewer&rsquo;s approval in Manage
              presentations
              {approvedNumber ? `; the room keeps playing v${approvedNumber} until then` : ""}.
              {outcomeNote ? ` ${outcomeNote}` : ""}
            </div>
          ) : (
            <div className="note">Nothing to accept yet.</div>
          )}
        </div>
      </div>
    </>
  );
}
