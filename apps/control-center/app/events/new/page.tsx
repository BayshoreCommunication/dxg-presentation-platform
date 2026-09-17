import { getTimezones } from "@/lib/api";
import { CreateEventWizard } from "@/components/CreateEventWizard";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const { items } = await getTimezones();
  return <CreateEventWizard timezones={items} />;
}
