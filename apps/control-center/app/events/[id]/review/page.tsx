import { getReviewQueue, getSummary, getTalks } from "@/lib/api";
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
  const [{ items }, talks, summary] = await guard(
    Promise.all([getReviewQueue(id), getTalks(id), getSummary(id)]),
    `/events/${id}/review`,
  );
  return (
    <ReviewWorkspace
      eventId={id}
      initialQueue={items}
      initialSelectedId={v ?? null}
      upload={<UploadNewVersion eventId={id} talks={talks.items} timezone={summary.event.timezone} />}
    />
  );
}
