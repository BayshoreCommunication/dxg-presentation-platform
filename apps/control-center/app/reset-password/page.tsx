import { ResetPassword } from "@/components/ResetPassword";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <ResetPassword token={token ?? ""} />;
}
