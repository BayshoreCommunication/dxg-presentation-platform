import Link from "next/link";
import type { MyEvent } from "@/lib/api";
import { formatDateRange, humanize, plural } from "@pmp/format";

const APPROVED = ["approved", "approved_delivering", "update_pending_ack", "synchronized_onsite"];

function eventWords(event: { status: string; starts_on: string; ends_on: string; timezone: string }): { tone: string; label: string } {
  if (event.status === "active") {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: event.timezone });
    if (today < event.starts_on) return { tone: "c-info", label: "Upcoming" };
    if (today > event.ends_on) return { tone: "", label: "Event over" };
    return { tone: "c-ok", label: "Onsite now" };
  }
  if (event.status === "archived") return { tone: "", label: "Archived" };
  return { tone: "", label: humanize(event.status) };
}

/**
 * The speaker's portfolio: every event they speak at, one card each, with how their own
 * presentations stand on it — received, approved, still to upload — and the way in.
 */
export function Portfolio({ events }: { events: MyEvent[] }) {
  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h1 className="htitle" style={{ margin: 0 }}>
          Your events
        </h1>
      </div>
      {events.length === 0 && (
        <div className="card">
          <div className="empty">No events yet. The organisers add you to an event&rsquo;s agenda with the email you sign in with.</div>
        </div>
      )}
      {events.map((event) => {
        const words = eventWords(event);
        const total = event.talks.length;
        const received = event.talks.filter((talk) => talk.versions.length > 0).length;
        const approved = event.talks.filter((talk) => APPROVED.includes(talk.status)).length;
        const percent = total === 0 ? 0 : Math.round((received / total) * 100);
        return (
          <div key={event.id} className="card">
            <div className="cbd">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <h3 style={{ fontSize: 17 }}>{event.name}</h3>
                <span className={`chip ${words.tone}`}>{words.label}</span>
              </div>
              <div className="note">{formatDateRange(event.starts_on, event.ends_on)}</div>
              <div className="bar" style={{ margin: "10px 0 4px" }} aria-hidden="true">
                <i style={{ width: `${percent}%` }} />
              </div>
              <div className="note" style={{ marginBottom: 6 }}>
                {total === 0
                  ? "No presentations assigned to you yet"
                  : `${received} of ${plural(total, "presentation")} uploaded · ${approved} approved`}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", gap: 8 }}>
                  <Link href={`/events/${event.id}/agenda`} className="btn">
                    Agenda
                  </Link>
                  <Link href={`/events/${event.id}/srr`} className="btn">
                    Speaker Ready Room
                  </Link>
                </span>
                <Link href="/" className="btn pri">
                  Manage presentations →
                </Link>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
