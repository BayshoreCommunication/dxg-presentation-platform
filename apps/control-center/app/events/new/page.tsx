import { redirect } from "next/navigation";
import { getTimezones, getDraft } from "@/lib/api";
import { CreateEventWizard } from "@/components/CreateEventWizard";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

/**
 * Screen 2. `?event=<id>` resumes an unfinished draft instead of starting a new one —
 * the same screen either way, because it is the same job: this is where an event is
 * set up, and a draft is an event whose setup stopped part way.
 */
export default async function NewEventPage({
  searchParams,
}: {
  searchParams: Promise<{ event?: string }>;
}) {
  const { event } = await searchParams;
  const { items } = await guard(getTimezones(), "/events/new");

  if (!event) return <CreateEventWizard timezones={items} />;

  const draft = await guard(getDraft(event), `/events/new?event=${event}`);
  // An event that is no longer a draft has nothing left to resume, and offering to
  // activate it a second time would be a button with no meaning. Its command centre is
  // the right place for it.
  if (draft.status !== "draft") redirect(`/events/${draft.id}`);

  return <CreateEventWizard timezones={items} resume={draft} />;
}
