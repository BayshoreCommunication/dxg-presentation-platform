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
            <h1 className="htitle">Client portal</h1>
            <div className="err" style={{ marginTop: 10 }}>
              {caught.message}
            </div>
            <div className="note" style={{ marginTop: 10 }}>
              Sign in with a client account to see this page. Staff should use the Command center.
            </div>
          </div>
        </div>
      );
    }
    throw caught;
  }
}
