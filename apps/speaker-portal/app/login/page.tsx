import { PresenterLogin } from "@/components/PresenterLogin";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; reason?: string }>;
}) {
  const { code, reason } = await searchParams;
  return <PresenterLogin prefilledCode={code ?? ""} reason={reason ?? null} />;
}
