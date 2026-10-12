import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMyPresentations, getSession, PortalError } from "@/lib/api";
import { Presentations } from "@/components/Presentations";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Manage presentations — DXG·PM" };

/**
 * Where the speaker site opens (D-146, D-148). A speaker goes to Manage presentations for their
 * newest event — each event has its own, chosen in the sidebar (Travis, 2026-10-12: one event at a
 * time, not one under another). Support staff have no switcher, so they see every event of the
 * speaker they assist here.
 */
export default async function HomePage() {
  let target: string | null = null;
  try {
    const { principal } = await getSession();
    // A temporary password opens nothing but the page that replaces it.
    if (principal.must_change_password) redirect("/account/password?first=1");
    const { speaker, events } = await getMyPresentations();
    if (principal.assisting || events.length === 0) return <Presentations speaker={speaker} events={events} />;
    target = `/events/${events[0]!.id}/presentations`;
  } catch (caught) {
    if (caught instanceof PortalError && (caught.status === 401 || caught.status === 403)) {
      redirect("/login?reason=required");
    }
    throw caught;
  }
  redirect(target);
}
