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
  agent_offline: "c-bad",
  missing: "c-bad",
  submitted: "c-info",
  processing: "c-info",
  canceled: "c-mut",
  archived: "c-mut",
};

export function Chip({ status, label }: { status: string; label: string }) {
  // Hover explains the pill (D-065). Only talk statuses have a meaning recorded; other
  // pills (room readiness, event status) share tones but not this vocabulary.
  const meaning = statusMeaning(status);
  return (
    <span className={`chip ${TONE[status] ?? "c-mut"}`} title={meaning && label === labelOf(status) ? meaning : undefined}>
      {label}
    </span>
  );
}

export function SeverityChip({ severity }: { severity: string }) {
  const tone = severity === "blocking" ? "c-bad" : severity === "warning" ? "c-warn" : "c-info";
  return <span className={`chip ${tone}`}>{severity}</span>;
}
