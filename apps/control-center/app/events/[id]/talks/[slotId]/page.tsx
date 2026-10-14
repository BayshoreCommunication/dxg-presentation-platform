import { getPresentation, getComments, getSession } from "@/lib/api";
import { PresentationDetailView } from "@/components/PresentationDetail";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function PresentationPage({
  params,
}: {
  params: Promise<{ id: string; slotId: string }>;
}) {
  const { id, slotId } = await params;
  // No room list any more: it only fed R7's room-PC freshness, dropped in D-125.
  // Rolling back is a DXG Admin's: support staff (D-151) and technicians (D-163) look.
  const staffKind = await getSession()
    .then((session) => session.principal.staff_kind)
    .catch(() => null);
  const readOnly = staffKind === "support" || staffKind === "technician";
  const detail = await guard(getPresentation(slotId), `/events/${id}/talks/${slotId}`);
  const latest = detail.versions[0];
  const comments = latest
    ? (await guard(getComments(latest.file_version_id), `/events/${id}/talks/${slotId}`)).items
    : [];
  return (
    <PresentationDetailView
      eventId={id}
      initial={detail}
      comments={comments}
      readOnly={readOnly}
      canUpload={staffKind === "technician"}
    />
  );
}
