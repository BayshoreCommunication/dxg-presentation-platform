import { getSpeakers, getDuplicates, getAgenda, getSummary } from "@/lib/api";
import { SpeakersView } from "@/components/SpeakersView";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

const clock = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });

/** A bare `YYYY-MM-DD` as a calendar day — never shifted through a timezone. */
const dayOf = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

export default async function SpeakersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [speakers, duplicates, agenda, summary] = await guard(
    Promise.all([getSpeakers(id), getDuplicates(id), getAgenda(id), getSummary(id)]),
    `/events/${id}/speakers`,
  );
  const timeZone = summary.event.timezone;
  /*
   * The sessions a new speaker can be put straight into (D-135); a canceled one takes
   * nobody. A session has one presentation (D-132) and the speaker is attached to it, so
   * the choice is offered as the session — what staff see on the agenda — with its day,
   * time and room, which is how two sessions with similar titles are told apart.
   */
  /*
   * One choice per session (D-137): the speaker gets a presentation of their own in it,
   * so which of its presentations is offered does not matter — the server puts them on
   * their own. Its first presentation stands for the session.
   */
  const talks = agenda.items
    .filter((session) => session.state !== "canceled" && session.presentations.length > 0)
    .map((session) => {
      const first = session.presentations[0]!;
      return {
        slot_id: first.slot_id,
        label: session.title,
        day: session.day ? dayOf(session.day) : "No day yet",
        time: clock(first.starts_at ?? session.starts_at, timeZone),
        room: session.room ?? "No room yet",
      };
    });
  return <SpeakersView eventId={id} initial={speakers.items} duplicates={duplicates.items} talks={talks} />;
}
