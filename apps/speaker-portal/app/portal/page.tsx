import { redirect } from "next/navigation";

/** The old address of the speaker's page; everything is at the root now (D-148). */
export default function PortalPage() {
  redirect("/");
}
