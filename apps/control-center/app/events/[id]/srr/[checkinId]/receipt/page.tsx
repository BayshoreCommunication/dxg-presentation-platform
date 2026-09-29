import Link from "next/link";
import { getCheckin, getSummary } from "@/lib/api";
import { timeZoneLabel } from "@pmp/format";
import { guard } from "@/lib/guard";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

/** Day and time on the event's clock. */
const when = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });

/**
 * The presentation receipt, laid out for paper (FR-SRR-004, D-106). "Print receipt" on
 * check-in opens this in a new tab and it asks the browser to print; the station's own
 * printer does the rest. The app's sidebar and top bar are hidden when printing.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string; checkinId: string }> }) {
  const { id, checkinId } = await params;
  const [detail, summary] = await guard(
    Promise.all([getCheckin(checkinId), getSummary(id)]),
    `/events/${id}/srr/${checkinId}/receipt`,
  );
  const tz = summary.event.timezone;
  const receipt = detail.receipt;

  return (
    <div className="receipt-page">
      <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <PrintButton auto={Boolean(receipt)} />
        <Link className="btn" href={`/events/${id}/srr/${checkinId}`}>
          Back to check-in
        </Link>
      </div>

      {!receipt ? (
        <div className="err">There is no receipt yet — confirm the final onsite version on the check-in first.</div>
      ) : (
        <article className="receipt">
          <header>
            <div className="brand">DXG·PM</div>
            <h1>Presentation receipt</h1>
            <div className="note">{summary.event.name}</div>
          </header>
          <table>
            <tbody>
              <tr><th>Speaker</th><td>{detail.speaker.name}</td></tr>
              <tr><th>Talk</th><td>{detail.talk.title}</td></tr>
              <tr><th>Room</th><td>{detail.talk.room ?? "—"} · {when(detail.talk.starts_at, tz)}</td></tr>
              {/* The file and its slides, as on the check-in page (R34, D-112). */}
              <tr>
                <th>Version</th>
                <td>
                  v{receipt.version_number}
                  {receipt.file_name ? ` · ${receipt.file_name}` : ""}
                  {typeof receipt.slides === "number" ? ` · ${receipt.slides} slide${receipt.slides === 1 ? "" : "s"}` : ""}
                </td>
              </tr>
              <tr><th>Signed off</th><td>{when(receipt.signed_at, tz)}{receipt.station ? ` · ${receipt.station}` : ""}</td></tr>
              <tr><th>Technician</th><td>{receipt.technician}</td></tr>
            </tbody>
          </table>
          <p className="note">
            This version is locked for the room. Any change must come back through the Speaker Ready Room; it can no
            longer be replaced through the speaker portal. Times are venue local time ({timeZoneLabel(tz)}).
          </p>
          <div className="signatures">
            <div><span>Speaker</span></div>
            <div><span>Technician</span></div>
          </div>
        </article>
      )}
    </div>
  );
}
