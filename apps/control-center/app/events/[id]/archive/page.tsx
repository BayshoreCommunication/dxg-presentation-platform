import { getArchiveScope } from "@/lib/api";
import { ArchiveView } from "@/components/ArchiveView";
import { guard } from "@/lib/guard";
import { notForClientAccess } from "@/lib/clientAccess";

export const dynamic = "force-dynamic";

export default async function ArchivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // DXG's screen, not Client access's (D-196).
  await notForClientAccess();
  const scope = await guard(getArchiveScope(id), `/events/${id}/archive`);
  return <ArchiveView eventId={id} initial={scope} />;
}
