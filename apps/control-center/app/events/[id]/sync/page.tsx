import { getFleet, getSession, getSummary } from "@/lib/api";
import { AutoRefresh } from "@/components/AutoRefresh";
import { LoadingChecklist } from "@/components/LoadingChecklist";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

/**
 * Who may tick a file loaded — a hint for the page; `packages/domain` roomSync decides
 * (room technician, Speaker Ready Room technician and above).
 */
const LOADERS = ["room_technician", "srr_technician", "presentation_manager", "project_manager", "platform_admin"];

/**
 * Room sync as a loading checklist (D-125, Travis's call). DXG staff copy each approved
 * file onto the room's presentation PC by hand and tick it here; the platform no longer
 * watches room PCs, so there are no connection states, codes or "last heard from" lines.
 * It replaced D-122's grouping by connection state.
 */
export default async function RoomSyncPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ items }, summary, session] = await guard(
    Promise.all([getFleet(id), getSummary(id), getSession()]),
    `/events/${id}/sync`,
  );
  const principal = session.principal;
  const canLoad =
    principal.is_root_admin ||
    principal.roles.includes("platform_admin") ||
    (principal.event_roles ?? []).some((held) => held.event_id === id && LOADERS.includes(held.role));

  const ready = items.filter((room) => room.readiness === "ready").length;
  const toLoad = items
    .flatMap((room) => room.talks)
    .filter((talk) => talk.session_state !== "canceled" && talk.approved && !talk.approved.loaded).length;

  return (
    <>
      <AutoRefresh seconds={10} />
      <h1 className="htitle">Room synchronization</h1>
      <div className="note" style={{ margin: "-8px 0 6px" }}>
        <b className="num">
          {ready} of {items.length}
        </b>{" "}
        {items.length === 1 ? "room" : "rooms"} ready ·{" "}
        <b className="num">{toLoad}</b> {toLoad === 1 ? "talk" : "talks"} to load
      </div>
      <p className="note" style={{ margin: "0 0 14px" }}>
        Copy each approved file onto the room&rsquo;s PC, then tick it here. Nothing on this page is checked
        automatically.
      </p>
      <LoadingChecklist eventId={id} timezone={summary.event.timezone} rooms={items} canLoad={canLoad} />
    </>
  );
}
