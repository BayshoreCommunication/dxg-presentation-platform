import Link from "next/link";
import { redirect } from "next/navigation";
import { listEvents, getSummary, getSession } from "@/lib/api";
import { Chip } from "@/components/Chip";
import { guard } from "@/lib/guard";
import { eventStatusChip } from "@/lib/eventStatus";
import { ArchiveEventButton } from "@/components/ArchiveEventButton";
import { StartPracticeButton } from "@/components/StartPracticeButton";
import { formatDateRange, plural } from "@pmp/format";
import type { EventRow, Summary } from "@/lib/api";

/** Who may archive an event. A hint for the UI; `services/events.ts` decides. */
const CONFIGURERS = ["presentation_manager", "project_manager", "platform_admin"];

export const dynamic = "force-dynamic";

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const showArchived = (await searchParams).archived === "1";
  // A client account is refused on every staff route, so the portfolio is not its
  // front door. Send it where it belongs before it is bounced off this one.
  const { principal } = await getSession().catch(() => ({ principal: null }));
  // A speaker account's front door is its presentations (D-146).
  if (principal?.account_kind === "speaker") redirect("/presentations");
  if (principal && principal.client_events.length > 0) {
    redirect(principal.client_events.length === 1 ? `/client/${principal.client_events[0]!.id}` : "/client");
  }

  const { items: all } = await guard(listEvents(), "/");
  /*
   * Practice events (D-116) are listed on their own and never mixed into, or counted
   * with, the real ones. An archived practice event is gone from the portfolio — that is
   * how one is put away. An administrator sees everyone's.
   */
  const real = all.filter((event) => !event.is_practice);
  const practice = showArchived ? [] : all.filter((event) => event.is_practice && event.status !== "archived");
  const myPractice = practice.filter((event) => event.practice_owner === principal?.user_id).length;
  /*
   * Archived events leave the portfolio (D-061) but are one click away: the list is
   * either the working events or the archived ones, never both mixed together.
   */
  const archivedCount = real.filter((event) => event.status === "archived").length;
  const items = real.filter((event) => (event.status === "archived") === showArchived);
  // Per event: a manager of their own practice event is not one anywhere else.
  const canArchive = (eventId: string) =>
    principal?.kind === "staff" &&
    (principal.is_root_admin ||
      (principal.event_roles ?? []).some((held) => held.event_id === eventId && CONFIGURERS.includes(held.role)));
  const summaries = await guard(Promise.all([...items, ...practice].map((event) => getSummary(event.id))), "/");
  const card = (event: EventRow, summary: Summary) => (
    <EventCard
      key={event.id}
      event={event}
      summary={summary}
      canArchive={canArchive(event.id)}
      owner={event.is_practice && event.practice_owner !== principal?.user_id ? event.practice_owner_name ?? null : null}
    />
  );

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

      {items.map((event, index) => card(event, summaries[index]!))}

      {!showArchived && (
        <>
          <div
            style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, margin: "24px 0 10px" }}
          >
            <div>
              <h2 className="htitle" style={{ margin: 0, fontSize: 18 }}>
                Practice events
              </h2>
              <p className="note" style={{ margin: "4px 0 0", maxWidth: 560 }}>
                A practice event is yours to learn on: made-up speakers and real files in every state. Nothing in it reaches
                real speakers or clients, and its emails are never sent. When you are done, press Archive — that removes it
                from here.
              </p>
            </div>
            {principal?.kind === "staff" && <StartPracticeButton open={myPractice} />}
          </div>
          {practice.length === 0 ? (
            <div className="card">
              <div className="empty">No practice events. Start one to try every job safely.</div>
            </div>
          ) : (
            practice.map((event, index) => card(event, summaries[items.length + index]!))
          )}
        </>
      )}
    </>
  );
}

/** One event on the portfolio: its status, how much has arrived, and the way in. */
function EventCard({
  event,
  summary,
  canArchive,
  owner,
}: {
  event: EventRow;
  summary: Summary;
  canArchive: boolean;
  /** Whose practice event this is, when it is someone else's (an administrator's view). */
  owner: string | null;
}) {
  const collected = summary.total === 0 ? 0 : Math.round((summary.collected / summary.total) * 100);
  const chip = eventStatusChip(event.status, event);
  return (
    <div className="card" style={event.status === "active" ? { boxShadow: "inset 0 0 0 .8px var(--ring)" } : undefined}>
      <div className="cbd">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <h3 style={{ fontSize: 17 }}>{event.name}</h3>
          <span style={{ display: "inline-flex", gap: 6 }}>
            {event.is_practice && (
              <span className="chip c-sync" title="Made-up speakers; no email is ever sent.">
                Practice
              </span>
            )}
            <Chip status={chip.status} label={chip.label} />
          </span>
        </div>
        <div className="note">
          {formatDateRange(event.starts_on, event.ends_on)}
          {owner ? ` · ${owner}'s practice event` : ""}
        </div>
        {/* S10 (D-113): the bar says what it counts. */}
        <div className="bar" style={{ margin: "10px 0 4px" }} aria-hidden="true">
          <i style={{ width: `${collected}%` }} />
        </div>
        <div className="note" style={{ marginBottom: 6 }}>
          {summary.total === 0
            ? "No presentations on the agenda yet"
            : `${summary.collected} of ${plural(summary.total, "presentation")} received (${collected}%)`}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {/* S11 (D-113): open warnings lead to where they are resolved. */}
          {summary.warnings_open > 0 && event.status !== "draft" ? (
            <Link href={`/events/${event.id}/review`} className="chip c-warn">
              {plural(summary.warnings_open, "file warning")} to review →
            </Link>
          ) : summary.warnings_open > 0 ? (
            <span className="chip c-warn">{plural(summary.warnings_open, "file warning")}</span>
          ) : (
            <span className="note">No file warnings</span>
          )}
          <span style={{ display: "inline-flex", alignItems: "flex-start", gap: 8 }}>
            {canArchive && (
              <ArchiveEventButton eventId={event.id} eventName={event.name} archived={event.status === "archived"} />
            )}
            {/*
              An event opens on one screen showing both what it is and how it is
              going (D-058); they used to be a click apart. A draft has no rooms,
              no sessions and no talks, so it goes back to the wizard that was
              making it — its details are those four steps, still being filled in.
            */}
            <Link href={event.status === "draft" ? `/events/new?event=${event.id}` : `/events/${event.id}`} className="btn">
              {event.status === "draft" ? "Continue setup →" : "Open →"}
            </Link>
          </span>
        </div>
      </div>
    </div>
  );
}
