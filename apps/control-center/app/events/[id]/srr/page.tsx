import { getSession, getSrrDashboard, getSummary } from "@/lib/api";
import { SrrDashboardView } from "@/components/SrrDashboard";
import { guard } from "@/lib/guard";
import { notForClientAccess } from "@/lib/clientAccess";

export const dynamic = "force-dynamic";

export default async function SrrPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // DXG's screen, not Client access's (D-196).
  await notForClientAccess();
  const [data, summary, session] = await guard(
    Promise.all([getSrrDashboard(id), getSummary(id), getSession()]),
    `/events/${id}/srr`,
  );
  // Who opens the room on the event day (D-157): a DXG Admin alone (D-193).
  const principal = session.principal;
  const canSwitch = principal.is_root_admin;
  return (
    <SrrDashboardView
      eventId={id}
      eventName={summary.event.name}
      timezone={summary.event.timezone}
      data={data}
      canSwitch={canSwitch}
      canUpload={principal.staff_kind === "technician"}
      meId={principal.user_id}
    />
  );
}
