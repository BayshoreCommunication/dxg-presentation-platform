import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession, getTalks, PortalError } from "@/lib/api";
import { PortalView } from "@/components/PortalView";

export const dynamic = "force-dynamic";

/** The tab names the speaker's own event. */
export async function generateMetadata(): Promise<Metadata> {
  try {
    const session = await getSession();
    return { title: `Speaker Upload — ${session.event.name}` };
  } catch {
    return { title: "Speaker Upload" };
  }
}

export default async function PortalPage() {
  try {
    const [session, talks] = await Promise.all([getSession(), getTalks()]);
    return <PortalView session={session} talks={talks.items} />;
  } catch (caught) {
    if (caught instanceof PortalError && (caught.status === 401 || caught.status === 403)) {
      redirect("/login?reason=required");
    }
    throw caught;
  }
}
