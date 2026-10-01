"use client";

import { useRef, useState } from "react";
import Link from "next/link";

import { useRouter } from "next/navigation";
import type { BrandAsset, CommsView as CommsData } from "@/lib/api";
import { assetUrl, createTemplate, saveEmailSettings, sendBatch, sendTestEmail, updateTemplate, uploadEmailImage, ApiError } from "@/lib/api";
import { BrandAssetField } from "@/components/BrandAssetField";
import { RichEditor } from "@/components/RichEditor";
import { FloatingMenu, useFloatingMenu } from "@/components/FloatingMenu";
import type { RichEditorHandle } from "@/components/RichEditor";
import { Chip } from "@/components/Chip";
import { WhyNot } from "@/components/WhyNot";
import { EMAIL_STATUS, formatDateRange, formatDeadline, formatSessionTime, wordsFor } from "@pmp/format";


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
  speaker_last: "Speaker's last name",
  speaker_name: "Speaker's full name",
  event_name: "Event name",
  event_venue: "Venue",
  event_dates: "Event dates",
  talk_title: "Session title",
  room: "Room",
  session_date: "Session date",
  session_start: "Session start time",
  session_end: "Session end time",
  session_time: "Session day and time",
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

type PreviewEvent = { name: string; timezone: string; starts_on: string; ends_on: string; venue: string | null };

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
  const talks: { title: string; room: string | null; starts_at: string; ends_at?: string }[] = sample?.talks.length
    ? sample.talks
    : [{ title: "Sample presentation", room: "Main Hall", starts_at: `${event.starts_on}T14:00:00Z` }];
  const when = (talk: { starts_at: string }) => formatSessionTime(talk.starts_at, event.timezone);
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: event.timezone });
  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: event.timezone, timeZoneName: "short" });
  const words = name.trim().split(/\s+/);
  return {
    who: sample ? name : "a sample speaker",
    values: {
      speaker_first: firstName(name),
      speaker_last: words.length > 1 ? words.at(-1)! : "",
      speaker_name: name,
      event_name: event.name,
      event_venue: event.venue ?? "the venue",
      event_dates: formatDateRange(event.starts_on, event.ends_on),
      session_date: listed([...new Set(talks.map((talk) => day(talk.starts_at)))]),
      session_start: listed(talks.map((talk) => clock(talk.starts_at))),
      session_end: listed(talks.map((talk) => (talk.ends_at ? clock(talk.ends_at) : "TBC"))),
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

/** The longest message, as the server counts it (D-139, Preseria's n / 10000). */
const MESSAGE_MAX = 10_000;

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

/** A plain-text template opened in the editor: one paragraph per line, as the editor writes. */
const textToHtml = (text: string) =>
  text
    .split("\n")
    .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : "<p><br></p>"))
    .join("");

/** `fill` for a formatted message: values are text, never markup, line breaks kept. */
const fillHtml = (html: string, values: Record<string, string>) =>
  html
    // An empty line is an empty paragraph, which would collapse — as the server does on save.
    .replace(/<p([^>]*)><\/p>/g, "<p$1><br></p>")
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
      const value = values[key.toLowerCase()];
      return value === undefined ? match : escapeHtml(value).replace(/\n/g, "<br>");
    });

