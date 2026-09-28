/**
 * How an event's stored status is shown. One copy, because the portfolio card and the
 * details header must not be able to disagree about what `draft` is called — and the
 * word is fixed copy (VISUAL_ACCEPTANCE §2.2), not a per-screen choice.
 */
export const EVENT_STATUS: Record<string, { status: string; label: string }> = {
  active: { status: "submitted", label: "Onsite now" },
  draft: { status: "canceled", label: "Planning" },
  closed: { status: "canceled", label: "Closed" },
  archived: { status: "archived", label: "Archived" },
};

/**
 * An active event's label follows its dates (D-108): "Onsite now" used to show on every
 * active event — one that ended in March as much as one months away.
 */
export function eventStatusChip(
  status: string,
  dates?: { starts_on: string; ends_on: string; timezone?: string },
): { status: string; label: string } {
  if (status === "active" && dates) {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: dates.timezone ?? "America/New_York" });
    if (today < dates.starts_on) return { status: "processing", label: "Upcoming" };
    if (today > dates.ends_on) return { status: "canceled", label: "Event over — ready to archive" };
  }
  return EVENT_STATUS[status] ?? { status: "canceled", label: status };
}
