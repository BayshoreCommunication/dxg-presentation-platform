"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ArchiveScope, PdfProgress } from "@/lib/api";
import { buildArchive, deliverArchive, archiveDownloadUrl, convertArchivePdfs, ApiError } from "@/lib/api";
import { DownloadLog } from "@/components/DownloadLog";
import { Chip } from "@/components/Chip";
import { WhyNot } from "@/components/WhyNot";
import { ARCHIVE_STATE, formatBytes, formatDate, plural, wordsFor } from "@pmp/format";

/** Chip tone per archive state; the words come from ARCHIVE_STATE (S39, D-110). */
const STATE_TONE: Record<string, string> = {
  draft: "canceled",
  failed: "attention",
  building: "submitted",
  ready: "submitted",
  delivered: "synchronized_onsite",
  expired: "needs_revision",
  deleted: "attention",
};

/**
 * S43 (D-113): where each exclusion reason is fixed. The reasons are the API's fixed
 * sentences (services/archive.ts). Every row also opens its presentation; for
 * "restricted from distribution" that page is the only place to look.
 */
const EXCLUSION_FIX: Record<string, { path: string; label: string }> = {
  "no approved version": { path: "review", label: "Manage presentations" },
  "speaker withheld permission": { path: "speakers", label: "Release permission on Speakers" },
  "release permission not set": { path: "speakers", label: "Set release permission on Speakers" },
};

