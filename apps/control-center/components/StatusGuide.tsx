import { InfoTip } from "@/components/InfoTip";
import { STATUS_HELP } from "@/lib/statusHelp";

/** "What do the statuses mean?" — every presentation status, in the order a talk moves through them (D-065). */
export function StatusGuide({ align = "left" }: { align?: "left" | "right" }) {
  return (
    <span className="note" style={{ whiteSpace: "nowrap" }}>
      What do the statuses mean?
      <InfoTip label="each status" align={align} width={340}>
        <span style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
          A presentation moves through these as its file is uploaded, reviewed and sent to its room:
        </span>
        {STATUS_HELP.map((entry) => (
          <span key={entry.status} style={{ display: "block", marginBottom: 4 }}>
            <b>{entry.label}</b> — {entry.meaning}
          </span>
        ))}
      </InfoTip>
    </span>
  );
}
