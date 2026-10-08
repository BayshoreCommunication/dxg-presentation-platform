import { ChangePasswordForm } from "@/components/ChangePasswordForm";
import { getSession } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function PasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ first?: string }>;
}) {
  const { first } = await searchParams;
  // Whether this is a speaker's sign-in (D-146) decides what the page promises comes next.
  const speaker = await getSession()
    .then((session) => session.principal.account_kind === "speaker")
    .catch(() => false);
  return <ChangePasswordForm firstUse={first === "1"} speaker={speaker} />;
}
