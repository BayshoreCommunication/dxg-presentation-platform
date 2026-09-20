import { getPresentation, getComments } from "@/lib/api";
import { PresentationDetailView } from "@/components/PresentationDetail";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function PresentationPage({
  params,
}: {
  params: Promise<{ id: string; slotId: string }>;
}) {
  const { id, slotId } = await params;
  const detail = await guard(getPresentation(slotId), `/events/${id}/talks/${slotId}`);
  const latest = detail.versions[0];
  const comments = latest
    ? (await guard(getComments(latest.file_version_id), `/events/${id}/talks/${slotId}`)).items
    : [];
  return <PresentationDetailView eventId={id} initial={detail} comments={comments} />;
}
