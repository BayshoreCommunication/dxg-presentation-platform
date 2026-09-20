import { getSpeakers, getDuplicates } from "@/lib/api";
import { SpeakersView } from "@/components/SpeakersView";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function SpeakersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [speakers, duplicates] = await guard(
    Promise.all([getSpeakers(id), getDuplicates(id)]),
    `/events/${id}/speakers`,
  );
  return <SpeakersView eventId={id} initial={speakers.items} duplicates={duplicates.items} />;
}
