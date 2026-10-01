import { getComms, getDraft, getSummary, listEvents } from "@/lib/api";
import type { BrandAsset } from "@/lib/api";
import { CommsView } from "@/components/CommsView";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

export default async function CommsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The summary carries the event's name and clock, for the email preview (S33, D-112).
  // The draft carries the event's branding, for the email banner (D-138).
  const [data, summary, events, draft] = await guard(
    Promise.all([getComms(id), getSummary(id), listEvents(), getDraft(id)]),
    `/events/${id}/comms`,
  );
  // A practice event's mail is never sent (D-116): the audience must not say "will send".
  const practice = events.items.some((event) => event.id === id && event.is_practice);
  return (
    <CommsView
      eventId={id}
      data={data}
      event={{
        name: summary.event.name,
        timezone: summary.event.timezone,
        starts_on: summary.event.starts_on,
        ends_on: summary.event.ends_on,
        venue: summary.event.venue,
      }}
      banner={bannerOf(draft.branding)}
      practice={practice}
    />
  );
}

/**
 * The email banner's record in the event's branding (D-138), or null. Read here, on the
 * server: BrandAssetField's `assetFrom` lives in a client module and cannot run on it.
 */
function bannerOf(branding: Record<string, unknown> | undefined): BrandAsset | null {
  const value = branding?.email_banner;
  return value && typeof value === "object" && typeof (value as BrandAsset).file_name === "string"
    ? (value as BrandAsset)
    : null;
}
