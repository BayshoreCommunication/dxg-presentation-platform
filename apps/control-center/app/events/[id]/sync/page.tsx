import Link from "next/link";
import { getFleet, getSummary } from "@/lib/api";
import { Chip } from "@/components/Chip";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DeviceKeyButton } from "@/components/DeviceKeyButton";
import { guard } from "@/lib/guard";
import { ROOM_LABEL as LABEL, roomFilesLine, roomNextStep, roomPcState } from "@/lib/roomWords";

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
                    {/* R42 (D-113): the next step for a room that isn't ready. */}
                    {roomNextStep(room) && <div className="note">{roomNextStep(room)}</div>}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Chip status={room.readiness} label={LABEL[room.readiness]} />{" "}
                    <Link className="btn" style={{ padding: "4px 10px" }} href={`/events/${id}/agent/${room.room_id}`}>
                      Room view
                    </Link>{" "}
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
        {/* R42 (D-113): said so it agrees with "Room PC not reporting" above, not against it. */}
        A room PC that is not reporting still plays the files it already has. It can&rsquo;t get new or
        updated files — or tell this page what it has — until it is back online.
      </div>
    </>
  );
}
