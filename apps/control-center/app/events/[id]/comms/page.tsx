import { getComms } from "@/lib/api";
import { CommsView } from "@/components/CommsView";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function CommsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await guard(getComms(id), `/events/${id}/comms`);
  return <CommsView eventId={id} data={data} />;
}
