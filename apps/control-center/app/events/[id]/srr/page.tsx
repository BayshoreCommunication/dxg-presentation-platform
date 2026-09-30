import { getSrrDashboard, getSummary } from "@/lib/api";
import { SrrDashboardView } from "@/components/SrrDashboard";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function SrrPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, summary] = await guard(Promise.all([getSrrDashboard(id), getSummary(id)]), `/events/${id}/srr`);
  return (
    <SrrDashboardView eventId={id} eventName={summary.event.name} timezone={summary.event.timezone} data={data} />
  );
}
