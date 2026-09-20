import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Which event, when a client account holds more than one.
 *
 * Only reachable in that case: one event goes straight through, and none is not a
 * choice but a missing role, which `/no-access` explains. Guessing on the account's
 * behalf would risk opening the wrong client's event, which is the one mistake this
 * surface must not make.
 */
export default async function ClientEventsPage() {
  const { principal } = await getSession().catch(() => ({ principal: null }));
  if (!principal) redirect("/login?reason=required");

  const events = principal.client_events;
  if (events.length === 0) redirect("/no-access?reason=No%20event%20is%20shared%20with%20your%20account%20yet.");
  if (events.length === 1) redirect(`/client/${events[0]!.id}`);

  return (
    <div className="card" style={{ maxWidth: 520, margin: "40px auto" }}>
      <div className="cbd">
        <h1 className="htitle" style={{ marginTop: 0 }}>
          Choose an event
        </h1>
        <p className="note" style={{ marginTop: 8, marginBottom: 16 }}>
          Your account is on more than one.
        </p>
        {events.map((event) => (
          <Link
            key={event.id}
            href={`/client/${event.id}`}
            className="btn"
            style={{ display: "block", marginBottom: 8, textAlign: "left" }}
          >
            {event.name} →
          </Link>
        ))}
      </div>
    </div>
  );
}
