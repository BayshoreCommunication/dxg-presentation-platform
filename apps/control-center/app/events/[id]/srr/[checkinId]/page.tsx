import { getCheckin } from "@/lib/api";
import { CheckinView } from "@/components/CheckinView";

export const dynamic = "force-dynamic";

export default async function CheckinPage({
  params,
}: {
  params: Promise<{ id: string; checkinId: string }>;
}) {
  const { id, checkinId } = await params;
  const detail = await getCheckin(checkinId);
  return <CheckinView eventId={id} initial={detail} />;
}
