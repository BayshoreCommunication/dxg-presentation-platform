import { redirect } from "next/navigation";
import { getSupportStaff, PortalError } from "@/lib/api";
import { SupportStaff } from "@/components/SupportStaff";

export const dynamic = "force-dynamic";

/** The speaker's support staff (D-155): assistants who submit presentations for them. */
export default async function SupportStaffPage() {
  try {
    const { items, max } = await getSupportStaff();
    return <SupportStaff initial={items} max={max} />;
  } catch (caught) {
    if (caught instanceof PortalError && caught.status === 401) redirect("/login?reason=required");
    // Support staff themselves are refused this page; their one page is Manage presentations.
    if (caught instanceof PortalError && caught.status === 403) redirect("/");
    throw caught;
  }
}
