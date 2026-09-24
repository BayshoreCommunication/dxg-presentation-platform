"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CommentRow, PresentationDetail } from "@/lib/api";
import { rollBackTalk, convertArchivePdfs, ApiError } from "@/lib/api";
import { Chip } from "@/components/Chip";
import { formatBytes } from "@pmp/format";

const short = (sha: string | null) => (sha ? `${sha.slice(0, 4)}…${sha.slice(-4)}` : "—");
/** On the event's clock (D-080) — it was pinned to New York for every event. */
const when = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });

const SOURCE_LABEL: Record<string, string> = {
  portal: "Speaker portal",
  srr_usb: "USB intake",
  srr_manual: "SRR",
  system: "System",
};

const VERSION_TONE: Record<string, string> = {
  approved: "synchronized_onsite",
  superseded: "canceled",
  rolled_back: "needs_revision",
  rejected: "attention",
  changes_requested: "needs_revision",
  awaiting_review: "submitted",
  in_review: "submitted",
};

/** Screen 6 — the whole life of one presentation, and the actions on it. */
export function PresentationDetailView({
  eventId,
  initial,
  comments,
}: {
  eventId: string;
  initial: PresentationDetail;
  comments: CommentRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const latest = initial.versions[0];
  const approved = initial.versions.find((row) => row.review_state === "approved");

  async function roll(targetVersionId: string, versionNumber: number) {
    const reason = window.prompt(
      `Roll back to v${versionNumber} — reason (required):`,
      "wrong version approved",
    );
    if (reason === null) return;
    if (!reason.trim()) {
      setError("A rollback must record a reason — nothing was changed.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await rollBackTalk(initial.talk.slot_id, targetVersionId, reason);
      setToast(
        `v${result.restored_version} restored byte-identically · ${result.rooms_notified} room${result.rooms_notified === 1 ? "" : "s"} notified`,
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Rollback failed.");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 4500);
    }
  }

  return (
    <>
      <h1 className="htitle">Presentation detail</h1>
      {error && <div className="err">{error}</div>}

      <div className="card">
        <div className="chd">
          <h3>{initial.talk.title}</h3>
          <Chip status={initial.talk.status} label={initial.talk.status_label} />
        </div>
        <div className="cbd">
          <div className="note" style={{ marginBottom: 6 }}>
            {initial.speaker?.name ?? "No speaker assigned"}
            {initial.speaker?.organization ? `, ${initial.speaker.organization}` : ""} · {initial.talk.room} ·{" "}
            {when(initial.talk.starts_at, initial.event.timezone)}
            {initial.talk.track ? ` · ${initial.talk.track}` : ""}
          </div>

          {latest && (
            <div className="mono note" style={{ marginBottom: 6 }}>
              v{latest.version_number} · {formatBytes(latest.size_bytes)} · sha256 {short(latest.sha256)} ·{" "}
              {SOURCE_LABEL[latest.source] ?? latest.source}
            </div>
          )}

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {approved?.approved_by && (
              <span className="chip c-ok">
                Approved by {approved.approved_by}
                {approved.approved_at ? ` · ${when(approved.approved_at, initial.event.timezone)}` : ""} · logged
              </span>
            )}
            {initial.talk.final_locked && <span className="chip c-sync">Final onsite version</span>}
            {initial.talk.restricted && <span className="chip c-bad">Restricted from distribution</span>}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" disabled title="Slide previews render in M2-7">
              Preview slides
            </button>
            {latest && (
              <Link
                className="btn"
                href={`/events/${eventId}/talks/${initial.talk.slot_id}/inspection?v=${latest.file_version_id}`}
              >
                Open inspection report
              </Link>
            )}
            <Link className="btn" href={`/events/${eventId}/review`}>
              Review workspace
            </Link>
            <Link className="btn" href={`/events/${eventId}/srr`}>
              Replace file / USB intake
            </Link>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>Version history</h3>
          <span className="m">
            every version ever received is kept · {initial.retained_versions} retained
          </span>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Received</th>
                <th>Size</th>
                <th>Checksum</th>
                <th>Source</th>
                <th>Findings</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {initial.versions.map((row) => (
                <tr key={row.file_version_id}>
                  <td className="mono">v{row.version_number}</td>
                  <td className="note">{when(row.created_at, initial.event.timezone)}</td>
                  <td className="num">{formatBytes(row.size_bytes)}</td>
                  <td className="mono">{short(row.sha256)}</td>
                  <td className="note">{SOURCE_LABEL[row.source] ?? row.source}</td>
                  <td>
                    {row.finding_counts.blocking > 0 && (
                      <span className="chip c-bad">{row.finding_counts.blocking} blocking</span>
                    )}{" "}
                    {row.finding_counts.warning > 0 && (
                      <span className="chip c-warn">{row.finding_counts.warning} warning</span>
                    )}{" "}
                    {row.finding_counts.blocking + row.finding_counts.warning === 0 && (
                      <span className="chip c-ok">clean</span>
                    )}
                  </td>
                  <td>
                    <Chip
                      status={VERSION_TONE[row.review_state] ?? "canceled"}
                      label={row.review_state.replace("_", " ")}
                    />
                    {row.room_states.includes("active") && (
                      <>
                        {" "}
                        <span className="chip c-sync">in room</span>
                      </>
                    )}
                    {/* Whether its PDF copy for the archive exists (D-072). */}
                    {row.pdf_state && (
                      <>
                        {" "}
                        <span
                          className={`chip ${
                            row.pdf_state === "done" ? "c-ok" : row.pdf_state === "failed" ? "c-bad" : "c-info"
                          }`}
                          title={row.pdf_state === "failed" ? (row.pdf_error ?? "Conversion failed") : undefined}
                        >
                          {row.pdf_state === "done"
                            ? "PDF ready"
                            : row.pdf_state === "failed"
                              ? "PDF failed"
                              : "PDF converting"}
                        </span>
                        {row.pdf_state === "failed" && (
                          <>
                            <div className="note" style={{ color: "var(--block)", marginTop: 3 }}>
                              {row.pdf_error}
                            </div>
                            <button
                              type="button"
                              className="btn"
                              style={{ padding: "3px 9px", fontSize: 12, marginTop: 3 }}
                              disabled={busy}
                              onClick={() =>
                                void (async () => {
                                  await convertArchivePdfs(eventId, true);
                                  setToast("PDF conversion queued again");
                                  router.refresh();
                                })()
                              }
                            >
                              Retry PDF
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {/* Only a version that was once approved can be rolled back to (D-076). */}
                    {row.review_state === "superseded" && row.approved_at && approved && (
                      <button
                        className="btn warnb"
                        style={{ padding: "4px 10px" }}
                        disabled={busy}
                        onClick={() => void roll(row.file_version_id, row.version_number)}
                      >
                        Roll back to this
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {comments.length > 0 && (
        <div className="card">
          <div className="chd">
            <h3>Comments · all versions</h3>
            <span className="m">audiences are enforced server-side</span>
          </div>
          <div className="cbd">
            {comments.map((comment) => (
              <div
                className={`lane ${comment.lane === "internal" ? "int" : comment.lane === "client_visible" ? "cli" : "spk"}`}
                key={comment.id}
              >
                <b>{comment.author ?? "—"}</b>
                <span className="aud">{comment.lane.replace("_", " ")}</span>
                <span className="note"> · v{comment.version_number}</span>
                <br />
                {comment.body}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </>
  );
}
