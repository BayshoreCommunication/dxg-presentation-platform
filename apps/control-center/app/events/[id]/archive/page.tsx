import { getArchiveScope } from "@/lib/api";
import { ArchiveView } from "@/components/ArchiveView";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function ArchivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scope = await guard(getArchiveScope(id), `/events/${id}/archive`);
  return <ArchiveView eventId={id} initial={scope} />;
}
