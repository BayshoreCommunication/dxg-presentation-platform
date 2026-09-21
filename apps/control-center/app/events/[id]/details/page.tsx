import { redirect } from "next/navigation";
import { getDraft, getSession, getSummary } from "@/lib/api";
import { EventDetails } from "@/components/EventDetails";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

/** Who may change an event's setup. A hint for the UI; `services/events.ts` decides. */
const CONFIGURERS = ["presentation_manager", "project_manager", "platform_admin"];

/**
 * Event details — what this event *is*, as opposed to how it is going.
 *
 * The command centre answers the second question and only ever the second: how many
 * talks are in, what is at risk, which rooms are ready. Everything the wizard set —
 * the timezone every displayed time is rendered in, the upload deadline that closes
 * the portal, the reminder cadence, the accent colour, the rooms and days the agenda
 * created — was written once and then visible nowhere, so a wrong one could not be
 * found, let alone corrected.
 */
export default async function EventDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [setup, summary, session] = await guard(
    Promise.all([getDraft(id), getSummary(id), getSession()]),
    `/events/${id}/details`,
  );

  // A draft's details are the wizard's four steps, still being filled in. Sending it
  // there keeps one screen for setting an event up rather than two that overlap.
  if (setup.status === "draft") redirect(`/events/new?event=${id}`);

  return (
    <EventDetails
      setup={setup}
      talks={{ total: summary.total, collected: summary.collected }}
      canEdit={session.principal.roles.some((role) => CONFIGURERS.includes(role))}
    />
  );
}
