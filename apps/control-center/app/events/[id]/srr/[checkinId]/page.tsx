import { getCheckin, getSummary } from "@/lib/api";
import { CheckinView } from "@/components/CheckinView";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function CheckinPage({
  params,
}: {
  params: Promise<{ id: string; checkinId: string }>;
}) {
  const { id, checkinId } = await params;
  const [detail, summary] = await guard(
    Promise.all([getCheckin(checkinId), getSummary(id)]),
    `/events/${id}/srr/${checkinId}`,
  );
  return <CheckinView eventId={id} timezone={summary.event.timezone} initial={detail} />;
}
