"use client";

import type { ClientView } from "@/lib/api";
import { archiveDownloadUrl } from "@/lib/api";

const pct = (part: number, total: number) => (total === 0 ? 0 : Math.round((part / total) * 100));

/**
 * Screen 17 — the client's own surface. Read-only, no staff chrome, restricted
 * talks excluded from every count as well as from the package.
 */
export function ClientPortalView({ data }: { data: ClientView }) {
  const total = Number(data.totals.total);
  const collected = Number(data.totals.collected);
  const approved = Number(data.totals.approved);
  const pkg = data.package;
  const delivered = pkg?.archive_state === "delivered";

  return (
    <>
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
            {collected} of {total} talks
          </div>
        </div>
        <div className="kpi">
          <div className="kl">Approved</div>
          <div className="kv num" style={{ color: "var(--ok)" }}>
            {approved}
          </div>
        </div>
        <div className="kpi">
          <div className="kl">Outstanding</div>
          <div className="kv num" style={{ color: "var(--warn)" }}>
            {total - approved}
          </div>
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
                <span className="mono num" style={{ width: 40, textAlign: "right" }}>
                  {percent}%
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
              {data.event.name.replace(/\s+/g, "_")}_final_presentations.zip
              {pkg?.manifest?.file_count ? ` · ${pkg.manifest.file_count} files` : ""}
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
          {delivered ? (
            <a className="btn pri" style={{ marginTop: 10, display: "inline-block" }} href={archiveDownloadUrl(pkg.id)}>
              Download package
            </a>
          ) : (
            <button className="btn pri" style={{ marginTop: 10 }} disabled>
              Download package
            </button>
          )}
        </div>
      </div>
    </>
  );
}
