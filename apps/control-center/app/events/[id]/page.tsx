import Link from "next/link";
import { getSummary, getRiskList, getFleet } from "@/lib/api";
import { Chip } from "@/components/Chip";
import { AutoRefresh } from "@/components/AutoRefresh";

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
  const [summary, risk, fleet] = await Promise.all([getSummary(id), getRiskList(id), getFleet(id)]);

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
            Tampa Convention Center · Day 2 of 3 · Doors 08:00 &nbsp;
            <span className="live">
              <i /> live
            </span>
          </span>
        </div>
        <Link href={`/events/${id}/review`} className="btn pri">
          Open review queue →
        </Link>
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
            <div className="empty">Nothing at risk — every talk is synchronized onsite.</div>
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
