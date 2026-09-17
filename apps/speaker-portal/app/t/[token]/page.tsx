import { PortalView } from "@/components/PortalView";

export default async function TokenPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PortalView token={token} />;
}
