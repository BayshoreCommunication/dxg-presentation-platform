import Link from "next/link";
import { getFleet } from "@/lib/api";
import { guard } from "@/lib/guard";
import { roomLoadedLine } from "@/lib/roomWords";

export const dynamic = "force-dynamic";

export default async function PickRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { items } = await guard(getFleet(id), `/events/${id}/agent`);
  return (
    <>
      <h1 className="htitle">Room Agent</h1>
      <div className="note" style={{ margin: "-8px 0 14px" }}>
        The view a room technician sees at the lectern. Pick a room.
      </div>
      <div className="card">
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          <table>
            <tbody>
              {items.map((room) => (
                <tr className="rb" key={room.room_id}>
                  <td>
                    <b>{room.room}</b>
                    <br />
                    <span className="note">
                      {/* Was "3/4 files current · agent 1.4.2" (R43, D-110); since D-125 only the ticks. */}
                      {roomLoadedLine(room)}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Link className="btn" href={`/events/${id}/agent/${room.room_id}`}>
                      Open room view →
                    </Link>
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
