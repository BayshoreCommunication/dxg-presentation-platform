import { HelpView } from "@/components/HelpView";
import { notForClientAccess } from "@/lib/clientAccess";

export const dynamic = "force-dynamic";

/** Task guides and glossary (D-115) — written for the team, so not Client access's (D-196). */
export default async function HelpPage() {
  await notForClientAccess();
  return <HelpView />;
}
