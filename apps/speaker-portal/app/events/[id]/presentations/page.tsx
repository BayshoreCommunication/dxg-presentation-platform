import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMyPresentations, getSession, PortalError } from "@/lib/api";
import { Presentations } from "@/components/Presentations";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Manage presentations — DXG·PM" };

/**
 * Manage presentations for one event (D-146; Travis, 2026-10-12): the speaker's presentations on
 * the event chosen in the sidebar, with upload, update and download of the approved file.
 */
export default async function EventPresentationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let target: string | null = null;
  try {
    const { principal } = await getSession();
    if (principal.must_change_password) redirect("/account/password?first=1");
    // Support staff have one page, the speaker's every event (no switcher for them).
    if (principal.assisting) target = "/";
    else {
      const { speaker, events } = await getMyPresentations();
      const event = events.find((item) => item.id === id);
      // An event they don't speak at (or no longer do): their newest, or the empty page.
      if (event) return <Presentations speaker={speaker} events={[event]} />;
      target = "/";
    }
  } catch (caught) {
    if (caught instanceof PortalError && (caught.status === 401 || caught.status === 403)) {
      redirect("/login?reason=required");
    }
    throw caught;
  }
  redirect(target);
}
