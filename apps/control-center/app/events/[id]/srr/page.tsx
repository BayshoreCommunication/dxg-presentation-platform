import { getSrrDashboard } from "@/lib/api";
import { SrrDashboardView } from "@/components/SrrDashboard";

export const dynamic = "force-dynamic";

export default async function SrrPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getSrrDashboard(id);
  return <SrrDashboardView eventId={id} data={data} />;
}
