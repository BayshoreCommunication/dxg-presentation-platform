import Link from "next/link";
import { redirect } from "next/navigation";
import { getSummary, getRiskList, getFleet, getDraft, getSession, getAgenda, getSpeakers, getReviewQueue } from "@/lib/api";
import { Chip } from "@/components/Chip";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EventTabs } from "@/components/EventTabs";
import { InfoTip } from "@/components/InfoTip";
import { Kpi } from "@/components/Kpi";
import type { KpiTone } from "@/components/Kpi";
import { ROOM_LABEL, roomLoadedLine } from "@/lib/roomWords";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

/** Times always render in the event's timezone — never the viewer's browser. */
const time = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });

/**
 * S25 (D-113): why a talk is on the risk list, in a few words, beside its session time —
 * a bare "Submitted" chip did not say what is left to do.
 */
const RISK_REASON: Record<string, string> = {
  missing: "Nothing uploaded yet",
  processing: "File checks running",
  submitted: "Waiting for review",
  needs_revision: "Waiting for the speaker's new version",
  approved: "Approved, but the session has no room",
  approved_delivering: "Not loaded on the room PC yet",
  update_pending_ack: "Newer version to load – the room PC has the older one",
  attention: "File held back – ask the speaker for a clean copy",
};

/** Who may change an event's setup. A hint for the UI; `services/events.ts` decides. */
const CONFIGURERS = ["presentation_manager", "project_manager", "platform_admin"];

