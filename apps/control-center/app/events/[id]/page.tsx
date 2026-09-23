import Link from "next/link";
import { redirect } from "next/navigation";
import { getSummary, getRiskList, getFleet, getDraft, getSession, getAgenda, getSpeakers } from "@/lib/api";
import { Chip } from "@/components/Chip";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EventTabs } from "@/components/EventTabs";
import { InfoTip } from "@/components/InfoTip";
import { StatusGuide } from "@/components/StatusGuide";
import { ArchiveEventButton } from "@/components/ArchiveEventButton";
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
  const [summary, risk, fleet, setup, session, agenda, speakers] = await guard(
    Promise.all([
      getSummary(id),
      getRiskList(id),
      getFleet(id),
      getDraft(id),
      getSession(),
      getAgenda(id),
      getSpeakers(id),
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
  const canConfigure = session.principal.roles.some((role) => CONFIGURERS.includes(role));
  const header = [summary.event.venue, days ?? dateRange].filter(Boolean) as string[];

  /*
   * Each number carries its own explanation (D-065). They are computed, never typed,
   * and several mean something narrower than their label suggests — "Rooms ready" is
   * a heartbeat *and* every talk on the room's computer — so the rule is stated where
   * the number is read rather than left for someone to ask.
   */
  const kpis: { label: string; value: string | number; color?: string; note?: string; help: string }[] = [
    {
      label: "Collected",
      value: `${summary.collected} / ${summary.total}`,
      note: `${summary.total === 0 ? 0 : Math.round((summary.collected / summary.total) * 100)}% of talks`,
      help: "Presentations with at least one file uploaded, out of every presentation on the agenda.",
    },
    {
      label: "Approved",
      value: summary.approved,
      color: "var(--ok)",
      help: "Presentations whose latest file a reviewer has approved. Uploaded files wait in the review queue until then.",
    },
    {
      label: "Warnings open",
      value: summary.warnings_open,
      color: "var(--warn)",
      help: "Problems the automatic inspection found in uploaded files — a missing font, an oversized video — that nobody has fixed or waived yet. Resolve them from the review queue.",
    },
    {
      label: "Missing",
      value: summary.missing,
      color: summary.missing > 0 ? "var(--block)" : undefined,
      help: "Presentations with nothing uploaded yet. These are the speakers to chase from Communications.",
    },
    {
      label: "Rooms ready",
      value: `${summary.rooms_ready} / ${summary.rooms_total}`,
      color: summary.rooms_ready === summary.rooms_total ? "var(--ok)" : "var(--warn)",
      help: "A room is ready when its presentation computer has checked in within the last 5 minutes and every talk scheduled there is on that computer and ready to play (or cancelled). Rooms with no talks still count in the total.",
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
            {!archived && (
              <span className="live">
                <i /> live
              </span>
            )}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          {canConfigure && (
            <ArchiveEventButton
              eventId={id}
              eventName={summary.event.name}
              archived={archived}
              redirectTo="/"
            />
          )}
          {/*
            The only way into the standalone import screen now that it has left the
            sidebar. Agendas are revised constantly before an event, and re-import
            matches on (room, start, title) and updates rather than duplicating — a
            capability with no entry point is a capability nobody has.
          */}
          {!archived && (
            <Link href={`/events/${id}/import`} className="btn">
              Re-import agenda
            </Link>
          )}
          <Link href={`/events/${id}/review`} className="btn pri">
            Open review queue →
          </Link>
        </div>
      </div>

      {archived && (
        <div className="err" style={{ borderLeftColor: "var(--line)", background: "var(--mist)" }}>
          This event is archived and read-only — it is hidden from the portfolio and nothing in it can be
          changed. Everything is kept;
          {canConfigure ? " Restore puts it back where it was." : " a presentation manager can restore it."}
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
          <div className="kpi" key={kpi.label}>
            <div className="kl">
              {kpi.label}
              <InfoTip label={kpi.label} align={index === kpis.length - 1 ? "right" : "left"}>
                {kpi.help}
              </InfoTip>
            </div>
            <div className="kv num" style={kpi.color ? { color: kpi.color } : undefined}>
              {kpi.value}
            </div>
            {kpi.note && <div className="note">{kpi.note}</div>}
          </div>
        ))}
      </div>

      <div className="card">
        <div className="chd">
          <h3>Today&rsquo;s risk list</h3>
          <span className="m">
            {risk.items.length} items · click to open · <StatusGuide align="right" />
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
          <span className="m">heartbeat + file state · never asserted manually</span>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          <table>
            <tbody>
              {fleet.items.map((room) => (
                <tr key={room.room_id}>
                  <td>
                    <b>{room.room}</b>
                    <br />
                    <span className="note">
                      {room.files_current}/{room.files_total} files current ·{" "}
                      {room.heartbeat_age === null
                        ? "no agent registered"
                        : `heartbeat ${room.heartbeat_age}s ago`}
                      {room.agent_version ? ` · agent ${room.agent_version}` : ""}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Chip
                      status={room.readiness}
                      label={
                        room.readiness === "ready"
                          ? "Ready"
                          : room.readiness === "agent_offline"
                            ? "Agent offline"
                            : "Attention"
                      }
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
