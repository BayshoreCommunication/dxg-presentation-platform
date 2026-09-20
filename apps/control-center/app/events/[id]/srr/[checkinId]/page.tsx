import { getCheckin } from "@/lib/api";
import { CheckinView } from "@/components/CheckinView";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function CheckinPage({
  params,
}: {
  params: Promise<{ id: string; checkinId: string }>;
}) {
  const { id, checkinId } = await params;
  const detail = await guard(getCheckin(checkinId), `/events/${id}/srr/${checkinId}`);
  return <CheckinView eventId={id} initial={detail} />;
}
