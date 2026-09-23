"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ArchiveScope, PdfProgress } from "@/lib/api";
import { buildArchive, deliverArchive, archiveDownloadUrl, convertArchivePdfs, ApiError } from "@/lib/api";
import { DownloadLog } from "@/components/DownloadLog";
import { Chip } from "@/components/Chip";
import { formatBytes } from "@pmp/format";


const STATE_TONE: Record<string, string> = {
  draft: "canceled",
  building: "submitted",
  ready: "submitted",
  delivered: "synchronized_onsite",
  expired: "needs_revision",
  deleted: "attention",
};

/** Screen 10 — scope, options, and the package itself. */
export function ArchiveView({ eventId, initial }: { eventId: string; initial: ArchiveScope }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const pkg = initial.latest_package;
  const pdf = initial.pdf;

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
                  <b className="num">{initial.included.length}</b> final files ·{" "}
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
                  <span className="num">{initial.emails}</span>{" "}
                  <span className="note">personal sign-in links are removed</span>
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
                      {row.title}
                      {row.speaker ? ` — ${row.speaker}` : ""}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span className="chip c-mut">{row.reason}</span>
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
          {pkg ? (
            <Chip status={STATE_TONE[pkg.archive_state] ?? "canceled"} label={pkg.archive_state} />
          ) : (
            <Chip status="canceled" label="Not built" />
          )}
        </div>
        <div className="cbd">
          <label style={{ display: "block", marginBottom: 6 }}>
            <input type="checkbox" checked readOnly /> Include manifest (file · version · checksum ·
            approval record)
          </label>
          <label style={{ display: "block", marginBottom: 12 }}>
            <input type="checkbox" checked readOnly /> Client link expires 30 days after the event ends ·
            every download logged
          </label>

          <PdfStatus eventId={eventId} pdf={pdf} busy={busy} run={run} />

          {pkg && (
            <div className="note" style={{ marginBottom: 10 }}>
              PowerPoint package: {pkg.manifest?.file_count ?? 0} files
              {pkg.has_pdf ? ` · PDF package: ${pkg.manifest?.pdf?.file_count ?? 0} files` : " · no PDF package (built before PDFs — rebuild)"}
              {pkg.link_expires_at ? ` · link expires ${pkg.link_expires_at.slice(0, 10)}` : ""} ·{" "}
              {pkg.downloads} download{pkg.downloads === "1" ? "" : "s"} logged
            </div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn pri"
              disabled={busy || initial.included.length === 0}
              title={initial.included.length === 0 ? "Nothing is approved yet" : undefined}
              onClick={() =>
                void run(async () => {
                  const result = await buildArchive(eventId);
                  return `Built · PowerPoint ${result.file_count} files · PDF ${result.pdf_file_count} files${
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
              onClick={() =>
                void run(async () => {
                  const result = await deliverArchive(pkg!.id);
                  return `Delivered to the client portal · link expires ${result.link_expires_at.slice(0, 10)}`;
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

          <div className="note" style={{ marginTop: 10 }}>
            Every file is checksum-verified as it is packaged; if stored bytes no longer match their
            recorded checksum the build stops and nothing is shipped.
          </div>
        </div>
      </div>

      <DownloadLog downloads={initial.downloads} />

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </>
  );
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
                  return `${queued} file${queued === 1 ? "" : "s"} queued for PDF conversion`;
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
                  return `${queued} failed file${queued === 1 ? "" : "s"} queued again`;
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
          LibreOffice is not installed on the server, so nothing can be converted yet.
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
