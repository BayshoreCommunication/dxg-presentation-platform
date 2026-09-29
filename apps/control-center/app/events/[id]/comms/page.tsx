import { getComms, getSummary } from "@/lib/api";
import { CommsView } from "@/components/CommsView";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function CommsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The summary carries the event's name and clock, for the email preview (S33, D-112).
  const [data, summary] = await guard(Promise.all([getComms(id), getSummary(id)]), `/events/${id}/comms`);
  return (
    <CommsView
      eventId={id}
      data={data}
      event={{ name: summary.event.name, timezone: summary.event.timezone, starts_on: summary.event.starts_on }}
    />
  );
}
