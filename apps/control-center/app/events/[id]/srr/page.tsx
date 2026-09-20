import { getSrrDashboard } from "@/lib/api";
import { SrrDashboardView } from "@/components/SrrDashboard";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function SrrPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await guard(getSrrDashboard(id), `/events/${id}/srr`);
  return <SrrDashboardView eventId={id} data={data} />;
}
