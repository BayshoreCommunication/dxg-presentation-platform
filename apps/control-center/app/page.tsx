import Link from "next/link";
import { redirect } from "next/navigation";
import { listEvents, getSummary, getSession } from "@/lib/api";
import { Chip } from "@/components/Chip";
import { guard } from "@/lib/guard";
import { eventStatusChip } from "@/lib/eventStatus";
import { ArchiveEventButton } from "@/components/ArchiveEventButton";

/** Who may archive an event. A hint for the UI; `services/events.ts` decides. */
const CONFIGURERS = ["presentation_manager", "project_manager", "platform_admin"];

export const dynamic = "force-dynamic";

const formatRange = (from: string, to: string) => {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const start = new Date(`${from}T12:00:00Z`).toLocaleDateString("en-US", opts);
  const end = new Date(`${to}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, year: "numeric" });
  return `${start}–${end}`;
};

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const showArchived = (await searchParams).archived === "1";
  // A client account is refused on every staff route, so the portfolio is not its
  // front door. Send it where it belongs before it is bounced off this one.
  const { principal } = await getSession().catch(() => ({ principal: null }));
  if (principal && principal.client_events.length > 0) {
    redirect(principal.client_events.length === 1 ? `/client/${principal.client_events[0]!.id}` : "/client");
  }

  const { items: all } = await guard(listEvents(), "/");
  /*
   * Archived events leave the portfolio (D-061) but are one click away: the list is
   * either the working events or the archived ones, never both mixed together.
   */
  const archivedCount = all.filter((event) => event.status === "archived").length;
  const items = all.filter((event) => (event.status === "archived") === showArchived);
  const canArchive = principal?.kind === "staff" && principal.roles.some((role) => CONFIGURERS.includes(role));
  const summaries = await guard(Promise.all(items.map((event) => getSummary(event.id))), "/");

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h1 className="htitle" style={{ margin: 0 }}>
          {showArchived ? "Archived events" : "Event portfolio"}
        </h1>
        <span style={{ display: "flex", gap: 8 }}>
          {showArchived ? (
            <Link href="/" className="btn">
              ← Back to portfolio
            </Link>
          ) : (
            archivedCount > 0 && (
              <Link href="/?archived=1" className="btn">
                Archived ({archivedCount})
              </Link>
            )
          )}
          <Link href="/events/new" className="btn pri">
            + Create event
          </Link>
        </span>
      </div>

      {items.length === 0 && (
        <div className="card">
          <div className="empty">{showArchived ? "No archived events." : "No events yet."}</div>
        </div>
      )}

      {items.map((event, index) => {
        const summary = summaries[index]!;
        const collected = summary.total === 0 ? 0 : Math.round((summary.collected / summary.total) * 100);
        const chip = eventStatusChip(event.status);
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
                <span style={{ display: "inline-flex", alignItems: "flex-start", gap: 8 }}>
                  <span className="mono num" style={{ alignSelf: "center" }}>{collected}%</span>
                  {canArchive && (
                    <ArchiveEventButton
                      eventId={event.id}
                      eventName={event.name}
                      archived={event.status === "archived"}
                    />
                  )}
                  {/*
                    An event opens on one screen showing both what it is and how it is
                    going (D-058); they used to be a click apart. A draft has no rooms,
                    no sessions and no talks, so it goes back to the wizard that was
                    making it — its details are those four steps, still being filled in.
                  */}
                  <Link
                    href={
                      event.status === "draft"
                        ? `/events/new?event=${event.id}`
                        : `/events/${event.id}`
                    }
                    className="btn"
                  >
                    {event.status === "draft" ? "Continue setup →" : "Open →"}
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
