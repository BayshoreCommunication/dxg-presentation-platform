import { getFleet, getSummary } from "@/lib/api";
import { Chip } from "@/components/Chip";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DeviceKeyButton } from "@/components/DeviceKeyButton";
import { guard } from "@/lib/guard";
import { ROOM_LABEL as LABEL, roomFilesLine, roomPcState } from "@/lib/roomWords";

export const dynamic = "force-dynamic";

export default async function RoomSyncPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ items }, summary] = await guard(Promise.all([getFleet(id), getSummary(id)]), `/events/${id}/sync`);
  const ready = items.filter((room) => room.readiness === "ready").length;

  return (
    <>
      <AutoRefresh seconds={5} />
      {/* Was "· Day 2" on every event, whatever its dates. */}
      <h1 className="htitle">Room synchronization</h1>
      <div className="note" style={{ margin: "-8px 0 14px" }}>
        <b className="num">
          {ready} / {items.length}
        </b>{" "}
        rooms ready · each room&rsquo;s presentation computer (room PC) downloads its approved files and
        reports back here
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
                      {roomFilesLine(room)} · {roomPcState(room)}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Chip status={room.readiness} label={LABEL[room.readiness]} />{" "}
                    <DeviceKeyButton
                      roomId={room.room_id}
                      room={room.room}
                      issuedAt={room.key_issued_at}
                      timezone={summary.event.timezone}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="note" style={{ marginTop: 6 }}>
        Each room PC keeps its own copy of every file it needs, so losing the internet stops new updates
        from arriving — it never stops what&rsquo;s already there from playing.
      </div>
    </>
  );
}
