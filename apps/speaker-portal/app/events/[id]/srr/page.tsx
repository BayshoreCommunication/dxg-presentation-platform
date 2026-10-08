import { redirect } from "next/navigation";
import { getMySrr, PortalError } from "@/lib/api";
import { SpeakerReadyRoom } from "@/components/SpeakerReadyRoom";

export const dynamic = "force-dynamic";

/** The Speaker Ready Room as the speaker sees it. */
export default async function SrrPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const srr = await getMySrr(id);
    return <SpeakerReadyRoom srr={srr} />;
  } catch (caught) {
    if (caught instanceof PortalError && (caught.status === 401 || caught.status === 403)) redirect("/login?reason=required");
    if (caught instanceof PortalError && caught.status === 404) redirect("/portfolio");
    throw caught;
  }
}
