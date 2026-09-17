import { getPresentation, getComments } from "@/lib/api";
import { PresentationDetailView } from "@/components/PresentationDetail";

export const dynamic = "force-dynamic";

export default async function PresentationPage({
  params,
}: {
  params: Promise<{ id: string; slotId: string }>;
}) {
  const { id, slotId } = await params;
  const detail = await getPresentation(slotId);
  const latest = detail.versions[0];
  const comments = latest ? (await getComments(latest.file_version_id)).items : [];
  return <PresentationDetailView eventId={id} initial={detail} comments={comments} />;
}
