import { getSpeakers, getDuplicates, getAgenda } from "@/lib/api";
import { SpeakersView } from "@/components/SpeakersView";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function SpeakersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [speakers, duplicates, agenda] = await guard(
    Promise.all([getSpeakers(id), getDuplicates(id), getAgenda(id)]),
    `/events/${id}/speakers`,
  );
  // The talks a new speaker can be put straight onto; a canceled session takes nobody.
  const talks = agenda.items
    .filter((session) => session.state !== "canceled")
    .flatMap((session) =>
      session.presentations.map((talk) => ({
        slot_id: talk.slot_id,
        label: talk.title === session.title ? talk.title : `${session.title} · ${talk.title}`,
      })),
    );
  return <SpeakersView eventId={id} initial={speakers.items} duplicates={duplicates.items} talks={talks} />;
}