/** Screen 10 — scope, options, and the package itself. */
export function ArchiveView({ eventId, initial }: { eventId: string; initial: ArchiveScope }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const pkg = initial.latest_package;
  // The real reason Deliver is unavailable, shown under the buttons too (D-108). It said
  // "still being built" for a package already delivered, and after a failed build (which
  // leaves the package as a draft).
  const deliverBlocked = !pkg
    ? "Build a package first."
    : pkg.archive_state === "delivered"
      ? `Already delivered to the client${pkg.link_expires_at ? ` — their download link works until ${new Date(pkg.link_expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}.`
      : pkg.archive_state === "expired"
        ? "The client's download link has expired. Rebuild and deliver again to share a new one."
        : pkg.archive_state === "building"
          ? "The package is still being built — this page updates when it is ready."
          : pkg.archive_state !== "ready"
            ? "The last build didn't finish. Check any message above, then rebuild the package."
            : null;
  // Why Build is greyed, shown on the page as well as on hover (D-111).
  const buildBlocked =
    initial.included.length > 0
      ? null
      : initial.excluded.length > 0
        ? "Nothing can be packaged yet — the Excluded list above says why for each presentation."
        : "Nothing is approved yet — the package only holds approved presentations.";
  const pdf = initial.pdf;
  // A package left as a draft is a build that stopped (D-108), so it reads "Build stopped";
  // no package at all reads "Not built yet" (S39, D-110).
  const stateCode = !pkg ? "draft" : pkg.archive_state === "draft" ? "failed" : pkg.archive_state;
  const state = wordsFor(ARCHIVE_STATE, stateCode);
  const expiry = expirySentence(initial.rules, pkg?.link_expires_at ?? null);

  // While PDFs are converting, re-read every few seconds so the count moves on its own.
  const converting = pdf.in_progress > 0;
  useEffect(() => {
    if (!converting) return;
    const handle = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(handle);
  }, [converting, router]);

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      setToast(await work());
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 5000);
    }
  }

  return (
    <>
      <h1 className="htitle">Post-event archive builder</h1>
      {error && <div className="err">{error}</div>}

      <div className="card">
        <div className="chd">
          <h3>Scope</h3>
          <span className="m">whole event · 30-day retention</span>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          <table>
            <tbody>
              <tr>
                <td>Rule</td>
                <td>Approved final of each talk, its earlier versions, and every email sent for the event</td>
              </tr>
              <tr>
                <td>Rooms</td>
                <td className="num">{initial.rooms}</td>
              </tr>
              <tr>
                <td>Days</td>
                <td className="num">{initial.days}</td>
              </tr>
              <tr>
                <td>Included</td>
                <td>
                  <b className="num">{plural(initial.included.length, "final file")}</b> ·{" "}
                  <span className="mono">{formatBytes(initial.total_bytes)}</span>
                </td>
              </tr>
              <tr>
                <td>Earlier versions</td>
                <td className="num">{initial.earlier_versions}</td>
              </tr>
              <tr>
                <td>Emails</td>
                <td>
                  <span className="num">{plural(initial.emails, "email")}</span>{" "}
                  <span className="note">(personal sign-in links are removed)</span>
                </td>
              </tr>
              <tr>
                <td>Excluded</td>
                <td>
                  {initial.excluded.length > 0 ? (
                    <span className="chip c-bad">{initial.excluded.length} excluded</span>
                  ) : (
                    <span className="chip c-ok">none</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {initial.excluded.length > 0 && (
        <div className="card">
          <div className="chd">
            <h3>Excluded · {initial.excluded.length}</h3>
            <span className="m">counted and explained, never silently dropped</span>
          </div>
          <div className="cbd" style={{ padding: "0 0 4px" }}>
            <table>
              <tbody>
                {initial.excluded.map((row, index) => (
                  <tr key={`${row.title}-${index}`}>
                    <td>
                      <Link href={`/events/${eventId}/talks/${row.slot_id}`}>{row.title}</Link>
                      {row.speaker ? ` — ${row.speaker}` : ""}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span className="chip c-mut">{row.reason}</span>
                      {EXCLUSION_FIX[row.reason] && (
                        <div className="note" style={{ marginTop: 4 }}>
                          <Link href={`/events/${eventId}/${EXCLUSION_FIX[row.reason]!.path}`}>
                            {EXCLUSION_FIX[row.reason]!.label} →
                          </Link>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="chd">
          <h3>Package</h3>
          <Chip status={STATE_TONE[stateCode] ?? "canceled"} label={state.label} />
        </div>
        <div className="cbd">
          {/* What the state means and what to do next; the Deliver reason below covers the rest. */}
          {(!pkg || !deliverBlocked) && (
            <p className="note" style={{ margin: "0 0 10px" }}>
              {state.meaning} {state.next ? `Next: ${state.next}` : ""}
            </p>
          )}
          {/*
            These were two ticked, read-only checkboxes — options that looked choosable and
            were not. They are the package's rules, stated for this event (D-080).
          */}
          <ul className="note" style={{ margin: "0 0 12px", paddingLeft: 18, lineHeight: 1.7 }}>
            {/* Was "manifest: file, version, checksum…" (S41, D-112). */}
            <li>Every package includes a contents list: each file, its version and who approved it.</li>
            <li>{expiry} Every download is logged.</li>
          </ul>

          <PdfStatus eventId={eventId} pdf={pdf} busy={busy} run={run} />

          {pkg && (
            <div className="note" style={{ marginBottom: 10 }}>
              PowerPoint package: {plural(pkg.manifest?.file_count ?? 0, "file")}
              {pkg.has_pdf ? ` · PDF package: ${plural(pkg.manifest?.pdf?.file_count ?? 0, "file")}` : " · no PDF package (built before PDFs — rebuild)"} ·{" "}
              {plural(Number(pkg.downloads), "download")} logged
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn pri"
              disabled={busy || initial.included.length === 0}
              title={buildBlocked ?? undefined}
              onClick={() =>
                void run(async () => {
                  const result = await buildArchive(eventId);
                  return `Built · PowerPoint ${plural(result.file_count, "file")} · PDF ${plural(result.pdf_file_count, "file")}${
                    result.pdf_not_converted > 0 ? ` (${result.pdf_not_converted} not converted yet)` : ""
                  } · ${result.excluded} excluded`;
                })
              }
            >
              {pkg ? "Rebuild package" : "Build package"}
            </button>
            <button
              className="btn"
              disabled={busy || !pkg || pkg.archive_state !== "ready"}
              title={deliverBlocked ?? undefined}
              onClick={() =>
                void run(async () => {
                  const result = await deliverArchive(pkg!.id);
                  return `Delivered to the client portal · their link works until ${new Date(result.link_expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
                })
              }
            >
              Deliver to client portal
            </button>
            {pkg?.archive_state === "delivered" && (
              <>
                <a className="btn" href={archiveDownloadUrl(pkg.id, "pptx")}>
                  Download PowerPoint package
                </a>
                {pkg.has_pdf && (
                  <a className="btn" href={archiveDownloadUrl(pkg.id, "pdf")}>
                    Download PDF package
                  </a>
                )}
              </>
            )}
          </div>
          {/* One line under the row (D-111): Build's reason first — it blocks Deliver too. */}
          <WhyNot reason={buildBlocked ?? (pkg ? deliverBlocked : null)} />
          {/* S42 (D-113): a rebuild does not replace what the client already has. */}
          {pkg && (pkg.archive_state === "delivered" || pkg.archive_state === "expired") && !buildBlocked && (
            <div className="note" style={{ marginTop: 6 }}>
              Rebuilding creates a new package; deliver it again to update the client&rsquo;s download.
            </div>
          )}

          {/* The checksum check, in plain words (S41, D-112). */}
          <div className="note" style={{ marginTop: 10 }}>
            Every file is checked as it is packaged. If a file in storage has changed or is damaged, the
            build stops and nothing is sent to the client — contact DXG support.
          </div>
        </div>
      </div>

      <DownloadLog downloads={initial.downloads} />

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </>
  );
}

