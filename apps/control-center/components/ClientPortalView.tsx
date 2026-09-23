"use client";

import type { ClientView } from "@/lib/api";
import { archiveDownloadUrl } from "@/lib/api";
import { DownloadLog } from "@/components/DownloadLog";

const pct = (part: number, total: number) => (total === 0 ? 0 : Math.round((part / total) * 100));

/**
 * Screen 17 — the client's own surface. Read-only, no staff chrome, restricted
 * talks excluded from every count as well as from the package.
 *
 * Staff may open this to check what their client is being shown. When they do it is
 * banded as a preview, because the numbers here are deliberately narrower than the
 * control centre's — a staff member reading "18 collected" without knowing that
 * restricted talks were filtered out would draw a false conclusion about their own
 * event, and might repeat it to the client.
 */
export function ClientPortalView({ data }: { data: ClientView }) {
  const isPreview = data.viewed_as === "staff_preview";
  const total = Number(data.totals.total);
  const collected = Number(data.totals.collected);
  const approved = Number(data.totals.approved);
  const pkg = data.package;
  const delivered = pkg?.archive_state === "delivered";

  return (
    <>
      {isPreview && (
        <div
          className="card"
          style={{
            marginBottom: 12,
            borderLeft: "3px solid var(--warn)",
          }}
        >
          <div className="cbd" style={{ paddingTop: 10, paddingBottom: 10 }}>
            <strong>Preview — this is what {data.event.client_name} sees.</strong>{" "}
            <span className="note">
              Restricted talks are excluded from every figure here, so these counts are lower than
              the command centre&rsquo;s. Nothing on this page can be changed.
            </span>
          </div>
        </div>
      )}
      <div
        className="darkpane"
        style={{
          padding: "14px 20px",
          marginBottom: 16,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <b style={{ color: "var(--white)" }}>
          {data.event.client_name} · <span style={{ color: "var(--blue)" }}>Client Oversight</span>
        </b>
        <span style={{ fontSize: 12.5 }}>{data.event.name}</span>
      </div>

      <div className="krow">
        <div className="kpi">
          <div className="kl">Collection</div>
          <div className="kv num">{pct(collected, total)}%</div>
          <div className="note">
            {collected} of {total} presentations
          </div>
        </div>
        {/*
          Three states that add up to the total, so none is counted twice: approved,
          uploaded but not yet approved, and nothing uploaded. "Outstanding" used to be
          total − approved, which lumped the second and third together — a client
          reading it as "missing" would have chased speakers who had already delivered.
        */}
        <div className="kpi">
          <div className="kl">Approved</div>
          <div className="kv num" style={{ color: "var(--ok)" }}>
            {approved}
          </div>
        </div>
        <div className="kpi">
          <div className="kl">Need review</div>
          <div className="kv num" style={{ color: "var(--warn)" }}>
            {collected - approved}
          </div>
          <div className="note">uploaded, not yet approved</div>
        </div>
        <div className="kpi">
          <div className="kl">Missing</div>
          <div className="kv num" style={{ color: "var(--block)" }}>
            {total - collected}
          </div>
          <div className="note">nothing uploaded yet</div>
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>Collection by track</h3>
        </div>
        <div className="cbd">
          {data.tracks.length === 0 && <div className="note">No tracks assigned yet.</div>}
          {data.tracks.map((track) => {
            const percent = pct(Number(track.collected), Number(track.total));
            return (
              <div key={track.track} style={{ display: "flex", alignItems: "center", gap: 12, margin: "8px 0" }}>
                <span style={{ width: 170 }}>{track.track}</span>
                <div className={`bar ${percent < 80 ? "warn" : ""}`} style={{ flex: 1 }}>
                  <i style={{ width: `${percent}%` }} />
                </div>
                <span className="mono num" style={{ width: 120, textAlign: "right" }}>
                  {track.collected}/{track.total}
                  <span className="note"> · {percent}%</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>Archive package</h3>
          <span className="m">after event close</span>
        </div>
        <div className="cbd">
          <div className="frow" style={{ borderTop: "none" }}>
            <span className="mono">
              {data.event.name.replace(/\s+/g, "_")}_final_presentations
              {pkg?.manifest?.file_count ? ` · ${pkg.manifest.file_count} PowerPoint files` : ""}
              {pkg?.has_pdf && pkg.manifest?.pdf ? ` · ${pkg.manifest.pdf.file_count} PDFs` : ""}
            </span>
            <span className={`chip ${delivered ? "c-ok" : "c-mut"}`}>
              {delivered ? "Delivered" : pkg ? pkg.archive_state : "Available after the event"}
            </span>
          </div>
          <div className="note">
            DXG publishes the approved-finals package here within 4 hours of event close. Restricted
            talks are excluded. The link expires 7 days after delivery and every download is logged.
            {pkg?.link_expires_at && delivered ? ` This link expires ${pkg.link_expires_at.slice(0, 10)}.` : ""}
          </div>
          {/* Two packages (D-067): the original decks, and PDFs — which also carry the talks
              whose speakers allowed a PDF only. */}
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {delivered ? (
              <>
                <a className="btn pri" href={archiveDownloadUrl(pkg.id, "pptx")}>
                  Download PowerPoint package
                </a>
                {pkg.has_pdf && (
                  <a className="btn pri" href={archiveDownloadUrl(pkg.id, "pdf")}>
                    Download PDF package
                  </a>
                )}
              </>
            ) : (
              <>
                <button className="btn pri" disabled>
                  Download PowerPoint package
                </button>
                <button className="btn pri" disabled>
                  Download PDF package
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <DownloadLog downloads={data.downloads} />
    </>
  );
}
