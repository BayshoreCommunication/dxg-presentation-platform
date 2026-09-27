"use client";

import { useState } from "react";
import { Kpi } from "@/components/Kpi";

import { useRouter } from "next/navigation";
import type { CommsView as CommsData } from "@/lib/api";
import { sendBatch, updateTemplate, ApiError } from "@/lib/api";
import { Chip } from "@/components/Chip";

/** Kravio puts a glyph on every tile; these say what each delivery counter is. */
const COUNTER_ICON = {
  queued: "clock",
  delivered: "mail",
  opened: "checkCircle",
  clicked: "cursor",
  bounced: "warning",
} as const;

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
  const [editing, setEditing] = useState<{ subject: string; body: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!template || !editing) return;
    setSaving(true);
    setError(null);
    try {
      await updateTemplate(eventId, template.id, editing.subject, editing.body);
      setEditing(null);
      setToast(`Saved “${template.name}” — the next batch uses it`);
      setTimeout(() => setToast(null), 5000);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The template could not be saved.");
    } finally {
      setSaving(false);
    }
  }

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
          <Kpi
            key={key}
            label={key[0].toUpperCase() + key.slice(1)}
            icon={COUNTER_ICON[key]}
            value={data.stats[key]}
            caption={key === "bounced" && data.stats.bounced > 0 ? "could not be delivered" : undefined}
            tone={key === "bounced" && data.stats.bounced > 0 ? "bad" : undefined}
          />
        ))}
      </div>

      <div className="card">
        <div className="chd">
          <h3>Template</h3>
          <select
            value={selected}
            disabled={editing !== null}
            onChange={(event) => setSelected(event.target.value)}
          >
            {data.templates.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </div>
        <div className="cbd">
          {template && editing && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <div className="field">
                <label htmlFor="tpl-subject">Subject</label>
                <input
                  id="tpl-subject"
                  value={editing.subject}
                  maxLength={200}
                  onChange={(event) => setEditing({ ...editing, subject: event.target.value })}
                  style={{ width: "100%" }}
                />
              </div>
              <div className="field">
                <label htmlFor="tpl-body">Message</label>
                <textarea
                  id="tpl-body"
                  rows={14}
                  value={editing.body}
                  onChange={(event) => setEditing({ ...editing, body: event.target.value })}
                  style={{ width: "100%", fontFamily: "inherit" }}
                />
              </div>
              <div className="note" style={{ marginBottom: 12 }}>
                Merge fields, filled in for each speaker when the batch is sent:{" "}
                {data.merge_fields.map((field) => (
                  <code key={field} className="kbd" style={{ marginRight: 4 }}>{`{{${field}}}`}</code>
                ))}
                . Keep <code className="kbd">{"{{upload_link}}"}</code> — it is each speaker&apos;s personal link.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn pri" disabled={saving || !editing.subject.trim() || !editing.body.trim()}>
                  {saving ? "Saving…" : "Save template"}
                </button>
                <button type="button" className="btn" disabled={saving} onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
            </form>
          )}
          {template && !editing && (
            <>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setEditing({ subject: template.subject, body: template.body })}
                >
                  Edit template
                </button>
              </div>
              <div className="darkpane" style={{ padding: "14px 18px", marginBottom: 12 }}>
                <b style={{ color: "var(--white)", fontWeight: 500, fontSize: 15 }}>
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

      </div>

      {/* The automatic reminders (D-096) — what the event is actually set to do, not a slogan. */}
      <div className="card">
        <div className="chd">
          <h3>Automatic reminders</h3>
          <span className="m">reminder template · speakers still missing a file · 09:00 event time</span>
        </div>
        <div className="cbd">
          {data.reminders.days.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              {data.reminders.days.map((day) => `${day} day${day === 1 ? "" : "s"}`).join(" · ")} before the deadline
              {data.reminders.deadline ? ` (${formatDay(data.reminders.deadline)})` : ""}
            </div>
          )}
          {data.reminders.on ? (
            <div className="note">
              {data.reminders.next
                ? `Next: ${formatDay(data.reminders.next.date)} — ${data.reminders.next.days_before} day${data.reminders.next.days_before === 1 ? "" : "s"} before.`
                : "All reminders for this deadline have gone."}
            </div>
          ) : (
            <div className="note">{data.reminders.off_reason}</div>
          )}
          {data.reminders.runs.length > 0 && (
            <ul className="note" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {data.reminders.runs.map((run) => (
                <li key={run.days_before}>
                  {run.days_before} day{run.days_before === 1 ? "" : "s"} before ({formatDay(run.due_on)}):{" "}
                  {run.outcome === "sent"
                    ? `sent to ${run.queued} speaker${run.queued === 1 ? "" : "s"}`
                    : run.outcome === "caught_up"
                      ? "missed while the server was down — covered by the next reminder"
                      : "could not send"}
                </li>
              ))}
            </ul>
          )}
          <div className="note" style={{ marginTop: 8 }}>
            Change the days in the event&rsquo;s settings. Bulk remind on Speakers sends one now.
          </div>
        </div>
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

/** `2026-10-20` → "Tue, Oct 20". A calendar day, so no timezone shift. */
function formatDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
