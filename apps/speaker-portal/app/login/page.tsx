import { SpeakerLogin } from "@/components/SpeakerLogin";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  return <SpeakerLogin reason={reason ?? null} />;
}
