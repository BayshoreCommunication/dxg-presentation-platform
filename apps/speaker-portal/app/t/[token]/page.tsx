import { redirect } from "next/navigation";

/**
 * The emailed link carries the access code. It pre-fills the sign-in form rather
 * than signing anyone in on its own: the code plus the presenter's own email is
 * the credential, so a forwarded email is not enough (D-016).
 */
export default async function TokenLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(`/login?code=${encodeURIComponent(token)}`);
}
