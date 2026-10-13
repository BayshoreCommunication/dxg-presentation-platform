import Link from "next/link";
import type { ApprovedPresentation } from "@/lib/api";
import { fileDownloadUrl } from "@/lib/api";
import { Icon } from "@/components/Icon";

/**
 * The event's approved presentations on Manage presentations (D-163): what the room will show,
 * in running order, with the file to download. DXG Technician staff work from here now that
 * Room sync is not theirs.
 */
export function ApprovedPresentations({
  eventId,
  items,
  timezone,
}: {
  eventId: string;
  items: ApprovedPresentation[];
  timezone: string;
}) {
  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone });
  return (
    <div className="card">
      <div className="chd">
        <h3>Approved · {items.length}</h3>
        <span className="m">in running order · the version the room will show</span>
      </div>
      <div className="cbd" style={{ padding: "0 0 4px" }}>
        {items.length === 0 ? (
          <div className="empty">Nothing approved yet.</div>
        ) : (
          <table>
            <tbody>
              {items.map((item) => (
                <tr key={item.slot_id}>
                  <td>
                    <span className="mono">{when(item.starts_at)}</span> ·{" "}
                    <Link href={`/events/${eventId}/talks/${item.slot_id}`}>{item.title}</Link>
                    {item.speaker ? ` · ${item.speaker}` : ""}
                    <div className="note" style={{ marginTop: 2 }}>
                      {item.room ?? "No room"} · v{item.version_number} · {item.original_filename}
                    </div>
                  </td>
                  <td style={{ width: 1, whiteSpace: "nowrap", textAlign: "right" }}>
                    <a className="btn" href={fileDownloadUrl(item.file_version_id)}>
                      <Icon name="download" />
                      Download v{item.version_number}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