/**
 * The client link's expiry as one readable sentence (S40, D-110). It used to state the rule
 * and a second, different ISO date side by side. The link runs RETENTION days past the
 * event's end, or longer when delivered late (never shorter than the API's minimum).
 */
function expirySentence(rules: ArchiveScope["rules"], expiresAt: string | null): string {
  const days = rules.retention_days;
  const ruleDate = rules.event_ends_on ? addDays(rules.event_ends_on, days) : null;
  const why = (date: string) => (date === ruleDate ? ` (${days} days after the event ends)` : "");
  if (expiresAt) {
    const date = expiresAt.slice(0, 10);
    return `The client's download link expires ${formatDate(date)}${why(date)}.`;
  }
  const ifNow = rules.link_expires_if_delivered_now?.slice(0, 10);
  if (ifNow) return `Delivered today, the client's download link would expire ${formatDate(ifNow)}${why(ifNow)}.`;
  return `The client's download link expires ${days} days after the event ends.`;
}

/** "2026-03-12" + 30 → "2026-04-11", on the calendar, not through a time zone. */
function addDays(date: string, days: number): string {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/**
 * Where PDF conversion stands (D-067): "141 of 187 converted", what is still running,
 * and every failure by name with its reason — a talk missing from the PDF package is
 * explained here before anyone builds, not discovered by the client afterwards.
 */
function PdfStatus({
  eventId,
  pdf,
  busy,
  run,
}: {
  eventId: string;
  pdf: PdfProgress;
  busy: boolean;
  run: (work: () => Promise<string>) => Promise<void>;
}) {
  const remaining = pdf.not_started;
  const done = pdf.eligible > 0 && pdf.converted === pdf.eligible;
  return (
    <div className="lane int" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span>
          <b>PDF conversion</b> ·{" "}
          <span className="num">
            {pdf.converted} of {pdf.eligible}
          </span>{" "}
          converted
          {pdf.in_progress > 0 && ` · ${pdf.in_progress} converting now`}
          {pdf.failed.length > 0 && ` · ${pdf.failed.length} failed`}
          {done && " · all done"}
        </span>
        <span style={{ display: "flex", gap: 6 }}>
          {remaining > 0 && (
            <button
              type="button"
              className="btn"
              disabled={busy || !pdf.converter_available}
              onClick={() =>
                void run(async () => {
                  const { queued } = await convertArchivePdfs(eventId);
                  // "queued" read as system talk (D-112).
                  return `${queued} file${queued === 1 ? "" : "s"} will be converted to PDF shortly`;
                })
              }
            >
              Convert {remaining} to PDF
            </button>
          )}
          {pdf.failed.length > 0 && (
            <button
              type="button"
              className="btn"
              disabled={busy || !pdf.converter_available}
              onClick={() =>
                void run(async () => {
                  const { queued } = await convertArchivePdfs(eventId, true);
                  return `Trying ${queued} failed file${queued === 1 ? "" : "s"} again`;
                })
              }
            >
              Retry failed
            </button>
          )}
        </span>
      </div>
      <div className="bar" style={{ margin: "8px 0 4px" }}>
        <i style={{ width: `${pdf.eligible === 0 ? 0 : Math.round((pdf.converted / pdf.eligible) * 100)}%` }} />
      </div>
      {!pdf.converter_available && (
        <div className="note" style={{ color: "var(--block)" }}>
          PDF copies can&rsquo;t be made right now. Contact DXG support; the PowerPoint package can still
          be built and delivered.
        </div>
      )}
      <div className="note">
        Approved files convert automatically in the background. Speakers with &ldquo;PDF only&rdquo; permission go in the
        PDF package only. Build (or rebuild) the package once conversion finishes.
      </div>
      {pdf.failed.length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13 }}>
          {pdf.failed.map((row, index) => (
            <li key={`${row.title}-${index}`}>
              {row.title}
              {row.speaker ? ` — ${row.speaker}` : ""}: <span className="note">{row.error}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
