import Link from "next/link";
import { agoWords, ROOM_PC_SILENT_AFTER_SECONDS } from "@pmp/format";
import { getFleet, getSummary } from "@/lib/api";
import type { FleetRoom } from "@/lib/api";
import { Chip } from "@/components/Chip";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DeviceKeyButton } from "@/components/DeviceKeyButton";
import { guard } from "@/lib/guard";
import { ROOM_LABEL as LABEL } from "@/lib/roomWords";

export const dynamic = "force-dynamic";

/**
 * Room sync, grouped by what each room needs (D-122). One list used to say the same thing
 * two or three times per room — including "issue a connection code on Room sync" on Room
 * sync — and told a room PC that had simply gone quiet to get a new code.
 */
type Group = { key: string; title: string; help: string; rooms: FleetRoom[] };
const SHORT: Record<string, string> = { "getting-ready": "getting ready", quiet: "not reporting", "not-set-up": "not set up" };

const files = (room: FleetRoom) =>
  room.files_total === 0
    ? "no presentations for this room yet"
    : `${room.files_current} of ${room.files_total} ${room.files_total === 1 ? "file" : "files"} on the room PC`;

export default async function RoomSyncPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ items }, summary] = await guard(Promise.all([getFleet(id), getSummary(id)]), `/events/${id}/sync`);
  const timezone = summary.event.timezone;

  const neverReported = (room: FleetRoom) => room.heartbeat_age === null;
  const quiet = (room: FleetRoom) => room.heartbeat_age !== null && room.heartbeat_age > ROOM_PC_SILENT_AFTER_SECONDS;
  const groups: Group[] = [
    {
      key: "ready",
      title: "Ready",
      help: "Every talk for these rooms is on the room PC and ready to play.",
      rooms: items.filter((room) => !neverReported(room) && !quiet(room) && room.readiness === "ready"),
    },
    {
      key: "getting-ready",
      title: "Connected — still getting ready",
      help: "The room PC is online; some talks aren't approved, copied or switched in yet. Open the room view to see which.",
      rooms: items.filter((room) => !neverReported(room) && !quiet(room) && room.readiness !== "ready"),
    },
    {
      key: "quiet",
      title: "Room PC not reporting",
      help: "These room PCs were connected but have gone quiet. Check each one is switched on and online — it keeps playing the files it already has. Only use New code if the PC was replaced.",
      rooms: items.filter(quiet),
    },
    {
      key: "not-set-up",
      title: "Not set up yet",
      help: "Connect each room's PC once: press Connect, then type the code on that PC. The code is shown only once.",
      rooms: items.filter(neverReported),
    },
  ];
  const ready = groups[0]!.rooms.length;

  return (
    <>
      <AutoRefresh seconds={5} />
      <h1 className="htitle">Room synchronization</h1>
      <div className="note" style={{ margin: "-8px 0 14px" }}>
        <b className="num">
          {ready} of {items.length}
        </b>{" "}
        rooms ready
        {groups.slice(1).map((group) => (group.rooms.length ? ` · ${group.rooms.length} ${SHORT[group.key]}` : ""))}
        {" · "}each room&rsquo;s PC fetches its approved files and reports back here
      </div>

      {groups
        .filter((group) => group.rooms.length > 0)
        .map((group) => (
          <div className="card" key={group.key}>
            <div className="chd">
              <h3>
                {group.title} · {group.rooms.length}
              </h3>
            </div>
            <div className="cbd" style={{ padding: "0 0 4px" }}>
              <p className="note" style={{ margin: "4px 18px 8px" }}>
                {group.help}
              </p>
              <table>
                <tbody>
                  {group.rooms.map((room) => (
                    <tr key={room.room_id}>
                      <td>
                        <b>{room.room}</b>
                        <div className="note">
                          {group.key === "quiet" && room.heartbeat_age !== null
                            ? `Last heard from ${agoWords(room.heartbeat_age)} ago${
                                room.files_total ? `, when it had ${room.files_current} of ${room.files_total} ${room.files_total === 1 ? "file" : "files"}` : ""
                              }`
                            : group.key === "not-set-up"
                              ? room.key_issued_at
                                ? `Code issued — enter it on the room PC · ${files(room).replace(" on the room PC", " to send")}`
                                : `Not connected · ${files(room).replace(" on the room PC", " to send")}`
                              : files(room)}
                        </div>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {group.key === "not-set-up" ? (
                          <Chip status="canceled" label="Not set up" />
                        ) : (
                          <Chip status={room.readiness} label={LABEL[room.readiness]} />
                        )}{" "}
                        <Link className="btn" style={{ padding: "4px 10px" }} href={`/events/${id}/agent/${room.room_id}`}>
                          Room view
                        </Link>{" "}
                        <DeviceKeyButton
                          roomId={room.room_id}
                          room={room.room}
                          issuedAt={room.key_issued_at}
                          timezone={timezone}
                          {...(group.key === "not-set-up" ? {} : { label: "New code" })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
    </>
  );
}
