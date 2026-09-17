import { getClientView } from "@/lib/api";
import { ClientPortalView } from "@/components/ClientPortalView";

export const dynamic = "force-dynamic";

export default async function ClientPortalPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const data = await getClientView(eventId);
  return <ClientPortalView data={data} />;
}
