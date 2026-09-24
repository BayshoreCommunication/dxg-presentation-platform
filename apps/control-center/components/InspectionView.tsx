"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FindingRow, PresentationDetail, VersionRow } from "@/lib/api";
import { waiveFinding, requestRevision, ApiError } from "@/lib/api";
import { formatBytes } from "@pmp/format";

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

/** Plain-language explanation per check, with the slide references the checker found. */
function explain(finding: FindingRow): { title: string; body: string; fix?: string } {
  const detail = finding.detail;
  const slides = (detail.slide_refs as number[] | undefined)?.join(", ");
  switch (finding.check_code) {
    case "codec":
      return {
        title: "Video codec outside the room profile",
        body: `${String(detail.file ?? "A video")}${slides ? ` (slide ${slides})` : ""} uses ${String(detail.codec ?? detail.container ?? "an unverified codec")}. The room playback profile guarantees ${String(detail.expected ?? "H.264")} only — it may stutter or fail on this fleet.`,
        fix: "Re-export the clip as H.264 .mp4 and re-insert it, or upload the clip separately and DXG will convert it.",
      };
    case "linked_media":
      return {
        title: "Linked (not embedded) media",
        body: `${String(detail.count ?? "Some")} media reference(s) point at files outside the deck${slides ? ` (slide ${slides})` : ""}. Linked files do not travel with the presentation and will be missing in the room.`,
        fix: "Embed the media in the deck, or send the files to DXG.",
      };
    case "fonts":
      return {
        title: "Fonts are not embedded",
        body: "The deck relies on fonts that may not exist on the room machine, so text can reflow or substitute.",
        fix: "Save with 'Embed fonts in the file' enabled.",
      };
    case "aspect": {
      const matches = detail.aspect === detail.room_profile;
      return matches
        ? {
            title: "Slide size",
            body: `${String(detail.aspect)} — matches the room profile.`,
          }
        : {
            title: "Slide size differs from the room profile",
            body: `The deck is ${String(detail.aspect)} and the room is set up for ${String(detail.room_profile)}. It will letterbox or crop.`,
            fix: "Re-save at the room's slide size if the layout matters.",
          };
    }
    case "macros":
      return {
        title: "Macro-enabled content",
        body: "The file contains macros. Macros are blocked on the room fleet for security, so anything depending on them will not run.",
        fix: "Save the deck without macros.",
      };
    case "malware":
      return {
        title: "Security scan failed",
        body: `The scanner flagged this file${detail.signature ? ` (${String(detail.signature)})` : ""}. It was quarantined and never entered the library; the approved version is untouched.`,
      };
    case "corruption":
      return {
        title: "File could not be opened",
        body: String(detail.reason ?? "The file did not parse as a presentation."),
        fix: "Re-save the deck and upload it again.",
      };
    case "metadata":
      if (detail.slides !== undefined) return { title: "Slide count", body: `${String(detail.slides)} slides.` };
      if (detail.embedded_media !== undefined)
        return { title: "Embedded media", body: `${String(detail.embedded_media)} embedded media file(s).` };
      return {
        title: "File size",
        body: `${formatBytes(detail.bytes as number)} — within the 10 GB limit.`,
      };
    default:
      return { title: finding.check_code.replace("_", " "), body: JSON.stringify(detail) };
  }
}

