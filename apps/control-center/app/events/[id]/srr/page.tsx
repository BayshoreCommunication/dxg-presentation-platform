import { getSession, getSrrDashboard, getSummary } from "@/lib/api";
import { SrrDashboardView } from "@/components/SrrDashboard";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function SrrPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, summary, session] = await guard(
    Promise.all([getSrrDashboard(id), getSummary(id), getSession()]),
    `/events/${id}/srr`,
  );
  // Who opens the room on the event day (D-157): DXG Admins and support staff — managers on the event.
  const principal = session.principal;
  const canSwitch =
    principal.is_root_admin ||
    (principal.event_roles ?? []).some(
      (held) => held.event_id === id && ["presentation_manager", "project_manager", "platform_admin"].includes(held.role),
    );
  return (
    <SrrDashboardView
      eventId={id}
      eventName={summary.event.name}
      timezone={summary.event.timezone}
      data={data}
      canSwitch={canSwitch}
    />
  );
}
