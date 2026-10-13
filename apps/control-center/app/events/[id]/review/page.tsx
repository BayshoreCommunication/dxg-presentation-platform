import { getApproved, getReviewQueue, getSession, getSummary, getTalks } from "@/lib/api";
import { ApprovedPresentations } from "@/components/ApprovedPresentations";
import { ReviewWorkspace } from "@/components/ReviewWorkspace";
import { UploadNewVersion } from "@/components/UploadNewVersion";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `?v=` opens that file in the workspace (R22, D-113). */
  searchParams: Promise<{ v?: string }>;
}) {
  const { id } = await params;
  const { v } = await searchParams;
  const [{ items }, talks, summary, session, approved] = await guard(
    Promise.all([getReviewQueue(id), getTalks(id), getSummary(id), getSession(), getApproved(id)]),
    `/events/${id}/review`,
  );
  // Taking in a file for a speaker is DXG Technician staff's alone (D-162).
  const canUpload = session.principal.staff_kind === "technician";
  // A technician approves; asking for changes and rejecting are support staff's and admins' (D-163).
  const canSendBack = session.principal.staff_kind !== "technician";
  return (
    <ReviewWorkspace
      eventId={id}
      initialQueue={items}
      initialSelectedId={v ?? null}
      upload={canUpload ? <UploadNewVersion eventId={id} talks={talks.items} timezone={summary.event.timezone} /> : null}
      canSendBack={canSendBack}
      approved={<ApprovedPresentations eventId={id} items={approved.items} timezone={summary.event.timezone} />}
    />
  );
}
