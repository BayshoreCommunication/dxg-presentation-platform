"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { QueueItem } from "@/lib/api";
import { transitionVersion, ApiError } from "@/lib/api";
import { Chip, SeverityChip } from "@/components/Chip";

const FINDING_COPY: Record<string, (detail: Record<string, unknown>) => string> = {
  codec: (detail) =>
    `Slide ${(detail.slide_refs as number[] | undefined)?.join(", ") ?? "?"} · video uses ${String(detail.codec ?? "an unsupported codec")}. The room playback profile guarantees ${String(detail.expected ?? "H.264")} only — it may stutter or fail on this fleet.`,
  fonts: () => "Fonts are not embedded — the deck may reflow on the room machine.",
  linked_media: (detail) =>
    `Linked (not embedded) media on slide ${(detail.slide_refs as number[] | undefined)?.join(", ") ?? "?"}.`,
};

const mb = (bytes: string) => `${Math.round(Number(bytes) / 1_000_000)} MB`;

export function ReviewWorkspace({ initialQueue }: { initialQueue: QueueItem[] }) {
  const router = useRouter();
  const [queue, setQueue] = useState(initialQueue);
  const [selectedId, setSelectedId] = useState(initialQueue[0]?.file_version_id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setQueue(initialQueue);
    setSelectedId((current) =>
      current && initialQueue.some((item) => item.file_version_id === current)
        ? current
        : (initialQueue[0]?.file_version_id ?? null),
    );
  }, [initialQueue]);

  const selected = queue.find((item) => item.file_version_id === selectedId) ?? null;

  const decide = useCallback(
    async (action: "claim" | "approve" | "request_changes" | "reject") => {
      if (!selected || busy) return;
      setBusy(true);
      setError(null);
      try {
        let reason: string | undefined;
        if (action === "reject") {
          reason = window.prompt("Reason (required):") ?? "";
          if (!reason.trim()) {
            setError("A rejection must record a reason — nothing was changed.");
            return;
          }
        }

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
          ...(reason ? { reason } : {}),
        });

        setToast(
          result.review_state === "approved"
            ? `Approved — delta manifest queued for ${result.rooms_queued} room${result.rooms_queued === 1 ? "" : "s"}`
            : result.review_state === "changes_requested"
              ? "Revision requested — speaker notified via speaker-visible comment"
              : result.review_state === "rejected"
                ? "Rejected — speaker and client admin notified"
                : `Claimed · now ${result.review_state.replace("_", " ")}`,
        );

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
        setTimeout(() => setToast(null), 3200);
      }
    },
    [selected, busy, router],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "a" || event.key === "A") void decide("approve");
      if (event.key === "r" || event.key === "R") void decide("request_changes");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide]);

  return (
    <>
      <h1 className="htitle">Review &amp; approval</h1>

      {error && <div className="err">{error}</div>}

      <div className="card">
        <div className="chd">
          <h3>Queue · {queue.length}</h3>
          <span className="m">
            oldest first · <span className="kbd">A</span> approve ·{" "}
            <span className="kbd">R</span> request revision
          </span>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          {queue.length === 0 ? (
            <div className="empty">Queue clear — every submitted presentation has been decided.</div>
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
                      {item.findings.length > 0 ? (
                        <SeverityChip severity={item.findings[0]!.severity} />
                      ) : (
                        <Chip status="submitted" label="Submitted" />
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
              v{selected.version_number} · {mb(selected.size_bytes)} · {selected.room}
            </span>
          </div>
          <div className="cbd">
            <div className="slides">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index}>{index + 1}</div>
              ))}
            </div>
            <div className="note" style={{ margin: "10px 0 4px" }}>
              Slide previews render in M2-7; the decision path below is live.
            </div>

            {selected.findings.map((finding, index) => (
              <div className="lane cli" key={`${finding.check_code}-${index}`}>
                <b>
                  {finding.severity === "blocking" ? "⛔" : "⚠"} {finding.severity} ·{" "}
                  {finding.check_code.replace("_", " ")}
                </b>
                <br />
                {FINDING_COPY[finding.check_code]?.(finding.detail) ??
                  JSON.stringify(finding.detail)}
              </div>
            ))}

            <div className="note" style={{ margin: "12px 0 4px" }}>
              Comment lanes:
            </div>
            <div className="lane int">
              <b>M. Vega</b>
              <span className="aud">Internal</span>
              <br />
              Fallback behaviour acceptable — transcode pipeline covers the clip.
            </div>
            <div className="lane spk">
              <b>To speaker</b>
              <span className="aud">Speaker</span>
              <br />
              Approved with a note: export videos as H.264 .mp4 next time.
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <button className="btn good" disabled={busy} onClick={() => void decide("approve")}>
                Approve (A)
              </button>
              <button className="btn warnb" disabled={busy} onClick={() => void decide("request_changes")}>
                Request revision (R)
              </button>
              <button className="btn danger" disabled={busy} onClick={() => void decide("reject")}>
                Reject…
              </button>
              <span className="note" style={{ alignSelf: "center" }}>
                state: <span className="mono">{selected.review_state}</span> · lock{" "}
                <span className="mono">{selected.lock_version}</span>
              </span>
            </div>
          </div>
        </div>
      )}

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </>
  );
}
