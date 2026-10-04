"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CommentRow, PresentationDetail } from "@/lib/api";
import { rollBackTalk, previewUrl, requestPreview, ApiError } from "@/lib/api";
import { Chip, StatusMeaning } from "@/components/Chip";
import { ConfirmationStrip } from "@/components/ConfirmationStrip";
import { SlideViewer } from "@/components/SlideViewer";
import { WhyNot } from "@/components/WhyNot";
import { COMMENT_LANE, formatBytes, SEVERITY, VERSION_STATE, wordsFor } from "@pmp/format";

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
  srr_manual: "Speaker Ready Room",
  system: "System",
};

const VERSION_TONE: Record<string, string> = {
  quarantined: "attention",
  checksum_failed: "attention",
  blocked: "attention",
  uploading: "processing",
  uploaded: "processing",
  scanning: "processing",
  approved: "synchronized_onsite",
  superseded: "canceled",
  rolled_back: "needs_revision",
  rejected: "attention",
  changes_requested: "needs_revision",
  awaiting_review: "submitted",
  in_review: "submitted",
};

/**
 * A version's own state (R16, D-110): its review state, unless processing stopped it
 * first — in shared words, never "rolled back" or "awaiting review" as codes.
 */
const STOPPED = ["uploading", "uploaded", "scanning", "quarantined", "checksum_failed"];
const versionState = (row: { processing_state: string; review_state: string }) =>
  STOPPED.includes(row.processing_state) ? row.processing_state : row.review_state;

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

  // "Preview slides" was always greyed ("M2-7"); it now shows the newest version's slides
  // inline, from the same PDF the review screen uses (R14, D-111).
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewBlocked = !latest
    ? "No file has been uploaded yet, so there are no slides to show."
    : ["quarantined", "checksum_failed", "blocked"].includes(latest.processing_state)
      ? `v${latest.version_number} didn't pass the file checks, so there are no slides to show.`
      : latest.processing_state !== "stored"
        ? `v${latest.version_number} is still being checked. Its slides can be previewed once that finishes.`
        : latest.pdf_state === "queued" || latest.pdf_state === "converting"
          ? "The slide preview is still being made. Refresh the page in a moment."
          : null;

  async function preview() {
    if (!latest) return;
    if (latest.pdf_state === "done") {
      setPreviewOpen((open) => !open);
      return;
    }
    // Never made (older upload) or failed: ask for it, as the review screen does.
    setBusy(true);
    setError(null);
    try {
      await requestPreview(latest.file_version_id);
      setToast("Preparing the slide preview. Refresh the page in a moment.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not ask for a slide preview.");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 4500);
    }
  }

  /*
   * R18 (D-113): "Retry PDF" re-queued the whole event's PDFs and always said "queued
   * again". It now retries this version only and says what actually happened.
   */
  async function retryPdf(versionId: string, versionNumber: number) {
    setBusy(true);
    setError(null);
    try {
      const { queued } = await requestPreview(versionId);
      setToast(
        queued > 0
          ? `Making the PDF of v${versionNumber} again — refresh in a minute to see if it worked.`
          : `v${versionNumber}'s PDF is already being made or is ready — refresh the page.`,
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not try the PDF again. Nothing was changed.");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 4500);
    }
  }

  // An inline form, not window.prompt pre-filled with "wrong version approved" (D-108).
  const [rollTarget, setRollTarget] = useState<{ id: string; n: number; reason: string } | null>(null);

  async function roll(targetVersionId: string, versionNumber: number, reason: string) {
    if (!reason.trim()) {
      setError("A rollback must record a reason — nothing was changed.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await rollBackTalk(initial.talk.slot_id, targetVersionId, reason);
      setRollTarget(null);
      setToast(
        result.rooms_notified > 0
          ? `v${result.restored_version} is back in use. Load it onto the room PC (or check it's still there) and tick it on Room sync.`
          : `v${result.restored_version} is back in use.`,
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
          {/* R47: what the status means, visibly (D-110). */}
          <div style={{ marginBottom: 6 }}>
            <StatusMeaning status={initial.talk.status} />
          </div>
          <div className="note" style={{ marginBottom: 6 }}>
            {initial.speaker?.name ?? "No speaker assigned"}
            {initial.speaker?.organization ? `, ${initial.speaker.organization}` : ""} · {initial.talk.room} ·{" "}
            {when(initial.talk.starts_at, initial.event.timezone)}
            {initial.talk.track ? ` · ${initial.talk.track}` : ""}
          </div>

          {/* Approval → sign-off → room, connected (D-113, root cause 5). */}
          <ConfirmationStrip
            facts={{
              status: initial.talk.status,
              room: initial.talk.room,
              hasSpeaker: initial.speaker !== null,
              latestVersion: latest?.version_number ?? null,
              approved: approved
                ? { version: approved.version_number, by: approved.approved_by, at: approved.approved_at }
                : null,
              roomStates: approved?.room_states,
              signOff: initial.srr?.sign_off
                ? {
                    version: initial.srr.sign_off.version_number,
                    by: initial.srr.sign_off.technician,
                    at: initial.srr.sign_off.signed_at,
                  }
                : null,
              timezone: initial.event.timezone,
            }}
          />

          {latest && (
            <div className="note" style={{ marginBottom: 6 }}>
              {/* No file fingerprint here: staff never need it (R15, D-112). */}
              v{latest.version_number} · {formatBytes(latest.size_bytes)} ·{" "}
              {SOURCE_LABEL[latest.source] ?? latest.source}
            </div>
          )}

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {/* Who approved it and when is step 1 of the strip above (D-113). */}
            {initial.talk.final_locked && <span className="chip c-sync">Final onsite version</span>}
            {initial.talk.restricted && <span className="chip c-bad">Restricted from distribution</span>}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn"
              disabled={busy || previewBlocked !== null}
              title={previewBlocked ?? undefined}
              aria-expanded={previewOpen}
              onClick={() => void preview()}
            >
              {previewOpen ? "Hide slides" : "Preview slides"}
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
            {/* R19 (D-113): USB intake lives on the speaker's check-in — go straight there
                when they are checked in; otherwise say what to do first. */}
            {initial.srr?.checkin_id ? (
              <Link className="btn" href={`/events/${eventId}/srr/${initial.srr.checkin_id}`}>
                Replace file (USB intake)
              </Link>
            ) : (
              initial.speaker && (
                <Link className="btn" href={`/events/${eventId}/srr`}>
                  Speaker Ready Room
                </Link>
              )
            )}
          </div>
          <WhyNot reason={previewBlocked} />
          {!initial.srr?.checkin_id && initial.speaker && (
            <p className="note" style={{ margin: "6px 0 0" }}>
              To take a new file on a USB drive, check {initial.speaker.name} in at the Speaker Ready Room first —
              USB intake is on their check-in.
            </p>
          )}
          {previewOpen && latest?.pdf_state === "done" && (
            <div style={{ marginTop: 12 }}>
              <SlideViewer
                key={latest.file_version_id}
                url={previewUrl(latest.file_version_id)}
                versionId={latest.file_version_id}
                title={`${initial.talk.title}, version ${latest.version_number}`}
              />
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>Version history</h3>
          <span className="m">
            {/* R20 (D-112): plain words. */}
            all {initial.retained_versions} kept · older versions are never deleted
          </span>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Received</th>
                <th>Size</th>
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
                  <td className="note">{SOURCE_LABEL[row.source] ?? row.source}</td>
                  <td>
                    {row.finding_counts.blocking > 0 && (
                      <span className="chip c-bad">
                        {row.finding_counts.blocking} {SEVERITY.blocking!.label.toLowerCase()}
                      </span>
                    )}{" "}
                    {row.finding_counts.warning > 0 && (
                      <span className="chip c-warn">
                        {row.finding_counts.warning} {SEVERITY.warning!.label.toLowerCase()}
                        {row.finding_counts.warning === 1 ? "" : "s"}
                      </span>
                    )}{" "}
                    {row.finding_counts.blocking + row.finding_counts.warning === 0 && (
                      <span className="chip c-ok">clean</span>
                    )}
                  </td>
                  <td>
                    {/* A dense table: the meaning is the hover text here (R47). */}
                    <Chip
                      status={VERSION_TONE[versionState(row)] ?? "canceled"}
                      label={wordsFor(VERSION_STATE, versionState(row)).label}
                      hint={wordsFor(VERSION_STATE, versionState(row)).meaning}
                    />
                    {row.room_states.includes("active") && (
                      <>
                        {" "}
                        <span className="chip c-sync">loaded in room</span>
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
                        >
                          {row.pdf_state === "done"
                            ? "PDF ready"
                            : row.pdf_state === "failed"
                              ? "PDF failed"
                              : "PDF converting"}
                        </span>
                        {row.pdf_state === "failed" && (
                          <>
                            {/* R18 (D-113): a plain lead, then the reason the converter gave. */}
                            <div className="note" style={{ color: "var(--block)", marginTop: 3 }}>
                              The PDF copy couldn&rsquo;t be made.
                              {row.pdf_error ? ` ${row.pdf_error}` : " Try again; if it keeps failing, contact DXG support."}
                            </div>
                            <button
                              type="button"
                              className="btn"
                              style={{ padding: "3px 9px", fontSize: 12, marginTop: 3 }}
                              disabled={busy}
                              onClick={() => void retryPdf(row.file_version_id, row.version_number)}
                            >
                              Try the PDF again
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
                        onClick={() => setRollTarget({ id: row.file_version_id, n: row.version_number, reason: "" })}
                      >
                        Roll back to this
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rollTarget && (
            <form
              style={{ border: "1px solid var(--warn)", borderRadius: 8, padding: 12, margin: "12px" }}
              onSubmit={(event) => {
                event.preventDefault();
                void roll(rollTarget.id, rollTarget.n, rollTarget.reason);
              }}
            >
              <label htmlFor="rollback-reason" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
                Go back to v{rollTarget.n}? Say why (kept on record)
              </label>
              <textarea
                id="rollback-reason"
                rows={2}
                style={{ width: "100%" }}
                value={rollTarget.reason}
                onChange={(event) => setRollTarget({ ...rollTarget, reason: event.target.value })}
                placeholder="e.g. the newer version has a broken video"
                autoFocus
              />
              <div className="note" style={{ margin: "6px 0 8px" }}>
                v{rollTarget.n} becomes the approved version again. Check its room&rsquo;s PC plays v{rollTarget.n} —
                if it isn&rsquo;t there, load it and tick it on Room sync.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn warnb" disabled={busy || !rollTarget.reason.trim()}>
                  Go back to v{rollTarget.n}
                </button>
                <button type="button" className="btn" onClick={() => setRollTarget(null)}>
                  Cancel
                </button>
              </div>
              <WhyNot reason={!rollTarget.reason.trim() ? "Write the reason above to continue." : null} />
            </form>
          )}
        </div>
      </div>

      {comments.length > 0 && (
        <div className="card">
          <div className="chd">
            <h3>Comments · all versions</h3>
            <span className="m">each comment is seen only by the people its label names</span>
          </div>
          <div className="cbd">
            {comments.map((comment) => (
              <div
                className={`lane ${comment.lane === "internal" ? "int" : comment.lane === "client_visible" ? "cli" : "spk"}`}
                key={comment.id}
              >
                <b>{comment.author ?? "—"}</b>
                <span className="aud">{wordsFor(COMMENT_LANE, comment.lane).label}</span>
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
