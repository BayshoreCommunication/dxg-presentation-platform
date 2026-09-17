import { getReviewQueue } from "@/lib/api";
import { ReviewWorkspace } from "@/components/ReviewWorkspace";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { items } = await getReviewQueue(id);
  return <ReviewWorkspace initialQueue={items} />;
}
