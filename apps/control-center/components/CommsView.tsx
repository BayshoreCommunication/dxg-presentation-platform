"use client";

import { useRef, useState } from "react";
import Link from "next/link";

import { useRouter } from "next/navigation";
import type { CommsView as CommsData } from "@/lib/api";
import { sendBatch, updateTemplate, ApiError } from "@/lib/api";
import { Chip } from "@/components/Chip";
import { WhyNot } from "@/components/WhyNot";
import { EMAIL_STATUS, formatDeadline, formatSessionTime, wordsFor } from "@pmp/format";


const STATUS_TONE: Record<string, string> = {
  queued: "submitted",
  sent: "submitted",
  delivered: "synchronized_onsite",
  opened: "synchronized_onsite",
  clicked: "synchronized_onsite",
  bounced: "attention",
  complained: "attention",
  failed: "attention",
  suppressed: "attention",
  practice: "canceled",
};

/**
 * Each merge field by the name staff know it by (S33, D-112). The template still stores
 * `{{event_name}}` and friends; the buttons insert them and the preview fills them in,
 * so nobody has to read or type the braces. A field missing here falls back to its code
 * with the underscores taken out.
 */
const FIELD_LABEL: Record<string, string> = {
  speaker_first: "Speaker's first name",
  speaker_name: "Speaker's full name",
  event_name: "Event name",
  talk_title: "Presentation title",
  room: "Room",
  session_time: "Session time",
  deadline: "Deadline",
  upload_link: "Upload link",
  presentations: "List of their presentations",
};

const fieldLabel = (field: string) => FIELD_LABEL[field] ?? field.replace(/_/g, " ");

/** Titles skipped when greeting by first name — the same rule the API's `firstName` uses. */
const HONORIFICS = new Set(["dr", "prof", "mr", "mrs", "ms", "mx", "sir", "dame"]);

const firstName = (fullName: string) =>
  fullName
    .trim()
    .split(/\s+/)
    .find((word) => !HONORIFICS.has(word.toLowerCase().replace(/\.$/, ""))) ?? fullName.trim();

const listed = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

type PreviewEvent = { name: string; timezone: string; starts_on: string };

/**
 * The template as one speaker would read it (S33, D-112) — filled in the way the API's
 * `renderTemplate` + `talkFields` fill it at send time. The first speaker on the list is
 * the sample; with none yet, an invented one. The personal link is described, not made up.
 */
function previewValues(
  sample: CommsData["recipients"][number] | undefined,
  event: PreviewEvent,
  deadline: string | null,
): { who: string; values: Record<string, string> } {
  const name = sample?.name ?? "Alex Morgan";
  const talks = sample?.talks.length
    ? sample.talks
    : [{ title: "Sample presentation", room: "Main Hall", starts_at: `${event.starts_on}T14:00:00Z` }];
  const when = (talk: { starts_at: string }) => formatSessionTime(talk.starts_at, event.timezone);
  return {
    who: sample ? name : "a sample speaker",
    values: {
      speaker_first: firstName(name),
      speaker_name: name,
      event_name: event.name,
      talk_title: listed(talks.map((talk) => talk.title)),
      room: listed([...new Set(talks.map((talk) => talk.room ?? "TBC"))]),
      session_time: listed(talks.map(when)),
      presentations: talks.map((talk) => `• ${talk.title} — ${talk.room ?? "Room TBC"}, ${when(talk)}`).join("\n"),
      deadline: deadline ? formatDeadline(deadline, event.timezone) : "the published deadline",
      upload_link: `[${firstName(name)}'s personal upload link]`,
    },
  };
}

const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => values[key.toLowerCase()] ?? match);

