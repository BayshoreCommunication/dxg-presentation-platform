import { redirect } from "next/navigation";
import { getSession } from "./api";

/**
 * Client access (D-194) uses the control centre read-only, but not all of it (D-196): DXG's own
 * working screens — Communications, the Speaker Ready Room, Room sync, the archive's build,
 * Schedule import, the inspection report and Manage speakers — are the team's. A client who opens
 * one lands on the same page as any other kind refused a screen.
 *
 * The API refuses these screens' data on its own (`CLIENT_NOT_OFFERED` in the staff gate); this
 * is the page's way of saying so before a half-rendered screen does, and the only guard for the
 * screens whose data is read from the browser (Schedule import) or shared with a screen the
 * client keeps (Room sync's fleet feeds the overview's Room readiness).
 */
export async function isClientAccess(): Promise<boolean> {
  const session = await getSession().catch(() => null);
  return session?.principal.staff_kind === "client";
}

export async function notForClientAccess(): Promise<void> {
  if (await isClientAccess()) redirect("/no-access?for=kind");
}