/** Screen 7 — the inspection report, its waivers, and the action it leads to. */
export function InspectionView({
  eventId,
  detail,
  version,
  initialFindings,
}: {
  eventId: string;
  detail: PresentationDetail;
  version: VersionRow | null;
  initialFindings: FindingRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  if (!version) {
    return (
      <>
        <h1 className="htitle">Inspection report</h1>
        <div className="card">
          <div className="empty">No file has been received for this talk yet.</div>
        </div>
      </>
    );
  }

  const open = initialFindings.filter((finding) => !finding.waived_at);
  const counts = {
    blocking: open.filter((finding) => finding.severity === "blocking").length,
    warning: open.filter((finding) => finding.severity === "warning").length,
    info: open.filter((finding) => finding.severity === "info").length,
  };

  async function act(work: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      setToast(await work());
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 4500);
    }
  }

  return (
    <>
      <h1 className="htitle">
        Inspection report ·{" "}
        <span className="mono" style={{ fontSize: 16 }}>
          v{version.version_number}
        </span>
      </h1>
      <div className="note" style={{ margin: "-8px 0 14px" }}>
        {detail.talk.title} · {detail.speaker?.name} ·{" "}
        <Link href={`/events/${eventId}/talks/${detail.talk.slot_id}`}>back to presentation detail</Link>
      </div>

      {error && <div className="err">{error}</div>}

      <div className="card">
        <div className="chd">
          <h3>Findings</h3>
          <span>
            <span className={`chip ${counts.blocking > 0 ? "c-bad" : "c-mut"}`}>
              {counts.blocking} blocking
            </span>{" "}
            <span className={`chip ${counts.warning > 0 ? "c-warn" : "c-mut"}`}>
              {counts.warning} warning
            </span>{" "}
            <span className="chip c-info">{counts.info} informational</span>
          </span>
        </div>
        <div className="cbd">
          {initialFindings.length === 0 && <div className="empty">Inspection has not run yet.</div>}

          {initialFindings.map((finding) => {
            const copy = explain(finding);
            const lane =
              finding.severity === "blocking" ? "cli" : finding.severity === "warning" ? "cli" : "int";
            return (
              <div key={finding.id}>
                <div className={`lane ${lane}`} style={finding.waived_at ? { opacity: 0.65 } : undefined}>
                  <b>
                    {finding.severity === "blocking" ? "⛔" : finding.severity === "warning" ? "⚠" : "ℹ"}{" "}
                    {copy.title}
                  </b>
                  <br />
                  {copy.body}
                  {copy.fix && (
                    <>
                      <br />
                      <b>Suggested fix:</b> {copy.fix}
                    </>
                  )}
                  {finding.waived_at && (
                    <div className="note" style={{ marginTop: 6 }}>
                      <span className="chip c-mut">Waived</span> by {finding.waived_by} ·{" "}
                      {when(finding.waived_at, detail.event.timezone)} — “{finding.waived_reason}” · stays visible in the audit
                      trail
                    </div>
                  )}
                </div>
                {!finding.waived_at && finding.severity !== "info" && (
                  <div style={{ display: "flex", gap: 8, margin: "-2px 0 10px 12px", flexWrap: "wrap" }}>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const note = `${copy.title}: ${copy.body}${copy.fix ? ` ${copy.fix}` : ""}`;
                          const result = await requestRevision(version.file_version_id, {
                            finding_id: finding.id,
                            note,
                          });
                          return `Revision requested — the speaker sees this finding as a comment (${result.review_state.replace("_", " ")})`;
                        })
                      }
                    >
                      Request revision (prefilled)
                    </button>
                    <button
                      className="btn warnb"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const reason = window.prompt(
                            "Waive finding — reason (required):",
                            "fallback verified on the room build",
                          );
                          if (reason === null) return "Nothing waived";
                          if (!reason.trim()) throw new ApiError("waiver", "A waiver needs a reason.", 422);
                          await waiveFinding(finding.id, reason);
                          return "Finding waived — the waiver and its reason stay visible forever";
                        })
                      }
                    >
                      Waive finding
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          <div className="note" style={{ marginTop: 10 }}>
            Automated checks cannot judge content, design, or how animations behave on the room fleet —
            the reviewer and the fidelity test decide those. A blocking finding prevents approval until
            it is waived by a Presentation Manager, with a reason.
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Link className="btn pri" href={`/events/${eventId}/review`}>
              Open in review workspace →
            </Link>
            <Link className="btn" href={`/events/${eventId}/talks/${detail.talk.slot_id}`}>
              Version history
            </Link>
          </div>
        </div>
      </div>

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </>
  );
}
