import { getPresentation, getFindings } from "@/lib/api";
import { InspectionView } from "@/components/InspectionView";

export const dynamic = "force-dynamic";

export default async function InspectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; slotId: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id, slotId } = await params;
  const { v } = await searchParams;
  const detail = await getPresentation(slotId);
  const version =
    detail.versions.find((row) => row.file_version_id === v) ?? detail.versions[0] ?? null;
  const findings = version ? (await getFindings(version.file_version_id)).items : [];
  return (
    <InspectionView eventId={id} detail={detail} version={version} initialFindings={findings} />
  );
}
