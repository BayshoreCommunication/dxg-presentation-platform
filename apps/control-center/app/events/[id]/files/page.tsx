import { getEventFiles, getSummary } from "@/lib/api";
import { FilesView } from "@/components/FilesView";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

/** Every file of one event (FR-FILE-005, D-079). */
export default async function FilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const returnTo = `/events/${id}/files`;
  const [summary, files] = await Promise.all([
    guard(getSummary(id), returnTo),
    guard(getEventFiles(id, { sort: "uploaded", dir: "desc", page: 1, limit: 10 }), returnTo),
  ]);
  return (
    <FilesView eventId={id} eventName={summary.event.name} timeZone={summary.event.timezone} initial={files} />
  );
}
