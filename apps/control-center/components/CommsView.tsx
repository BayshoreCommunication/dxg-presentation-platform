"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CommsView as CommsData } from "@/lib/api";
import { sendBatch, ApiError } from "@/lib/api";
import { Chip } from "@/components/Chip";

const STATUS_TONE: Record<string, string> = {
  queued: "submitted",
  sent: "submitted",
  delivered: "synchronized_onsite",
  opened: "synchronized_onsite",
  clicked: "synchronized_onsite",
  bounced: "attention",
  complained: "attention",
  failed: "attention",
};

/** Screen 9 — templates, batches, and who each batch would actually reach. */
export function CommsView({ eventId, data }: { eventId: string; data: CommsData }) {
  const router = useRouter();
  const [selected, setSelected] = useState(data.templates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const template = data.templates.find((row) => row.id === selected) ?? data.templates[0];
  const isReminder = (template?.name ?? "").toLowerCase().includes("reminder");
  const audience = isReminder ? data.missing : data.recipients;
  const sendable = audience.filter((row) => row.email && !row.bounced && !row.already_sent);

  async function send() {
    if (!template) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sendBatch(eventId, template.id, isReminder);
      const skipped = result.skipped.map((entry) => `${entry.count} ${entry.reason}`).join(" · ");
      setToast(
        result.queued > 0
          ? `Queued ${result.queued}${skipped ? ` · skipped ${skipped}` : ""}`
          : `Nothing queued — ${skipped || "no eligible recipients"}`,
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Send failed.");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 5000);
    }
  }

  return (
    <>
      <h1 className="htitle">Communications</h1>
      {error && <div className="err">{error}</div>}

      <div className="krow">
        {(["queued", "delivered", "opened", "clicked", "bounced"] as const).map((key) => (
          <div className="kpi" key={key}>
            <div className="kl">{key}</div>
            <div
              className="kv num"
              style={key === "bounced" && data.stats.bounced > 0 ? { color: "var(--block)" } : undefined}
            >
              {data.stats[key]}
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="chd">
          <h3>Template</h3>
          <select value={selected} onChange={(event) => setSelected(event.target.value)}>
            {data.templates.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </div>
        <div className="cbd">
          {template && (
            <>
              <div className="darkpane" style={{ padding: "14px 18px", marginBottom: 12 }}>
                <b style={{ color: "var(--white)", fontFamily: "'Barlow Semi Condensed'", fontSize: 16 }}>
                  {template.subject}
                </b>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    font: "inherit",
                    fontSize: 13,
                    margin: "8px 0 0",
                    color: "var(--paneink)",
                  }}
                >
                  {template.body}
                </pre>
              </div>
              <div className="note">
                Merge fields are resolved per recipient at send time. Each recipient gets their own
                secure link — a batch never contains a shared URL.
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>
            Audience · {audience.length}
            {isReminder ? " (missing files only)" : ""}
          </h3>
          <span className="m">resolved now, not when the batch was scheduled</span>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          {audience.length === 0 ? (
            <div className="empty">
              {isReminder ? "Nobody is missing a file — there is nothing to chase." : "No speakers yet."}
            </div>
          ) : (
            <table>
              <tbody>
                {audience.map((row) => {
                  const reason = !row.email
                    ? "no email address"
                    : row.bounced
                      ? "previous email bounced"
                      : row.already_sent
                        ? "already received this batch"
                        : null;
                  return (
                    <tr key={row.speaker_id}>
                      <td>
                        <b>{row.name}</b>
                        <br />
                        <span className="note mono">{row.email ?? "no email"}</span>
                      </td>
                      <td className="note">{row.talk_title}</td>
                      <td style={{ textAlign: "right" }}>
                        {reason ? (
                          <span className="chip c-mut">{reason}</span>
                        ) : (
                          <span className="chip c-ok">will send</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <button className="btn pri" disabled={busy || sendable.length === 0} onClick={() => void send()}>
          Send batch ({sendable.length})
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() => setToast("Test send goes to you only and is excluded from the counters")}
        >
          Test send
        </button>
        <span className="note" style={{ alignSelf: "center" }}>
          Automated reminders: T-14 · T-7 · T-2 before the deadline, missing-file only.
        </span>
      </div>

      <div className="card">
        <div className="chd">
          <h3>Delivery log</h3>
          <span className="m">per speaker · bounces flag the speaker record</span>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          {data.log.length === 0 ? (
            <div className="empty">Nothing sent yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Speaker</th>
                  <th>Address</th>
                  <th>Subject</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.log.map((row) => (
                  <tr key={row.id}>
                    <td>{row.speaker ?? "—"}</td>
                    <td className="mono note">{row.to_address}</td>
                    <td className="note">{row.subject.slice(0, 52)}</td>
                    <td>
                      <Chip status={STATUS_TONE[row.status] ?? "canceled"} label={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </>
  );
}
