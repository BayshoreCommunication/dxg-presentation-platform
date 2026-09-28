import Link from "next/link";
import { redirect } from "next/navigation";
import { getClientView, ApiError } from "@/lib/api";
import { ClientPortalView } from "@/components/ClientPortalView";

export const dynamic = "force-dynamic";

export default async function ClientPortalPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  try {
    const data = await getClientView(eventId);
    return <ClientPortalView data={data} />;
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 401) {
      redirect(`/login?next=${encodeURIComponent(`/client/${eventId}`)}&reason=required`);
    }
    // A signed-in staff member landing here is refused by design: the client
    // portal is a client surface, not a staff view of one.
    if (caught instanceof ApiError && caught.status === 403) {
      return (
        <div className="card">
          <div className="cbd">
            <h1 className="htitle">This event isn&rsquo;t shared with you</h1>
            <div className="note" style={{ marginTop: 10, lineHeight: 1.6 }}>
              This page shows one event to that client&rsquo;s contacts. Your account can&rsquo;t open
              this event here. DXG staff can preview a client&rsquo;s view from events they work on.
            </div>
            <div style={{ marginTop: 14 }}>
              <Link href="/" className="btn pri">
                Back to portfolio
              </Link>
            </div>
          </div>
        </div>
      );
    }
    throw caught;
  }
}
