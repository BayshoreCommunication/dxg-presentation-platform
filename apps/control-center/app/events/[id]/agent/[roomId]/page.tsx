import { getAgentView } from "@/lib/api";
import { RoomAgentView } from "@/components/RoomAgentView";

export const dynamic = "force-dynamic";

export default async function RoomAgentPage({
  params,
}: {
  params: Promise<{ id: string; roomId: string }>;
}) {
  const { roomId } = await params;
  const view = await getAgentView(roomId);
  return <RoomAgentView initial={view} />;
}
