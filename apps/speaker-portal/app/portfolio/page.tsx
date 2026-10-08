import { redirect } from "next/navigation";
import { getMyPresentations, PortalError } from "@/lib/api";
import { Portfolio } from "@/components/Portfolio";

export const dynamic = "force-dynamic";

/** The speaker's events, one card each, with how their presentations stand on it. */
export default async function PortfolioPage() {
  try {
    const { events } = await getMyPresentations();
    return <Portfolio events={events} />;
  } catch (caught) {
    if (caught instanceof PortalError && (caught.status === 401 || caught.status === 403)) redirect("/login?reason=required");
    throw caught;
  }
}
