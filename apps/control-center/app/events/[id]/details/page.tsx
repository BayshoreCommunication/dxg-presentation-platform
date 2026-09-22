import { redirect } from "next/navigation";

/**
 * Screen 18 is gone (D-058): an event's setup is the top of its command centre now, so
 * opening an event shows what it is and how it is going together rather than a click
 * apart.
 *
 * The route stays as a redirect rather than being deleted. It was linked from the
 * portfolio and from the command centre's own header, and it is the kind of URL that
 * ends up in a bookmark or a message — a 404 would be a worse answer than the page the
 * content moved to.
 */
export default async function EventDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/events/${id}`);
}
