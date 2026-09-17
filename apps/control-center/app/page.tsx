import Link from "next/link";
import { listEvents, getSummary } from "@/lib/api";
import { Chip } from "@/components/Chip";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { status: string; label: string }> = {
  active: { status: "submitted", label: "Onsite now" },
  draft: { status: "canceled", label: "Planning" },
  closed: { status: "canceled", label: "Closed" },
  archived: { status: "archived", label: "Archived" },
};

const formatRange = (from: string, to: string) => {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const start = new Date(`${from}T12:00:00Z`).toLocaleDateString("en-US", opts);
  const end = new Date(`${to}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, year: "numeric" });
  return `${start}–${end}`;
};

export default async function PortfolioPage() {
  const { items } = await listEvents();
  const summaries = await Promise.all(items.map((event) => getSummary(event.id)));

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h1 className="htitle" style={{ margin: 0 }}>
          Event portfolio
        </h1>
        <button className="btn pri" disabled title="Create event — M1-4">
          + Create event
        </button>
      </div>

      {items.length === 0 && <div className="card"><div className="empty">No events yet.</div></div>}

      {items.map((event, index) => {
        const summary = summaries[index]!;
        const collected = summary.total === 0 ? 0 : Math.round((summary.collected / summary.total) * 100);
        const chip = STATUS_LABEL[event.status] ?? { status: "canceled", label: event.status };
        return (
          <div key={event.id} className="card" style={event.status === "active" ? { borderColor: "var(--blue)" } : undefined}>
            <div className="cbd">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <h3 style={{ fontSize: 17 }}>{event.name}</h3>
                <Chip status={chip.status} label={chip.label} />
              </div>
              <div className="note">{formatRange(event.starts_on, event.ends_on)}</div>
              <div className="bar" style={{ margin: "10px 0 4px" }}>
                <i style={{ width: `${collected}%` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className={summary.warnings_open > 0 ? "chip c-warn" : "note"}>
                  {summary.warnings_open > 0
                    ? `${summary.warnings_open} unresolved warnings`
                    : "No unresolved warnings"}
                </span>
                <span>
                  <span className="mono num">{collected}%</span>{" "}
                  <Link href={`/events/${event.id}`} className="btn">
                    Open →
                  </Link>
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
