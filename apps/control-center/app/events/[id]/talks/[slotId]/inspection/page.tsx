import { getPresentation, getFindings, getSession } from "@/lib/api";
import { InspectionView } from "@/components/InspectionView";
import { guard } from "@/lib/guard";

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
  // Support staff ask the speaker; admins ask and waive; technicians read (D-165).
  const kind = await getSession()
    .then((session) => session.principal.staff_kind)
    .catch(() => null);
  const detail = await guard(getPresentation(slotId), `/events/${id}/talks/${slotId}/inspection`);
  const version =
    detail.versions.find((row) => row.file_version_id === v) ?? detail.versions[0] ?? null;
  const findings = version
    ? (await guard(getFindings(version.file_version_id), `/events/${id}/talks/${slotId}/inspection`)).items
    : [];
  return (
    <InspectionView
      eventId={id}
      detail={detail}
      version={version}
      initialFindings={findings}
      canAskSpeaker={kind !== "technician"}
      canWaive={kind !== "support" && kind !== "technician"}
    />
  );
}
