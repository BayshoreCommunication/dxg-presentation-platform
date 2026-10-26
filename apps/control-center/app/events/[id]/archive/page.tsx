import { getArchiveScope } from "@/lib/api";
import { ArchiveView } from "@/components/ArchiveView";
import { guard } from "@/lib/guard";
import { isClientAccess } from "@/lib/clientAccess";

export const dynamic = "force-dynamic";

export default async function ArchivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Client access (D-196) sees its archive — the package and its download — not the build.
  const [scope, client] = await Promise.all([guard(getArchiveScope(id), `/events/${id}/archive`), isClientAccess()]);
  return <ArchiveView eventId={id} initial={scope} client={client} />;
}
