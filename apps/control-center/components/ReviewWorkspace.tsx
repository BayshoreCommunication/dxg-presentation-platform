"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { QueueItem } from "@/lib/api";
import { transitionVersion, ApiError } from "@/lib/api";
import { Chip, SeverityChip } from "@/components/Chip";
import { CommentsPanel } from "@/components/CommentsPanel";
import { ConfirmInline } from "@/components/ConfirmInline";
import { SlidePreview } from "@/components/SlidePreview";
import { WhyNot } from "@/components/WhyNot";
import { CHECK, formatBytes, INSPECTION_STATE, SEVERITY, VERSION_STATE, wordsFor } from "@pmp/format";

const FINDING_COPY: Record<string, (detail: Record<string, unknown>) => string> = {
  codec: (detail) =>
    `Slide ${(detail.slide_refs as number[] | undefined)?.join(", ") ?? "?"} · video uses ${String(detail.codec ?? "an unsupported codec")}. The room PCs are only guaranteed to play ${String(detail.expected ?? "H.264")} — it may stutter or fail in the room.`,
  fonts: () => "Fonts are not embedded — the deck may reflow on the room machine.",
  linked_media: (detail) =>
    `Linked (not embedded) media on slide ${(detail.slide_refs as number[] | undefined)?.join(", ") ?? "?"}.`,
};


/** Inspection states in which the automated checks have not finished (D-108). */
const CHECKING = ["pending", "inspecting"];