/** Screen 9 — templates, batches, and who each batch would actually reach. */
export function CommsView({
  eventId,
  data,
  event,
  practice = false,
}: {
  eventId: string;
  data: CommsData;
  event: PreviewEvent;
  /** A practice event (D-116): nothing is sent, so nothing "will send". */
  practice?: boolean;
}) {
  const router = useRouter();
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Which box an inserted field goes into: the last one typed in, the message by default.
  const lastBox = useRef<"subject" | "body">("body");
  const [selected, setSelected] = useState(data.templates[0]?.id ?? "");
  const [confirmingSend, setConfirmingSend] = useState(false);
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
      setToast(`Saved “${template.name}” — the next email sent uses it`);
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
  const preview = previewValues(audience[0] ?? data.recipients[0], event, data.reminders.deadline);

  /** Puts `{{field}}` where the cursor was in the subject or message (S33, D-112). */
  function insertField(field: string) {
    if (!editing) return;
    const key = lastBox.current;
    const box = key === "subject" ? subjectRef.current : bodyRef.current;
    const text = editing[key];
    const token = `{{${field}}}`;
    const start = box?.selectionStart ?? text.length;
    const end = box?.selectionEnd ?? text.length;
    setEditing({ ...editing, [key]: text.slice(0, start) + token + text.slice(end) });
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function send() {
    if (!template) return;
    setBusy(true);
    setError(null);
    try {
      const result = await sendBatch(eventId, template.id, isReminder);
      const skipped = result.skipped.map((entry) => `${entry.count} ${entry.reason}`).join(" · ");
      setToast(
        result.queued > 0
          ? `Sending to ${result.queued} speaker${result.queued === 1 ? "" : "s"}${skipped ? ` · skipped ${skipped}` : ""}`
          : `Nothing sent — ${skipped || "nobody on the list can be emailed"}`,
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

      {/* No counter tiles (D-126): Opened and Link clicked could never move (open and click
          tracking are off, on purpose — they would reroute each speaker's personal link), and
          the rest repeated the delivery log below, where each email's status is shown. */}
      <div className="card">
        <div className="chd">
          <h3>Template</h3>
          <select
            value={selected}
            disabled={editing !== null}
            title={editing !== null ? "Save or cancel your changes to switch to another template." : undefined}
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
                  ref={subjectRef}
                  onFocus={() => (lastBox.current = "subject")}
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
                  ref={bodyRef}
                  onFocus={() => (lastBox.current = "body")}
                  rows={14}
                  value={editing.body}
                  onChange={(event) => setEditing({ ...editing, body: event.target.value })}
                  style={{ width: "100%", fontFamily: "inherit" }}
                />
              </div>
              {/* S33 (D-112): plain-named buttons insert the fields; the braces are never typed. */}
              <div className="note" style={{ marginBottom: 6 }}>
                Insert a detail — each speaker&rsquo;s own is filled in when the email is sent. Keep the
                Upload link: it is each speaker&rsquo;s personal way to upload.
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {data.merge_fields.map((field) => (
                  <button key={field} type="button" className="btn" onClick={() => insertField(field)}>
                    + {fieldLabel(field)}
                  </button>
                ))}
              </div>
              <EmailPreview
                who={preview.who}
                subject={fill(editing.subject, preview.values)}
                body={fill(editing.body, preview.values)}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn pri" disabled={saving || !editing.subject.trim() || !editing.body.trim()}>
                  {saving ? "Saving…" : "Save template"}
                </button>
                <button type="button" className="btn" disabled={saving} onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
              {/* D-111: one line for both greyed controls — Save template and the template list above. */}
              <WhyNot
                reason={
                  !editing.subject.trim() || !editing.body.trim()
                    ? "Add a subject and a message to save — or Cancel to switch to another template."
                    : "Save or Cancel to switch to another template."
                }
              />
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
              {/* Shown filled in for a sample speaker, not as raw `{{field}}` text (S33, D-112). */}
              <EmailPreview
                who={preview.who}
                subject={fill(template.subject, preview.values)}
                body={fill(template.body, preview.values)}
              />
              <div className="note">
                Each speaker gets their own copy, with their own details and personal upload link.
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
          <span className="m">who this email would reach right now</span>
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
                        ? "already received this email"
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
                        ) : practice ? (
                          <span className="chip c-mut">practice — not sent</span>
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

      <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {/* Asks first (D-108): it used to email everyone on one click. The "Test send"
            button beside it showed a message and sent nothing; it is gone until it is real. */}
        {confirmingSend ? (
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <b>
              Email {sendable.length} speaker{sendable.length === 1 ? "" : "s"} now?
            </b>
            <button
              className="btn pri"
              disabled={busy}
              onClick={() => {
                setConfirmingSend(false);
                void send();
              }}
            >
              Send now
            </button>
            <button className="btn" onClick={() => setConfirmingSend(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button className="btn pri" disabled={busy || sendable.length === 0} onClick={() => setConfirmingSend(true)}>
            Send to {sendable.length} speaker{sendable.length === 1 ? "" : "s"}
          </button>
        )}
      </div>
      {/* D-111: the reason under the button, including an empty audience, which said nothing. */}
      <WhyNot
        reason={
          sendable.length > 0
            ? null
            : audience.length > 0
              ? "Everyone in this list has already been sent this email, or has no working address."
              : isReminder
                ? "Nobody is missing a file — there is nothing to chase."
                : "No speakers yet — add them on Speakers first."
        }
      />
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
            <div className="note">
              {data.reminders.off_reason}
              {/* S34 (D-113): the way out, where the problem is named. */}
              {!data.reminders.deadline && data.reminders.days.length > 0 && (
                <>
                  {" "}
                  <Link href={`/events/${eventId}#event-deadline`}>Set the deadline →</Link>
                </>
              )}
            </div>
          )}
          {data.reminders.runs.length > 0 && (
            <ul className="note" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              {data.reminders.runs.map((run) => (
                <li key={run.days_before}>
                  {run.days_before} day{run.days_before === 1 ? "" : "s"} before ({formatDay(run.due_on)}):{" "}
                  {run.outcome === "sent"
                    ? `sent to ${run.queued} speaker${run.queued === 1 ? "" : "s"}`
                    : run.outcome === "caught_up"
                      ? "skipped because the system was offline that day — the next reminder covers it"
                      : "could not send"}
                </li>
              ))}
            </ul>
          )}
          <div className="note" style={{ marginTop: 8 }}>
            <Link href={`/events/${eventId}#event-deadline`}>Change the deadline or the days</Link> in the
            event&rsquo;s settings. &ldquo;Remind speakers missing files&rdquo; on Speakers sends one now.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>Delivery log</h3>
          <span className="m">per speaker · a bounced email is flagged on the speaker</span>
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
                    {/* S35, D-110: a cut subject says so, and the status reads as words. */}
                    <td className="note" title={row.subject.length > 52 ? row.subject : undefined}>
                      {row.subject.length > 52 ? `${row.subject.slice(0, 51).trimEnd()}…` : row.subject}
                    </td>
                    <td title={wordsFor(EMAIL_STATUS, row.status).meaning || undefined}>
                      <Chip status={STATUS_TONE[row.status] ?? "canceled"} label={wordsFor(EMAIL_STATUS, row.status).label} />
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

/** The email as a speaker reads it: subject over message, in the dark preview pane. */
function EmailPreview({ who, subject, body }: { who: string; subject: string; body: string }) {
  return (
    <>
      <div className="note" style={{ marginBottom: 4 }}>
        Preview — as {who} would receive it
      </div>
      <div className="darkpane" style={{ padding: "14px 18px", marginBottom: 12 }}>
        <b style={{ color: "var(--white)", fontWeight: 500, fontSize: 15 }}>{subject}</b>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            font: "inherit",
            fontSize: 13,
            margin: "8px 0 0",
            color: "var(--paneink)",
          }}
        >
          {body}
        </pre>
      </div>
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
