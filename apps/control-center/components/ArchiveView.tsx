"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ArchiveScope } from "@/lib/api";
import { buildArchive, deliverArchive, archiveDownloadUrl, ApiError } from "@/lib/api";
import { Chip } from "@/components/Chip";

const gb = (bytes: number) =>
  bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${Math.round(bytes / 1_000_000)} MB`;

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
          <span className="m">approved finals only</span>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          <table>
            <tbody>
              <tr>
                <td>Rule</td>
                <td>Approved final version of each talk</td>
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
                  <b className="num">{initial.included.length}</b> files ·{" "}
                  <span className="mono">{gb(initial.total_bytes)}</span>
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
          <label style={{ display: "block", marginBottom: 6, opacity: 0.55 }}>
            <input type="checkbox" disabled /> Convert to PDF where the speaker&rsquo;s release
            permission allows — conversion lands in M6-2, so PDF-only talks are excluded for now
          </label>
          <label style={{ display: "block", marginBottom: 12 }}>
            <input type="checkbox" checked readOnly /> Expiring client link · 7 days · every download
            logged
          </label>

          {pkg && (
            <div className="note" style={{ marginBottom: 10 }}>
              {pkg.manifest?.file_count ?? 0} files
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
                  return `Built · ${result.file_count} files · ${gb(result.size_bytes)} · ${result.excluded} excluded`;
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
                  const result = await deliverArchive(pkg!.id, 7);
                  return `Delivered to the client portal · link expires ${result.link_expires_at.slice(0, 10)}`;
                })
              }
            >
              Deliver to client portal
            </button>
            {pkg?.archive_state === "delivered" && (
              <a className="btn" href={archiveDownloadUrl(pkg.id)}>
                Download package
              </a>
            )}
          </div>

          <div className="note" style={{ marginTop: 10 }}>
            Every file is checksum-verified as it is packaged; if stored bytes no longer match their
            recorded checksum the build stops and nothing is shipped.
          </div>
        </div>
      </div>

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </>
  );
}
