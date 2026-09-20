import Link from "next/link";
import { getFleet } from "@/lib/api";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function PickRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { items } = await guard(getFleet(id), `/events/${id}/agent`);
  return (
    <>
      <h1 className="htitle">Room Agent</h1>
      <div className="note" style={{ margin: "-8px 0 14px" }}>
        The view a room technician sees on the room machine. Pick a room.
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
                      {room.files_current}/{room.files_total} files current
                      {room.agent_version ? ` · agent ${room.agent_version}` : " · no agent"}
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