export function ReviewWorkspace({
  eventId,
  initialQueue,
  initialSelectedId,
}: {
  eventId: string;
  initialQueue: QueueItem[];
  /** R22 (D-113): "Open in review workspace" from an inspection report opens that file. */
  initialSelectedId?: string | null;
}) {
  const router = useRouter();
  const [queue, setQueue] = useState(initialQueue);
  const [selectedId, setSelectedId] = useState(
    initialSelectedId && initialQueue.some((item) => item.file_version_id === initialSelectedId)
      ? initialSelectedId
      : (initialQueue[0]?.file_version_id ?? null),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /*
   * Sending a file back asks, on the page, what the speaker should change (D-073). It
   * used to act at once with no reason — and "Reject" asked through window.prompt, which
   * embedded browsers answer with an instant cancel.
   */
  const [pending, setPending] = useState<"request_changes" | "reject" | null>(null);
  const [message, setMessage] = useState("");
  // R27 (D-113): the A key asks first — a stray keypress must not approve a file.
  const [confirmApprove, setConfirmApprove] = useState(false);

  useEffect(() => {
    setQueue(initialQueue);
    setSelectedId((current) =>
      current && initialQueue.some((item) => item.file_version_id === current)
        ? current
        : (initialQueue[0]?.file_version_id ?? null),
    );
  }, [initialQueue]);

  const selected = queue.find((item) => item.file_version_id === selectedId) ?? null;
  // Approval needs finished checks and no open blocking problem — the server refuses
  // otherwise (D-105); here the reason is visible before anyone clicks (D-108).
  const openBlocking = selected ? selected.findings.filter((finding) => finding.severity === "blocking").length : 0;
  const openWarnings = selected ? selected.findings.filter((finding) => finding.severity === "warning").length : 0;
  // The decision box's one sentence (D-123).
  const decisionTitle = !selected
    ? ""
    : CHECKING.includes(selected.inspection_state)
      ? "The file checks are still running — you can approve when they finish."
      : openBlocking > 0
        ? `${openBlocking} problem${openBlocking === 1 ? "" : "s"} must be fixed or waived before this can be approved.`
        : openWarnings > 0
          ? `Checks passed with ${openWarnings} warning${openWarnings === 1 ? "" : "s"} — read ${openWarnings === 1 ? "it" : "them"}, then decide.`
          : `Checks passed — nothing to fix. If the slides look right, approve v${selected.version_number}.`;
  const approveBlocked = !selected
    ? null
    : CHECKING.includes(selected.inspection_state)
      ? "Approve is available once the automated checks finish."
      : openBlocking > 0
        ? `This file has ${openBlocking} blocking problem${openBlocking === 1 ? "" : "s"}. Waive ${openBlocking === 1 ? "it" : "them"} with a reason in the inspection report, or ask the speaker for a new version.`
        : null;

  // A half-written message belongs to the file it was written for.
  useEffect(() => {
    setPending(null);
    setMessage("");
    setConfirmApprove(false);
  }, [selectedId]);

  const decide = useCallback(
    async (action: "claim" | "approve" | "request_changes" | "reject", note?: string) => {
      if (!selected || busy) return;
      setBusy(true);
      setError(null);
      try {

        // A decision needs the item claimed first (WORKFLOW_STATES §3).
        let lockVersion = selected.lock_version;
        if (selected.review_state === "awaiting_review" && action !== "claim") {
          const claimed = await transitionVersion(selected.file_version_id, {
            action: "claim",
            lock_version: lockVersion,
          });
          lockVersion = claimed.lock_version;
        }

        const result = await transitionVersion(selected.file_version_id, {
          action,
          lock_version: lockVersion,
          ...(note ? { note } : {}),
        });

        // Says what actually happened — who was emailed, and who could not be.
        const told = (notice: typeof result.notice) => {
          if (!notice) return "";
          const parts: string[] = [];
          if (notice.emailed.length > 0) parts.push(`emailed ${notice.emailed.join(", ")}`);
          if (notice.without_email.length > 0) {
            parts.push(`no email address for ${notice.without_email.join(", ")} — they'll see it in their portal`);
          }
          return parts.length > 0 ? ` · ${parts.join(" · ")}` : " · no speaker on this talk to tell";
        };
        // R28 (D-113): "queued for 0 rooms" said nothing. Say where it goes and what the
        // room still has to do — or that no room will get it until the session has one.
        setToast(
          result.review_state === "approved"
            ? result.rooms_queued === 0
              ? "Approved — but its session has no room yet, so no room PC will get it. Give the session a room in the agenda."
              : `Approved — being copied to ${selected.room ?? "the room"}'s PC. If the room already has an older version, the room technician switches to this one in Room Agent.`
            : result.review_state === "changes_requested"
              ? `Sent back for revision${told(result.notice)}`
              : result.review_state === "rejected"
                ? `Rejected${told(result.notice)}`
                : `Claimed · now ${wordsFor(VERSION_STATE, result.review_state).label.toLowerCase()}`,
        );
        setPending(null);
        setMessage("");

        if (result.review_state === "in_review") {
          setQueue((items) =>
            items.map((item) =>
              item.file_version_id === result.file_version_id
                ? { ...item, review_state: result.review_state, lock_version: result.lock_version }
                : item,
            ),
          );
        } else {
          setQueue((items) => items.filter((item) => item.file_version_id !== result.file_version_id));
        }
        router.refresh();
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Something went wrong and nothing was changed.",
        );
      } finally {
        setBusy(false);
        setTimeout(() => setToast(null), 6000);
      }
    },
    [selected, busy, router],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Never while typing — any text field, not just <input>: an "a" typed into the
      // comment box must not approve the file. And never with a modifier: Cmd/Ctrl+A is
      // select-all, not "approve".
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.key === "a" || event.key === "A") && !approveBlocked && !busy) setConfirmApprove(true);
      // R opens the message form rather than acting: a revision needs a reason.
      if (event.key === "r" || event.key === "R") setPending("request_changes");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [approveBlocked, busy]);

  return (
    <>
      <h1 className="htitle">Review presentations</h1>

      {error && <div className="err">{error}</div>}

      <div className="card">
        <div className="chd">
          <h3>Waiting for review · {queue.length}</h3>
          <span className="m">
            oldest first · <span className="kbd">A</span> approve (asks first) ·{" "}
            <span className="kbd">R</span> ask for changes
          </span>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          {queue.length === 0 ? (
            <div className="empty">Nothing waiting — every uploaded presentation has been reviewed.</div>
          ) : (
            <table>
              <tbody>
                {queue.map((item) => (
                  <tr
                    key={item.file_version_id}
                    className={`rb ${item.file_version_id === selectedId ? "sel" : ""}`}
                    onClick={() => setSelectedId(item.file_version_id)}
                  >
                    <td>
                      <b>{item.speaker}</b> · {item.title}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {/* The worst open problem, not the first (often a lowercase "info") (D-108),
                          in shared words with how many (R24, D-110). */}
                      {CHECKING.includes(item.inspection_state) ? (
                        <span className="chip c-info" title={wordsFor(INSPECTION_STATE, item.inspection_state).meaning}>
                          {wordsFor(INSPECTION_STATE, item.inspection_state).label}
                        </span>
                      ) : item.findings.some((finding) => finding.severity === "blocking") ? (
                        <SeverityChip
                          severity="blocking"
                          count={item.findings.filter((finding) => finding.severity === "blocking").length}
                        />
                      ) : item.findings.some((finding) => finding.severity === "warning") ? (
                        <SeverityChip
                          severity="warning"
                          count={item.findings.filter((finding) => finding.severity === "warning").length}
                        />
                      ) : (
                        <Chip status="submitted" label="Checks passed" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selected && (
        <div className="card">
          <div className="chd">
            <h3>Review workspace · {selected.speaker}</h3>
            <span className="m">
              v{selected.version_number} · {formatBytes(selected.size_bytes)} · {selected.room}
            </span>
          </div>
          <div className="cbd">
            {/* The real slides (D-074); eight numbered placeholders used to sit here. */}
            <SlidePreview item={selected} />

            {/* ── Your decision, straight under the slides (D-123). The buttons used to sit
                at the bottom, below comments and the note box, all looking equally important. */}
            <div className="card next-step" style={{ marginTop: 12 }}>
              <div className="cbd">
                <div className="next-step-label">Your decision</div>
                <h2 className="next-step-title">{decisionTitle}</h2>
                {/* Only findings that need a decision; informational ones stay in the report. */}
                {selected.findings
                  .filter((finding) => finding.severity !== "info")
                  .map((finding, index) => (
                    <div className="lane cli" key={`${finding.check_code}-${index}`}>
                      <b>
                        {finding.severity === "blocking" ? "⛔" : "⚠"} {wordsFor(SEVERITY, finding.severity).label} ·{" "}
                        {wordsFor(CHECK, finding.check_code).label}
                      </b>
                      <br />
                      {FINDING_COPY[finding.check_code]?.(finding.detail) ??
                        (wordsFor(CHECK, finding.check_code).meaning || "See the inspection report for the detail.")}
                    </div>
                  ))}
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    className="btn pri"
                    disabled={busy || approveBlocked !== null}
                    title={approveBlocked ?? undefined}
                    onClick={() => {
                      setConfirmApprove(false);
                      void decide("approve");
                    }}
                  >
                    Approve v{selected.version_number}
                  </button>
                  <button className="btn" disabled={busy} onClick={() => setPending("request_changes")}>
                    Ask for changes
                  </button>
                  <button className="btn danger" disabled={busy} onClick={() => setPending("reject")}>
                    Reject…
                  </button>
                </div>
                {/* The shared reason line (D-111). */}
                <WhyNot reason={approveBlocked} />
                <div className="note" style={{ marginTop: 8 }}>
                  <Link href={`/events/${eventId}/talks/${selected.slot_id}/inspection?v=${selected.file_version_id}`}>
                    Full check report for v{selected.version_number} →
                  </Link>
                  {" · "}Shortcuts: <span className="kbd">A</span> approve · <span className="kbd">R</span> ask for changes
                </div>
              </div>
            </div>

            {confirmApprove && !approveBlocked && (
              <ConfirmInline
                question={`Approve v${selected.version_number} of “${selected.title}”?`}
                detail={
                  selected.room
                    ? `It is copied to ${selected.room}'s PC. If the room already has an older version, the room technician switches to this one there.`
                    : "Its session has no room yet, so no room PC will get it until it has one."
                }
                confirmLabel="Approve"
                busyLabel="Approving…"
                onConfirm={() => decide("approve")}
                onClose={() => setConfirmApprove(false)}
              />
            )}

            {pending && (
              <form
                style={{
                  border: `1px solid ${pending === "reject" ? "var(--block)" : "var(--warn)"}`,
                  borderRadius: 6,
                  padding: 12,
                  marginTop: 10,
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (message.trim()) void decide(pending, message.trim());
                }}
              >
                <label htmlFor="speaker-message" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
                  {pending === "reject" ? "Why is it rejected?" : "What should the speaker change?"}
                </label>
                {/* R29: what this choice does, said when it's chosen rather than always (D-123). */}
                <div className="note" style={{ marginBottom: 6 }}>
                  {pending === "reject"
                    ? "This file won't be used at all (the wrong deck, say); the speaker must send a different one."
                    : "The speaker fixes what you describe and uploads a new version."}{" "}
                  Your message is emailed to them with a link to upload again, and shown in their portal.
                </div>
                <textarea
                  id="speaker-message"
                  autoFocus
                  rows={4}
                  maxLength={5000}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                  placeholder={
                    pending === "reject"
                      ? "e.g. This is last year's deck — please upload the version for this event."
                      : "e.g. Please embed your fonts and export the video on slide 12 as H.264 .mp4."
                  }
                  style={{ width: "100%", resize: "vertical", font: "inherit" }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    type="submit"
                    className={pending === "reject" ? "btn danger" : "btn warnb"}
                    disabled={busy || !message.trim()}
                  >
                    {busy ? "Sending…" : pending === "reject" ? "Reject and tell the speaker" : "Ask the speaker for changes"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => {
                      setPending(null);
                      setMessage("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
                <WhyNot reason={!message.trim() ? "Write the message to the speaker to continue." : null} />
              </form>
            )}

            {/* Real comments (D-070), below the decision and quieter (D-123). */}
            <CommentsPanel versionId={selected.file_version_id} versionNumber={selected.version_number} />
          </div>
        </div>
      )}

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </>
  );
}
