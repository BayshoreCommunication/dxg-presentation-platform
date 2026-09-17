import { getComms } from "@/lib/api";
import { CommsView } from "@/components/CommsView";

export const dynamic = "force-dynamic";

export default async function CommsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getComms(id);
  return <CommsView eventId={id} data={data} />;
}
