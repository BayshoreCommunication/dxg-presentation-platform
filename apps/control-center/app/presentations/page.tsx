import { redirect } from "next/navigation";
import { getMyPresentations, getSession } from "@/lib/api";
import { MyPresentations } from "@/components/MyPresentations";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

/**
 * A speaker account's own screen (D-146): every presentation they speak on, on every
 * event, with upload, update and download of the approved file. Staff who land here are
 * sent to the portfolio — their view of presentations is the event's.
 */
export default async function PresentationsPage() {
  const { principal } = await getSession().catch(() => ({ principal: null }));
  if (principal && principal.account_kind !== "speaker") redirect("/");
  const { speaker, events } = await guard(getMyPresentations(), "/presentations");
  return <MyPresentations speaker={speaker} events={events} />;
}