export default async function CommandCenterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const [summary, risk, fleet, setup, session, agenda, speakers, review] = await guard(
    Promise.all([
      getSummary(id),
      getRiskList(id),
      getFleet(id),
      getDraft(id),
      getSession(),
      getAgenda(id),
      getSpeakers(id),
      getReviewQueue(id),
    ]),
    `/events/${id}`,
  );

  /*
   * A draft is not a running event, and this screen has no way to say so: it would
   * report a live indicator, zero of zero talks collected and "every talk is
   * synchronized onsite" for an event with no agenda at all. The portfolio link is not
   * the only way in — the sidebar's event switcher lists drafts too, as does a
   * bookmark — so the rule belongs here rather than only on the card that started it.
   */
  if (summary.event.status === "draft") redirect(`/events/new?event=${id}`);

  /*
   * This line was the literal string "Tampa Convention Center · Day 2 of 3 · Doors
   * 08:00" on every event, whatever its venue and however long it ran — invented
   * operational facts on the event's home screen, beside a live indicator. SCREEN_SPECS
   * §4 specifies `name · venue · Day N of M · doors`; three of those four are real data
   * and the fourth is not recorded anywhere, so it is not shown.
   *
   * "Day N of M" only appears while the event is running. Before it starts and after it
   * ends there is no current day, and picking one would be the same invention in a
   * smaller font.
   */
  const days = (() => {
    const from = new Date(`${summary.event.starts_on}T00:00:00Z`);
    const to = new Date(`${summary.event.ends_on}T00:00:00Z`);
    const total = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    // Today as the venue reckons it, not as the viewer's browser does.
    const todayThere = new Date().toLocaleDateString("en-CA", { timeZone: summary.event.timezone });
    const current =
      Math.round(new Date(`${todayThere}T00:00:00Z`).getTime() - from.getTime()) / 86_400_000 + 1;
    return current >= 1 && current <= total ? `Day ${current} of ${total}` : null;
  })();
  // S28 (D-113): no green "live" dot once the event's last day has passed at the venue.
  const over = new Date().toLocaleDateString("en-CA", { timeZone: summary.event.timezone }) > summary.event.ends_on;

  const dateRange = `${new Date(`${summary.event.starts_on}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })} – ${new Date(`${summary.event.ends_on}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })}`;

  const archived = summary.event.status === "archived";
  // The roles held on *this* event (D-116: a practice event's manager is not one elsewhere).
  const canConfigure =
    session.principal.is_root_admin ||
    (session.principal.event_roles ?? []).some((held) => held.event_id === id && CONFIGURERS.includes(held.role));
  const header = [summary.event.venue, days ?? dateRange].filter(Boolean) as string[];

  /*
   * Each number carries its own explanation (D-065). They are computed, never typed,
   * and several mean something narrower than their label suggests — "Rooms ready" is
   * every talk ticked loaded on the room's computer (D-125) — so the rule is stated where
   * the number is read rather than left for someone to ask.
   */
  const share = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);
  const kpis: {
    label: string;
    icon: string;
    value: string | number;
    caption?: string;
    tone?: KpiTone;
    progress?: number;
    help: string;
  }[] = [
    {
      label: "Collected",
      icon: "upload",
      value: `${summary.collected} / ${summary.total}`,
      caption: `${Math.round(share(summary.collected, summary.total) * 100)}% of talks`,
      progress: share(summary.collected, summary.total),
      tone: summary.total > 0 && summary.collected === summary.total ? "ok" : undefined,
      help: "Presentations with at least one file uploaded, out of every presentation on the agenda.",
    },
    {
      label: "Approved",
      icon: "checkCircle",
      value: summary.approved,
      caption: "latest file approved",
      tone: summary.approved > 0 ? "ok" : undefined,
      help: "Presentations whose latest file a reviewer has approved. Uploaded files wait in Manage presentations until then.",
    },
    {
      label: "Warnings", // S28 (D-113): "Warnings open" was cut off in the tile
      icon: "warning",
      value: summary.warnings_open,
      caption: summary.warnings_open > 0 ? "not fixed or waived" : "none open",
      tone: summary.warnings_open > 0 ? "warn" : undefined,
      help: "Problems the automatic inspection found in uploaded files — a missing font, an oversized video — that nobody has fixed or waived yet. Resolve them from Manage presentations.",
    },
    {
      label: "Missing",
      icon: "docMissing",
      value: summary.missing,
      caption: summary.missing > 0 ? "nothing uploaded yet" : "none missing",
      tone: summary.missing > 0 ? "bad" : undefined,
      help: "Presentations with nothing uploaded yet. These are the speakers to chase from Communications.",
    },
    {
      label: "Rooms ready",
      icon: "monitor",
      value: `${summary.rooms_ready} / ${summary.rooms_total}`,
      caption: summary.rooms_ready === summary.rooms_total ? "all rooms ready" : "not all ready",
      tone: summary.rooms_ready === summary.rooms_total ? "ok" : "warn",
      progress: share(summary.rooms_ready, summary.rooms_total),
      help: "A room is ready when every talk scheduled there has its approved version loaded on the room's PC and ticked on Room sync (or is cancelled). Nothing is checked automatically. Rooms with no talks still count in the total.",
    },
  ];

  return (
    <>
      <AutoRefresh seconds={5} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <h1 className="htitle" style={{ marginBottom: 2 }}>
            {summary.event.name}
          </h1>
          <span className="note">
            {header.join(" · ")}
            {header.length > 0 && <>&nbsp;</>}
            {!archived && !over && (
              <span className="live">
                <i /> live
              </span>
            )}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          {/* Archiving lives on the portfolio card; from here the way out is back to it. */}
          <Link href={archived ? "/?archived=1" : "/"} className="btn">
            ← Back to portfolio
          </Link>
          {/*
            Was "Open review queue" — a name for the mechanism, not the job. It says what
            the screen is for and how many are waiting, so an empty one is visible
            before anyone clicks.
          */}
          <Link href={`/events/${id}/review`} className="btn pri">
            {review.items.length > 0
              ? `Manage presentations (${review.items.length}) →`
              : "Manage presentations · none waiting"}
          </Link>
        </div>
      </div>

      {archived && (
        <div className="err" style={{ borderLeftColor: "var(--line)", background: "var(--mist)" }}>
          This event is archived and read-only — it is hidden from the portfolio and nothing in it can be
          changed. Everything is kept;
          {canConfigure
            ? " Restore it from the portfolio’s Archived list."
            : " a presentation manager can restore it from the portfolio."}
        </div>
      )}

      {/*
        What the event is, above how it is going (D-058). This was screen 18, a click
        away, so the timezone every time on this page is rendered in — and the deadline
        that closes the speaker portal — could only be read by leaving the event.
      */}
      <EventTabs
        eventId={id}
        timezone={summary.event.timezone}
        setup={setup}
        talks={{ total: summary.total, collected: summary.collected }}
        canEdit={canConfigure && !archived}
        agenda={agenda.items}
        speakers={speakers.items}
        initialTab={tab}
      />

      <div className="krow">
        {kpis.map((kpi, index) => (
          <Kpi
            key={kpi.label}
            label={kpi.label}
            icon={kpi.icon}
            value={kpi.value}
            caption={kpi.caption}
            tone={kpi.tone}
            progress={kpi.progress}
            help={
              <InfoTip label={kpi.label} align={index === kpis.length - 1 ? "right" : "left"}>
                {kpi.help}
              </InfoTip>
            }
          />
        ))}
      </div>

      <div className="card">
        <div className="chd">
          <h3>Today&rsquo;s risk list</h3>
          <span className="m">
            {risk.items.length} items · click to open
          </span>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          {risk.items.length === 0 ? (
            <div className="empty">
              {summary.total === 0
                ? "No talks yet — the agenda has none, or none of its sessions carry one."
                : "Nothing at risk — every talk is synchronized onsite."}
            </div>
          ) : (
            <table>
              <tbody>
                {risk.items.map((item) => (
                  <tr className="rb" key={item.slot_id}>
                    <td>
                      <Link href={`/events/${id}/talks/${item.slot_id}`} style={{ display: "block" }}>
                        {item.room} · {time(item.starts_at, summary.event.timezone)} · {item.speaker} —{" "}
                        {item.title}
                      </Link>
                      {RISK_REASON[item.status] && (
                        <div className="note">
                          {RISK_REASON[item.status]} – session at {time(item.starts_at, summary.event.timezone)}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Chip status={item.status} label={item.status_label} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>Room readiness</h3>
          {/* S3 (D-112): plain words for where these statuses come from — since D-125, the ticks on Room sync. */}
          <Link className="m" href={`/events/${id}/sync`}>
            From the ticks on Room sync →
          </Link>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          <table>
            <tbody>
              {fleet.items.map((room) => (
                <tr key={room.room_id}>
                  <td>
                    <b>{room.room}</b>
                    <br />
                    <span className="note">{roomLoadedLine(room)}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Chip
                      status={room.readiness}
                      label={ROOM_LABEL[room.readiness]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
