import { redirect } from "next/navigation";
import { listStaff, listEvents, ApiError } from "@/lib/api";
import { EventAssignments } from "@/components/EventAssignments";

export const dynamic = "force-dynamic";

/**
 * Needs both lists: the events to show, and the staff to place on them. Same
 * `listStaff` the accounts page uses — each assignment already arrives with its
 * event, so the grouping is done here rather than asked of the API twice.
 */
export default async function EventAssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ assign?: string }>;
}) {
  // A14 (D-113): `?assign=<user id>` comes from "Next: assign them to an event" on Staff accounts.
  const { assign } = await searchParams;
  try {
    const [staff, events] = await Promise.all([listStaff(), listEvents()]);
    return <EventAssignments initial={staff.items} events={events.items} assign={assign} />;
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 401) {
      redirect("/login?next=%2Fadmin%2Fassignments&reason=required");
    }
    if (caught instanceof ApiError && caught.status === 403) {
      return (
        <div className="card">
          <div className="cbd">
            <h1 className="htitle">Event assignments</h1>
            <div className="err" style={{ marginTop: 10 }}>
              {caught.message}
            </div>
          </div>
        </div>
      );
    }
    throw caught;
  }
}
