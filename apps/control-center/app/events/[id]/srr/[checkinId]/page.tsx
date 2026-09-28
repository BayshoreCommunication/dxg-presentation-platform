import { getCheckin, getFleet, getSummary } from "@/lib/api";
import { CheckinView } from "@/components/CheckinView";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function CheckinPage({
  params,
}: {
  params: Promise<{ id: string; checkinId: string }>;
}) {
  const { id, checkinId } = await params;
  const [detail, summary, fleet] = await guard(
    Promise.all([
      getCheckin(checkinId),
      getSummary(id),
      // Only for R7's room-PC freshness (D-110); without it the status shows as before.
      getFleet(id).catch(() => ({ items: [] })),
    ]),
    `/events/${id}/srr/${checkinId}`,
  );
  return <CheckinView eventId={id} timezone={summary.event.timezone} initial={detail} rooms={fleet.items} />;
}
