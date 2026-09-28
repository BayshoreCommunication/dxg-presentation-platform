import { getPresentation, getComments, getFleet } from "@/lib/api";
import { PresentationDetailView } from "@/components/PresentationDetail";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function PresentationPage({
  params,
}: {
  params: Promise<{ id: string; slotId: string }>;
}) {
  const { id, slotId } = await params;
  const [detail, fleet] = await guard(
    // The room list only feeds R7's room-PC freshness (D-110); without it nothing changes.
    Promise.all([getPresentation(slotId), getFleet(id).catch(() => ({ items: [] }))]),
    `/events/${id}/talks/${slotId}`,
  );
  const latest = detail.versions[0];
  const comments = latest
    ? (await guard(getComments(latest.file_version_id), `/events/${id}/talks/${slotId}`)).items
    : [];
  return <PresentationDetailView eventId={id} initial={detail} comments={comments} rooms={fleet.items} />;
}
