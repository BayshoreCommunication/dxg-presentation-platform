import { getFleet } from "@/lib/api";
import { Chip } from "@/components/Chip";
import { AutoRefresh } from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

const LABEL = { ready: "Ready", attention: "Attention", agent_offline: "Agent offline" } as const;

export default async function RoomSyncPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { items } = await getFleet(id);
  const ready = items.filter((room) => room.readiness === "ready").length;

  return (
    <>
      <AutoRefresh seconds={5} />
      <h1 className="htitle">Room synchronization · Day 2</h1>
      <div className="note" style={{ margin: "-8px 0 14px" }}>
        <b className="num">
          {ready} / {items.length}
        </b>{" "}
        rooms ready
      </div>

      <div className="card">
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          <table>
            <tbody>
              {items.map((room) => (
                <tr key={room.room_id}>
                  <td>
                    <b>{room.room}</b>
                    <br />
                    <span className="note">
                      {room.files_current}/{room.files_total} files current ·{" "}
                      {room.heartbeat_age === null
                        ? "no agent registered"
                        : room.heartbeat_age > 300
                          ? `no heartbeat for ${Math.round(room.heartbeat_age / 60)} min`
                          : `sync ${room.heartbeat_age}s ago`}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Chip status={room.readiness} label={LABEL[room.readiness]} />{" "}
                    <button className="btn" style={{ padding: "4px 10px" }} disabled title="M5-5">
                      Manual sync
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="note" style={{ marginTop: 6 }}>
        Rooms keep complete offline libraries — internet loss pauses updates, never playback.
      </div>
    </>
  );
}
