import { ImportView } from "@/components/ImportView";
import { notForClientAccess } from "@/lib/clientAccess";

export const dynamic = "force-dynamic";

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // DXG's screen, not Client access's (D-196).
  await notForClientAccess();
  return <ImportView eventId={id} />;
}
