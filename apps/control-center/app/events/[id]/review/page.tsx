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
  const session = await guard(getSession(), `/events/${id}/review`);

  /*
   * DXG Technician staff see the approved presentations and take in new files (D-162, D-165);
   * reviewing — the queue and its decisions — is support staff's and admins'.
   */
  if (session.principal.staff_kind === "technician") {
    const [talks, summary, approved] = await guard(
      Promise.all([getTalks(id), getSummary(id), getApproved(id)]),
      `/events/${id}/review`,
    );
    return (
      <>
        <h1 className="htitle">Manage presentations</h1>
        <UploadNewVersion eventId={id} talks={talks.items} timezone={summary.event.timezone} />
        <ApprovedPresentations eventId={id} items={approved.items} timezone={summary.event.timezone} />
      </>
    );
  }
  // Client access (D-196) sees the approved presentations; the review queue is DXG's.
  if (session.principal.staff_kind === "client") {
    const [summary, approved] = await guard(Promise.all([getSummary(id), getApproved(id)]), `/events/${id}/review`);
    return (
      <>
        <h1 className="htitle">Manage presentations</h1>
        <ApprovedPresentations eventId={id} items={approved.items} timezone={summary.event.timezone} />
      </>
    );
  }

  const [{ items }, summary, approved] = await guard(
    Promise.all([getReviewQueue(id), getSummary(id), getApproved(id)]),
    `/events/${id}/review`,
  );
  return (
    <ReviewWorkspace
      eventId={id}
      initialQueue={items}
      initialSelectedId={v ?? null}
      timezone={summary.event.timezone}
      approved={<ApprovedPresentations eventId={id} items={approved.items} timezone={summary.event.timezone} />}
    />
  );
}
