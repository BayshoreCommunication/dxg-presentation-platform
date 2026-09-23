/**
 * What each presentation status means, in the order a talk moves through them
 * (D-065). One copy, used by the status guide and by every status pill's hover text,
 * so the two cannot drift. The labels themselves are fixed copy (VISUAL_ACCEPTANCE
 * §2.2) and come from the API; these are only their explanations.
 */
export const STATUS_HELP: { status: string; label: string; meaning: string }[] = [
  { status: "missing", label: "Missing", meaning: "Nothing uploaded yet." },
  { status: "processing", label: "Processing", meaning: "Just uploaded — being virus-scanned and inspected." },
  { status: "submitted", label: "Submitted", meaning: "Passed the checks and waiting for a reviewer." },
  {
    status: "needs_revision",
    label: "Needs revision",
    meaning: "A reviewer asked for changes, or the inspection failed. Waiting on the speaker.",
  },
  { status: "approved", label: "Approved", meaning: "Approved by a reviewer, not yet sent to a room." },
  {
    status: "approved_delivering",
    label: "Approved — delivering",
    meaning: "Approved and being copied to the room's presentation computer.",
  },
  {
    status: "update_pending_ack",
    label: "Update pending ack",
    meaning: "A newer version reached the room; the room technician must confirm the swap.",
  },
  {
    status: "synchronized_onsite",
    label: "Synchronized onsite",
    meaning: "On the room's computer and ready to play. Nothing left to do.",
  },
  { status: "attention", label: "Attention", meaning: "Failed the virus scan or integrity check, so it is held back." },
  { status: "canceled", label: "Canceled", meaning: "The session was cancelled. Files are kept." },
  { status: "archived", label: "Archived", meaning: "The event is archived and read-only." },
];

export const statusMeaning = (status: string): string | undefined =>
  STATUS_HELP.find((entry) => entry.status === status)?.meaning;