/** Screen 9 — templates, batches, and who each batch would actually reach. */
export function CommsView({
  eventId,
  data,
  event,
  banner = null,
  practice = false,
}: {
  eventId: string;
  data: CommsData;
  event: PreviewEvent;
  /** The event's email banner (D-138), if one was uploaded. */
  banner?: BrandAsset | null;
  /** A practice event (D-116): nothing is sent, so nothing "will send". */
  practice?: boolean;
}) {
  const router = useRouter();
  const subjectRef = useRef<HTMLInputElement>(null);
  // Which box an inserted field goes into: the last one typed in, the message by default.
  const lastBox = useRef<"subject" | "body">("body");
  const [selected, setSelected] = useState(data.templates[0]?.id ?? "");
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // `body` is the message as text (what is counted and checked); `html` the formatted one (D-139).
  const [editing, setEditing] = useState<{ subject: string; body: string; html: string } | null>(null);
  const editorRef = useRef<RichEditorHandle>(null);
  const [saving, setSaving] = useState(false);
  // How the emails look (D-138).
  const [bannerAsset, setBannerAsset] = useState<BrandAsset | null>(banner);
  const savedLook = { sender_name: data.email?.sender_name ?? "", reply_to: data.email?.reply_to ?? "" };
  const [look, setLook] = useState(savedLook);
  const [lookBusy, setLookBusy] = useState(false);
  const lookDirty = look.sender_name !== savedLook.sender_name || look.reply_to !== savedLook.reply_to;
  const [testTo, setTestTo] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [newName, setNewName] = useState<string | null>(null);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 5000);
  }

  async function saveLook() {
    setLookBusy(true);
    setError(null);
    try {
      const saved = await saveEmailSettings(eventId, look);
      setLook({ sender_name: saved.sender_name ?? "", reply_to: saved.reply_to ?? "" });
      flash("Saved — the next email sent uses it");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The email settings could not be saved.");
    } finally {
      setLookBusy(false);
    }
  }

  async function sendTest(subject: string, body: string, html?: string | null) {
    setTestBusy(true);
    setError(null);
    try {
      const sent = await sendTestEmail(eventId, { to: testTo, subject, body, ...(html ? { body_html: html } : {}) });
      flash(`Test email on its way to ${sent.to}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The test email could not be sent.");
    } finally {
      setTestBusy(false);
    }
  }

  async function saveAsNew() {
    if (!editing || newName === null) return;
    setSaving(true);
    setError(null);
    try {
      const created = await createTemplate(eventId, { name: newName, subject: editing.subject, body: editing.body, body_html: editing.html });
      setEditing(null);
      setNewName(null);
      setSelected(created.id);
      flash(`Saved as a new template, “${created.name}”`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The new template could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (!template || !editing) return;
    setSaving(true);
    setError(null);
    try {
      await updateTemplate(eventId, template.id, editing.subject, editing.body, editing.html);
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
    if (key === "body") {
      editorRef.current?.insertText(`{{${field}}}`);
      return;
    }
    const box = subjectRef.current;
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
      {/* D-138, after Preseria's "Customize Email Template": banner, sender, reply-to — one compact row. */}
      <div className="card">
        <div className="chd">
          <h3>How your emails look</h3>
          <span className="m">The same for every email to speakers</span>
        </div>
        <div className="cbd look-grid">
          <div className="look-banner">
            <div className="kl">Email banner</div>
            <BrandAssetField eventId={eventId} kind="email_banner" initial={bannerAsset} onChange={setBannerAsset} />
            {!bannerAsset && <div className="note">Without a banner, the event name heads the email.</div>}
          </div>
          <form
            className="look-fields"
            onSubmit={(submitted) => {
              submitted.preventDefault();
              void saveLook();
            }}
          >
            <div className="field">
              <label htmlFor="mail-sender">Sender name</label>
              <input
                id="mail-sender"
                value={look.sender_name}
                maxLength={70}
                placeholder={`e.g. ${event.name} organisers`}
                onChange={(changed) => setLook({ ...look, sender_name: changed.target.value })}
              />
              <div className="note">Shown as who the email is from.</div>
            </div>
            <div className="field">
              <label htmlFor="mail-reply">Reply-to address</label>
              <input
                id="mail-reply"
                type="email"
                value={look.reply_to}
                placeholder="Where speakers' replies go"
                onChange={(changed) => setLook({ ...look, reply_to: changed.target.value })}
              />
              <div className="note">Leave empty to use DXG&rsquo;s usual address.</div>
            </div>
            <div className="look-actions">
              <button className="btn pri" disabled={lookBusy || !lookDirty}>
                {lookBusy ? "Saving…" : "Save"}
              </button>
              {lookDirty && (
                <button type="button" className="btn" disabled={lookBusy} onClick={() => setLook(savedLook)}>
                  Cancel
                </button>
              )}
              <WhyNot reason={!lookDirty && !lookBusy ? "Change the sender name or reply-to address to save." : null} />
            </div>
          </form>
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>Email templates</h3>
          <div className="tpl-head">
            <select
              aria-label="Template"
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
            {template && !editing && (
              <button
                type="button"
                className="btn pri"
                onClick={() =>
                  setEditing({
                    subject: template.subject,
                    body: template.body,
                    html: template.body_html ?? textToHtml(template.body),
                  })
                }
              >
                Edit template
              </button>
            )}
          </div>
        </div>
        <div className="cbd">
          {template && editing && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              {/* Editor on the left, the email as a speaker gets it on the right (stacks when narrow). */}
              <div className="tpl-grid">
                <div className="tpl-main">
                  <div className="field">
                    <label htmlFor="tpl-subject">Subject</label>
                    <input
                      id="tpl-subject"
                      ref={subjectRef}
                      onFocus={() => (lastBox.current = "subject")}
                      value={editing.subject}
                      maxLength={200}
                      onChange={(event) => setEditing({ ...editing, subject: event.target.value })}
                    />
                  </div>
                  <div className="field" onFocus={() => (lastBox.current = "body")}>
                    <div className="tpl-msg-head">
                      <label>Message</label>
                      <InsertMenu fields={data.merge_fields} onPick={insertField} />
                    </div>
                    {/* D-139: formatted, like Preseria's editor — the server cleans what it writes. */}
                    <RichEditor
                      key={template.id}
                      ref={editorRef}
                      label="Message"
                      initialHtml={editing.html}
                      maxChars={MESSAGE_MAX}
                      onChange={(html, text) => setEditing((current) => (current ? { ...current, html, body: text } : current))}
                      onImage={(file) => uploadEmailImage(eventId, file)}
                    />
                    <div className="note" style={{ marginTop: 6 }}>
                      Details in {"{{braces}}"} are filled in for each speaker when the email is sent. Keep the Upload
                      link — it is each speaker&rsquo;s personal way to upload.
                    </div>
                  </div>
                </div>
                <div className="tpl-side">
                  <EmailPreview
                    who={preview.who}
                    subject={fill(editing.subject, preview.values)}
                    body={fill(editing.body, preview.values)}
                    html={fillHtml(editing.html, preview.values)}
                    from={look.sender_name}
                    banner={bannerAsset ? assetUrl(eventId, "email_banner", bannerAsset.uploaded_at) : null}
                    eventName={event.name}
                  />
                </div>
              </div>

              <div className="tpl-bar">
                <div className="tpl-bar-actions">
                  <button
                    className="btn pri"
                    disabled={saving || !editing.subject.trim() || !editing.body.trim() || editing.body.length > MESSAGE_MAX}
                  >
                    {saving ? "Saving…" : "Save template"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={saving || !editing.subject.trim() || !editing.body.trim()}
                    onClick={() => setNewName(newName === null ? "" : null)}
                  >
                    Save as new template…
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={saving}
                    onClick={() => {
                      setEditing(null);
                      setNewName(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
                <TestSend
                  to={testTo}
                  setTo={setTestTo}
                  busy={testBusy}
                  practice={practice}
                  onSend={() => void sendTest(editing.subject, editing.body, editing.html)}
                />
              </div>
              {newName !== null && (
                <div className="tpl-new">
                  <div className="field" style={{ margin: 0, flex: "1 1 240px" }}>
                    <label htmlFor="tpl-new-name">Name of the new template</label>
                    <input
                      id="tpl-new-name"
                      autoFocus
                      value={newName}
                      maxLength={80}
                      placeholder="e.g. Second reminder"
                      onChange={(changed) => setNewName(changed.target.value)}
                    />
                  </div>
                  <button type="button" className="btn pri" disabled={saving || !newName.trim()} onClick={() => void saveAsNew()}>
                    Save new template
                  </button>
                </div>
              )}
              {/* D-111: one line for the greyed controls — Save and the template list above. */}
              <WhyNot
                reason={
                  editing.body.length > MESSAGE_MAX
                    ? `The message is over ${MESSAGE_MAX.toLocaleString("en-US")} characters — shorten it to save.`
                    : !editing.subject.trim() || !editing.body.trim()
                      ? "Add a subject and a message to save — or Cancel to switch to another template."
                      : "Save or Cancel to switch to another template."
                }
              />
            </form>
          )}
          {template && !editing && (
            <div className="tpl-grid view">
              <div className="tpl-main">
                {/* Shown filled in for a sample speaker, not as raw `{{field}}` text (S33, D-112). */}
                <EmailPreview
                  who={preview.who}
                  subject={fill(template.subject, preview.values)}
                  body={fill(template.body, preview.values)}
                  html={template.body_html ? fillHtml(template.body_html, preview.values) : null}
                  from={look.sender_name}
                  banner={bannerAsset ? assetUrl(eventId, "email_banner", bannerAsset.uploaded_at) : null}
                  eventName={event.name}
                />
              </div>
              <div className="tpl-side tpl-facts">
                <div>
                  <div className="kl">Goes to</div>
                  <div>{isReminder ? "Speakers still missing a file" : "Speakers not yet invited"}</div>
                </div>
                <div>
                  <div className="kl">Each speaker gets</div>
                  <div className="note">Their own copy, with their own details and personal upload link.</div>
                </div>
                <TestSend
                  to={testTo}
                  setTo={setTestTo}
                  busy={testBusy}
                  practice={practice}
                  onSend={() => void sendTest(template.subject, template.body, template.body_html)}
                />
              </div>
            </div>
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
/**
 * The email as a speaker sees it (D-138): who it is from, the subject, then the banner (or
 * the event name), the upload button and the message — the layout `renderEmailHtml` sends.
 */
function EmailPreview({
  who,
  subject,
  body,
  html = null,
  from,
  banner,
  eventName,
}: {
  who: string;
  subject: string;
  body: string;
  /** The formatted message (D-139), filled in; shown instead of `body` when there is one. */
  html?: string | null;
  from: string;
  banner: string | null;
  eventName: string;
}) {
  return (
    <>
      <div className="note" style={{ marginBottom: 4 }}>
        Preview — as {who} would receive it
      </div>
      <div className="mail-preview">
        <div className="mail-meta">
          <span>
            <b>From</b> {from.trim() || "DXG (the usual sender name)"}
          </span>
          <span>
            <b>Subject</b> {subject}
          </span>
        </div>
        <div className="mail-sheet">
          {banner ? (
            <img src={banner} alt={eventName} className="mail-banner" />
          ) : (
            <div className="mail-head">{eventName}</div>
          )}
          <div className="mail-cta">
            <span>Upload your presentation</span>
          </div>
          {html ? (
            // The staff member's own editor output, or a template the server already cleaned (D-139).
            <div className="mail-body formatted" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <pre className="mail-body">{body}</pre>
          )}
          <div className="mail-foot">{eventName}</div>
        </div>
      </div>
    </>
  );
}

/** The details a template can use, grouped as staff think of them (D-139 polish). */
const FIELD_GROUPS: { title: string; fields: string[] }[] = [
  { title: "Speaker", fields: ["speaker_first", "speaker_last", "speaker_name"] },
  { title: "Event", fields: ["event_name", "event_venue", "event_dates", "deadline"] },
  {
    title: "Session",
    fields: ["talk_title", "room", "session_date", "session_start", "session_end", "session_time", "presentations"],
  },
  { title: "Link", fields: ["upload_link"] },
];

/** One "Insert detail" menu instead of fifteen buttons; the detail goes where the cursor is. */
function InsertMenu({ fields, onPick }: { fields: string[]; onPick: (field: string) => void }) {
  const { open, setOpen, trigger, menu } = useFloatingMenu();
  const known = new Set(FIELD_GROUPS.flatMap((group) => group.fields));
  const groups = [
    ...FIELD_GROUPS.map((group) => ({ ...group, fields: group.fields.filter((field) => fields.includes(field)) })),
    { title: "Other", fields: fields.filter((field) => !known.has(field)) },
  ].filter((group) => group.fields.length > 0);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="btn"
        aria-haspopup="menu"
        aria-expanded={open}
        // Keep the editor's cursor: a mousedown here would otherwise take the focus first.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((value) => !value)}
      >
        + Insert detail ▾
      </button>
      <FloatingMenu open={open} trigger={trigger} menu={menu} width={260}>
        {groups.map((group) => (
          <div key={group.title}>
            <div className="label">{group.title}</div>
            {group.fields.map((field) => (
              <button
                key={field}
                type="button"
                className="item"
                role="menuitem"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  onPick(field);
                }}
              >
                {fieldLabel(field)}
              </button>
            ))}
          </div>
        ))}
      </FloatingMenu>
    </>
  );
}

/** Preseria's "Send a test email" (D-138): this email, as it stands on screen, to one address. */
function TestSend({
  to,
  setTo,
  busy,
  practice,
  onSend,
}: {
  to: string;
  setTo: (value: string) => void;
  busy: boolean;
  practice: boolean;
  onSend: () => void;
}) {
  return (
    <div className="test-send">
      <label htmlFor="mail-test-to" className="kl">
        Send a test email
      </label>
      <div className="test-send-row">
        <input
          id="mail-test-to"
          type="email"
          value={to}
          placeholder="your.address@example.com"
          disabled={practice}
          onChange={(changed) => setTo(changed.target.value)}
          onKeyDown={(key) => {
            if (key.key === "Enter") {
              key.preventDefault();
              if (to.trim() && !busy && !practice) onSend();
            }
          }}
        />
        <button type="button" className="btn" disabled={busy || practice || !to.trim()} onClick={onSend}>
          {busy ? "Sending…" : "Send test"}
        </button>
      </div>
      <WhyNot
        reason={
          practice
            ? "Practice events never send email — the preview is exactly what it would look like."
            : !to.trim()
              ? "A copy to you, with the banner and button, filled in for the first speaker."
              : null
        }
      />
    </div>
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
