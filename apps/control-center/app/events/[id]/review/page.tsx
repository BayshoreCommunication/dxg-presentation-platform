import { getReviewQueue } from "@/lib/api";
import { ReviewWorkspace } from "@/components/ReviewWorkspace";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { items } = await guard(getReviewQueue(id), `/events/${id}/review`);
  return <ReviewWorkspace initialQueue={items} />;
}
