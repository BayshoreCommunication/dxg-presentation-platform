import Link from "next/link";
import { ApiError, getCheckin, getSession, getSummary } from "@/lib/api";
import { CheckinView } from "@/components/CheckinView";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function CheckinPage({
  params,
}: {
  params: Promise<{ id: string; checkinId: string }>;
}) {
  const { id, checkinId } = await params;
  const [detail, summary, session] = await guard(
    Promise.all([
      // A check-in that no longer exists says so; it used to crash the page ("Application error").
      getCheckin(checkinId).catch((caught: unknown) =>
        caught instanceof ApiError && caught.status === 404 ? null : Promise.reject(caught),
      ),
      getSummary(id),
      getSession(),
    ]),
    `/events/${id}/srr/${checkinId}`,
  );
  if (!detail) {
    return (
      <div className="card">
        <div className="cbd">
          <h1 className="htitle" style={{ marginTop: 0 }}>This check-in no longer exists</h1>
          <p className="note">It may have been removed, or the link is from another event.</p>
          <Link className="btn pri" href={`/events/${id}/srr`}>
            ← Back to the Speaker Ready Room
          </Link>
        </div>
      </div>
    );
  }
  return (
    <CheckinView
      eventId={id}
      timezone={summary.event.timezone}
      initial={detail}
      srrOpen={summary.event.srr_open}
      canUpload={session.principal.staff_kind === "technician"}
    />
  );
}
