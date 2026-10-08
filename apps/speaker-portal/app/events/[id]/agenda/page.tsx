import { redirect } from "next/navigation";
import { getMyAgenda, PortalError } from "@/lib/api";
import { Agenda } from "@/components/Agenda";

export const dynamic = "force-dynamic";

/** The event's programme, read-only, with the speaker's own talks marked. */
export default async function AgendaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { event, items } = await getMyAgenda(id);
    return <Agenda event={event} sessions={items} />;
  } catch (caught) {
    if (caught instanceof PortalError && (caught.status === 401 || caught.status === 403)) redirect("/login?reason=required");
    if (caught instanceof PortalError && caught.status === 404) redirect("/portfolio");
    throw caught;
  }
}
