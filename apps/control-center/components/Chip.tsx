import { SEVERITY, TALK_STATUS, wordsFor } from "@pmp/format";
import { STATUS_HELP, statusMeaning } from "@/lib/statusHelp";

const labelOf = (status: string) => STATUS_HELP.find((entry) => entry.status === status)?.label;

/** Status pills. Labels come from the API (derived by @pmp/domain), never invented here. */
const TONE: Record<string, string> = {
  synchronized_onsite: "c-ok",
  approved: "c-ok",
  ready: "c-ok",
  approved_delivering: "c-sync",
  update_pending_ack: "c-warn",
  needs_revision: "c-warn",
  attention: "c-bad",
  missing: "c-bad",
  submitted: "c-info",
  processing: "c-info",
  canceled: "c-mut",
  archived: "c-mut",
};

/**
 * A status pill. (R7's amber "the room PC is not reporting" variant is gone: since D-125
 * the platform doesn't watch room PCs — staff load them by hand and tick each file.)
 */
export function Chip({
  status,
  label,
  hint,
}: {
  status: string;
  label: string;
  /** Hover text for pills outside the talk vocabulary (a version's state, say). */
  hint?: string;
}) {
  // Hover explains the pill (D-065). Only talk statuses have a meaning recorded; other
  // pills (room readiness, event status) share tones but not this vocabulary.
  const meaning = statusMeaning(status);
  return (
    <span
      className={`chip ${TONE[status] ?? "c-mut"}`}
      title={hint ?? (meaning && label === labelOf(status) ? meaning : undefined)}
    >
      {label}
    </span>
  );
}

/**
 * R47 (D-110): a talk status's meaning and next step as a visible line beside the chip —
 * hover alone is lost on touch screens and in print. Renders nothing for codes outside
 * the talk vocabulary.
 */
export function StatusMeaning({ status }: { status: string }) {
  const words = TALK_STATUS[status];
  if (!words) return null;
  return (
    <div className="note">
      {words.meaning}
      {words.next ? ` ${words.next}` : ""}
    </div>
  );
}

/** A finding's severity in words ("Must fix" / "Warning" / "Note"), never the raw code. */
export function SeverityChip({ severity, count }: { severity: string; count?: number }) {
  const tone = severity === "blocking" ? "c-bad" : severity === "warning" ? "c-warn" : "c-info";
  const words = wordsFor(SEVERITY, severity);
  return (
    <span className={`chip ${tone}`} title={words.meaning || undefined}>
      {count !== undefined && count > 1 ? `${words.label} · ${count}` : words.label}
    </span>
  );
}
