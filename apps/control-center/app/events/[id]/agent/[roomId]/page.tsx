import { getAgentView } from "@/lib/api";
import { RoomAgentView } from "@/components/RoomAgentView";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function RoomAgentPage({
  params,
}: {
  params: Promise<{ id: string; roomId: string }>;
}) {
  const { id, roomId } = await params;
  const view = await guard(getAgentView(roomId), `/events/${id}/agent/${roomId}`);
  return <RoomAgentView initial={view} />;
}
