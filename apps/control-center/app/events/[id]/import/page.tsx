import { ImportView } from "@/components/ImportView";

export const dynamic = "force-dynamic";

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ImportView eventId={id} />;
}
