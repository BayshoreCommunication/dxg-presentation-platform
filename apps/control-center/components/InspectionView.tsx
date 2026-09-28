"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FindingRow, PresentationDetail, VersionRow } from "@/lib/api";
import { waiveFinding, requestRevision, ApiError } from "@/lib/api";
import { WhyNot } from "@/components/WhyNot";
import { CHECK, formatBytes, INSPECTION_STATE, SEVERITY, VERSION_STATE, wordsFor } from "@pmp/format";

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
        body: `${String(detail.file ?? "A video")}${slides ? ` (slide ${slides})` : ""} uses ${String(detail.codec ?? detail.container ?? "an unverified codec")}. The room PCs are only guaranteed to play ${String(detail.expected ?? "H.264")} — it may stutter or fail in the room.`,
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
        body: "The file contains macros. Macros are blocked on the room PCs for security, so anything depending on them will not run.",
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
    default: {
      // R21 (D-110): a check without its own copy still reads as words — never raw JSON.
      const words = wordsFor(CHECK, finding.check_code);
      return {
        title: words.label,
        body: words.meaning || `${wordsFor(SEVERITY, finding.severity).label}. Open the file to see the detail.`,
      };
    }
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
  const [form, setForm] = useState<{ id: string; kind: "waive" | "revision"; text: string } | null>(null);
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
  // A file the virus check held back never reaches the other checks: say that, not "running".
  const heldBack = version.processing_state === "quarantined" || version.processing_state === "checksum_failed";
  const checksWords = heldBack
    ? wordsFor(VERSION_STATE, version.processing_state)
    : wordsFor(INSPECTION_STATE, version.inspection_state);
  const checksRunning = !heldBack && (version.inspection_state === "pending" || version.inspection_state === "inspecting");
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
              {counts.blocking} {SEVERITY.blocking!.label.toLowerCase()}
            </span>{" "}
            <span className={`chip ${counts.warning > 0 ? "c-warn" : "c-mut"}`}>
              {counts.warning} {SEVERITY.warning!.label.toLowerCase()}
              {counts.warning === 1 ? "" : "s"}
            </span>{" "}
            <span className="chip c-info">
              {counts.info} {SEVERITY.info!.label.toLowerCase()}
              {counts.info === 1 ? "" : "s"}
            </span>
          </span>
        </div>
        <div className="cbd">
          {/* R23 (D-110): where the checks are, in words, with what it means. */}
          <div className="note" style={{ marginBottom: 8 }}>
            <b>{checksWords.label}</b>
            {checksWords.meaning ? ` — ${checksWords.meaning}` : ""}
            {checksWords.next ? ` ${checksWords.next}` : ""}
          </div>
          {initialFindings.length === 0 && (
            <div className="empty">
              {checksRunning ? "The file checks are still running — refresh in a minute." : "No findings for this version."}
            </div>
          )}

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
                  <div style={{ margin: "-2px 0 10px 12px" }}>
                    {/*
                      Inline forms, not window.prompt (D-108): the prompt came pre-filled with an
                      invented waiver reason, and embedded browsers cancel it silently. A revision
                      request used to email the speaker a message nobody on staff had seen.
                    */}
                    {form?.id === finding.id ? (
                      <form
                        style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 10, maxWidth: 640 }}
                        onSubmit={(event) => {
                          event.preventDefault();
                          const text = form.text.trim();
                          if (!text) return;
                          void act(async () => {
                            if (form.kind === "waive") {
                              await waiveFinding(finding.id, text);
                              setForm(null);
                              return "Waived — the reason stays on record with the finding";
                            }
                            await requestRevision(version.file_version_id, { finding_id: finding.id, note: text });
                            setForm(null);
                            return "Sent to the speaker — they get an email and see it in their portal";
                          });
                        }}
                      >
                        <label htmlFor={`form-${finding.id}`} style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
                          {form.kind === "waive"
                            ? "Why is it OK to accept this? (kept on record)"
                            : "Message to the speaker (edit before sending)"}
                        </label>
                        <textarea
                          id={`form-${finding.id}`}
                          rows={form.kind === "waive" ? 2 : 4}
                          style={{ width: "100%" }}
                          value={form.text}
                          onChange={(event) => setForm({ ...form, text: event.target.value })}
                          placeholder={form.kind === "waive" ? "e.g. tested on the room PC, plays fine" : undefined}
                          autoFocus
                        />
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button className={form.kind === "waive" ? "btn warnb" : "btn pri"} disabled={busy || !form.text.trim()}>
                            {form.kind === "waive" ? "Waive with this reason" : "Send to speaker"}
                          </button>
                          <button type="button" className="btn" onClick={() => setForm(null)}>
                            Cancel
                          </button>
                        </div>
                        {/* D-111: the empty-text reason, on the page. */}
                        <WhyNot
                          reason={
                            form.text.trim()
                              ? null
                              : form.kind === "waive"
                                ? "Write the reason above to continue."
                                : "Write the message to the speaker to continue."
                          }
                        />
                      </form>
                    ) : (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <button
                          className="btn"
                          disabled={busy}
                          onClick={() =>
                            setForm({
                              id: finding.id,
                              kind: "revision",
                              text: `${copy.title}: ${copy.body}${copy.fix ? ` ${copy.fix}` : ""}`,
                            })
                          }
                        >
                          Ask the speaker to fix this
                        </button>
                        {finding.check_code === "malware" ? (
                          <span className="note">
                            A virus finding can&rsquo;t be waived — the speaker needs to provide a clean file.
                          </span>
                        ) : (
                          <button
                            className="btn warnb"
                            disabled={busy}
                            onClick={() => setForm({ id: finding.id, kind: "waive", text: "" })}
                          >
                            Waive (accept anyway)
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="note" style={{ marginTop: 10 }}>
            Automated checks can&rsquo;t judge content, design or how animations behave on the room PC —
            the reviewer decides those. A blocking problem prevents approval until a Presentation
            Manager waives it with a reason, or the speaker sends a fixed file.
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
