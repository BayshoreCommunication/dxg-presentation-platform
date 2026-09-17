import { getArchiveScope } from "@/lib/api";
import { ArchiveView } from "@/components/ArchiveView";

export const dynamic = "force-dynamic";

export default async function ArchivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await getArchiveScope(id);
  return <ArchiveView eventId={id} initial={scope} />;
}
