"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { QueueItem } from "@/lib/api";
import { transitionVersion, ApiError } from "@/lib/api";
import { Chip, SeverityChip } from "@/components/Chip";
import { CommentsPanel } from "@/components/CommentsPanel";
import { SlidePreview } from "@/components/SlidePreview";
import { CHECK, formatBytes, INSPECTION_STATE, SEVERITY, VERSION_STATE, wordsFor } from "@pmp/format";

const FINDING_COPY: Record<string, (detail: Record<string, unknown>) => string> = {
  codec: (detail) =>
    `Slide ${(detail.slide_refs as number[] | undefined)?.join(", ") ?? "?"} · video uses ${String(detail.codec ?? "an unsupported codec")}. The room PCs are only guaranteed to play ${String(detail.expected ?? "H.264")} — it may stutter or fail in the room.`,
  fonts: () => "Fonts are not embedded — the deck may reflow on the room machine.",
  linked_media: (detail) =>
    `Linked (not embedded) media on slide ${(detail.slide_refs as number[] | undefined)?.join(", ") ?? "?"}.`,
};


/** Inspection states in which the automated checks have not finished (D-108). */
const CHECKING = ["pending", "inspecting", "technician_review"];

export function ReviewWorkspace({ initialQueue }: { initialQueue: QueueItem[] }) {
  const router = useRouter();
  const [queue, setQueue] = useState(initialQueue);
  const [selectedId, setSelectedId] = useState(initialQueue[0]?.file_version_id ?? null);
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
        setToast(
          result.review_state === "approved"
            ? `Approved — queued for ${result.rooms_queued} room${result.rooms_queued === 1 ? "" : "s"}`
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
      if ((event.key === "a" || event.key === "A") && !approveBlocked) void decide("approve");
      // R opens the message form rather than acting: a revision needs a reason.
      if (event.key === "r" || event.key === "R") setPending("request_changes");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, approveBlocked]);

  return (
    <>
      <h1 className="htitle">Review presentations</h1>

      {error && <div className="err">{error}</div>}

      <div className="card">
        <div className="chd">
          <h3>Waiting for review · {queue.length}</h3>
          <span className="m">
            oldest first · <span className="kbd">A</span> approve ·{" "}
            <span className="kbd">R</span> request revision
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

            {/* Only findings that need a decision are shown here; the informational
                ones are counted, with the full report a click away. */}
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

            {CHECKING.includes(selected.inspection_state) ? (
              <div className="lane int">
                <b>Checks still running</b>
                <br />
                The automated file checks usually finish within a minute. Approve becomes available
                when they are done.
              </div>
            ) : selected.findings.some((finding) => finding.severity !== "info") ? null : (
              <div className="lane int">
                <b>Checks passed</b>
                <br />
                Nothing needs a decision — {selected.findings.length} informational result
                {selected.findings.length === 1 ? "" : "s"} in the inspection report.
              </div>
            )}

            {/* Real comments (D-070). Two invented ones used to sit here on every file. */}
            <CommentsPanel versionId={selected.file_version_id} versionNumber={selected.version_number} />

            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <button className="btn good" disabled={busy || approveBlocked !== null} onClick={() => void decide("approve")}>
                Approve (A)
              </button>
              <button className="btn warnb" disabled={busy} onClick={() => setPending("request_changes")}>
                Request revision (R)
              </button>
              <button className="btn danger" disabled={busy} onClick={() => setPending("reject")}>
                Reject…
              </button>
            </div>
            {approveBlocked && (
              <div className="note" style={{ marginTop: 8 }}>
                {approveBlocked}
              </div>
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
                <div className="note" style={{ marginBottom: 6 }}>
                  Emailed to the speaker with a link to upload again, and shown in their portal. Required.
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
                    {busy ? "Sending…" : pending === "reject" ? "Reject and tell the speaker" : "Send back to the speaker"}
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
              </form>
            )}
          </div>
        </div>
      )}

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </>
  );
}
