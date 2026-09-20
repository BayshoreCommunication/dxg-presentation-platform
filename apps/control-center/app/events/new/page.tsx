import { getTimezones } from "@/lib/api";
import { CreateEventWizard } from "@/components/CreateEventWizard";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const { items } = await guard(getTimezones(), "/events/new");
  return <CreateEventWizard timezones={items} />;
}
