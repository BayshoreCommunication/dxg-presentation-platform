import type { DownloadRecord } from "@/lib/api";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * Every download of the archive package, newest first — who and when. Downloads were
 * always recorded (FR-ARCH-002); this is where the client and DXG can see them.
 * Shown on the client portal and in the archive builder.
 */
export function DownloadLog({ downloads }: { downloads: DownloadRecord[] }) {
  return (
    <div className="card">
      <div className="chd">
        <h3>Download log</h3>
        <span className="m">
          {downloads.length} download{downloads.length === 1 ? "" : "s"} · every download is recorded
        </span>
      </div>
      {downloads.length === 0 ? (
        <div className="cbd">
          <div className="empty">No one has downloaded the package yet.</div>
        </div>
      ) : (
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          <table>
            <tbody>
              {downloads.map((record, index) => (
                <tr key={`${record.downloaded_at}-${index}`}>
                  <td>{record.downloaded_by ?? "Unknown user"}</td>
                  <td>
                    <span className="chip c-mut">{record.format === "pdf" ? "PDF package" : "PowerPoint package"}</span>
                  </td>
                  <td className="mono num note" style={{ textAlign: "right" }}>
                    {when(record.downloaded_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
