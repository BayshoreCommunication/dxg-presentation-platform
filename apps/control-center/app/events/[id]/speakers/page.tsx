import { getSpeakers, getDuplicates } from "@/lib/api";
import { SpeakersView } from "@/components/SpeakersView";

export const dynamic = "force-dynamic";

export default async function SpeakersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [speakers, duplicates] = await Promise.all([getSpeakers(id), getDuplicates(id)]);
  return <SpeakersView eventId={id} initial={speakers.items} duplicates={duplicates.items} />;
}
