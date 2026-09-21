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

export const eventStatusChip = (status: string) =>
  EVENT_STATUS[status] ?? { status: "canceled", label: status };
