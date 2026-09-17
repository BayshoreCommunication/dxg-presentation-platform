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
  return <span className={`chip ${TONE[status] ?? "c-mut"}`}>{label}</span>;
}

export function SeverityChip({ severity }: { severity: string }) {
  const tone = severity === "blocking" ? "c-bad" : severity === "warning" ? "c-warn" : "c-info";
  return <span className={`chip ${tone}`}>{severity}</span>;
}
