import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMyPresentations, getSession, PortalError } from "@/lib/api";
import { Presentations } from "@/components/Presentations";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Manage presentations — DXG·PM" };

/**
 * The speaker site's one screen (D-146, D-148): every presentation the signed-in speaker
 * gives, on every event, with upload, update and download of the approved file.
 */
export default async function PresentationsPage() {
  try {
    const { principal } = await getSession();
    // A temporary password opens nothing but the page that replaces it.
    if (principal.must_change_password) redirect("/account/password?first=1");
    const { speaker, events } = await getMyPresentations();
    return <Presentations speaker={speaker} events={events} />;
  } catch (caught) {
    if (caught instanceof PortalError && (caught.status === 401 || caught.status === 403)) {
      redirect("/login?reason=required");
    }
    throw caught;
  }
}
