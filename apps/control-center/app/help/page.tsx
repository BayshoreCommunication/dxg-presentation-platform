import { HelpView } from "@/components/HelpView";
import { getSession } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Task guides and glossary (D-115); a speaker account sees its own guide (D-146). */
export default async function HelpPage() {
  const speaker = await getSession()
    .then((session) => session.principal.account_kind === "speaker")
    .catch(() => false);
  return <HelpView speaker={speaker} />;
}
