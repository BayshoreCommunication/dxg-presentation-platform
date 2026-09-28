import { TALK_STATUS } from "@pmp/format";

/**
 * What each presentation status means, in the order a talk moves through them
 * (D-065). Derived from the shared vocabulary (R47, D-110) so the status guide, every
 * pill's hover text and the visible meaning lines cannot drift. The labels themselves
 * are DXG-approved copy (VISUAL_ACCEPTANCE §2.2) and are not renamed here.
 */
export const STATUS_HELP: { status: string; label: string; meaning: string; next?: string }[] = Object.entries(
  TALK_STATUS,
).map(([status, words]) => ({ status, ...words }));

export const statusMeaning = (status: string): string | undefined => TALK_STATUS[status]?.meaning;
