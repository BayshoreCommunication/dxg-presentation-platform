import Link from "next/link";
import { redirect } from "next/navigation";
import { getSummary, getRiskList, getFleet } from "@/lib/api";
import { Chip } from "@/components/Chip";
import { AutoRefresh } from "@/components/AutoRefresh";
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

export default async function CommandCenterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [summary, risk, fleet] = await guard(
    Promise.all([getSummary(id), getRiskList(id), getFleet(id)]),
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

  const header = [summary.event.venue, days ?? dateRange].filter(Boolean) as string[];

  const kpis = [
    { label: "Collected", value: `${summary.collected} / ${summary.total}`, note: `${summary.total === 0 ? 0 : Math.round((summary.collected / summary.total) * 100)}% of talks` },
    { label: "Approved", value: summary.approved, color: "var(--ok)" },
    { label: "Warnings open", value: summary.warnings_open, color: "var(--warn)" },
    { label: "Missing", value: summary.missing, color: summary.missing > 0 ? "var(--block)" : undefined },
    { label: "Rooms ready", value: `${summary.rooms_ready} / ${summary.rooms_total}`, color: summary.rooms_ready === summary.rooms_total ? "var(--ok)" : "var(--warn)" },
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
            <span className="live">
              <i /> live
            </span>
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {/*
            The only way into the standalone import screen now that it has left the
            sidebar. Agendas are revised constantly before an event, and re-import
            matches on (room, start, title) and updates rather than duplicating — a
            capability with no entry point is a capability nobody has.
          */}
          {/*
            The way back to what this event is. Without it the details screen is
            reachable only from the portfolio, so anyone already inside an event would
            have to leave it to read the timezone their times are rendered in.
          */}
          <Link href={`/events/${id}/details`} className="btn">
            Event details
          </Link>
          <Link href={`/events/${id}/import`} className="btn">
            Re-import agenda
          </Link>
          <Link href={`/events/${id}/review`} className="btn pri">
            Open review queue →
          </Link>
        </div>
      </div>

      <div className="krow">
        {kpis.map((kpi) => (
          <div className="kpi" key={kpi.label}>
            <div className="kl">{kpi.label}</div>
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
          <span className="m">{risk.items.length} items · statuses derived live; click to open</span>
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
