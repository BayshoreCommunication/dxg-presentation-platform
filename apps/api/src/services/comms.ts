import type pg from "pg";
import { appendAudit } from "@pmp/db";
import { deriveTalkStatus } from "@pmp/domain";
import type { Actor, DomainError, Result } from "@pmp/domain";
import { atLeast, err, hasAnyRole, ok } from "@pmp/domain";
import { formatDateRange, formatDeadline, formatSessionTime } from "@pmp/format";
import { firstName } from "./firstName.ts";
import { lookFor } from "./emailLook.ts";
import { ensureSpeakerSignIn } from "./auth.ts";
import { checkAddress, fillHtml, htmlToText, MESSAGE_MAX_CHARS, sanitizeEmailHtml } from "@pmp/email";

/**
 * Where speakers sign in (D-147, D-148): the speaker site's sign-in page — its own origin,
 * apart from the staff site. Every invitation and reminder points here; there is no
 * per-speaker link any more, because the speaker's credential is their password, not a
 * token in a URL.
 */
const PORTAL_BASE = process.env.PORTAL_BASE ?? "http://localhost:3001";
export const SIGN_IN_URL = `${PORTAL_BASE}/login`;
export const SIGN_IN_BUTTON = "Sign in to manage your presentations";
const PASSWORD_REDACTED = "[temporary password removed from the stored copy]";

/**
 * The `{{sign_in}}` block (D-147), worded for what the speaker has: a temporary password
 * when one was just issued, otherwise their own.
 */
export function signInBlock(temporaryPassword: string | null): string {
  if (temporaryPassword) {
    return [
      `Sign in at ${SIGN_IN_URL} with this email address and your temporary password:`,
      "",
      `    ${temporaryPassword}`,
      "",
      "You'll be asked to choose your own password straight away.",
    ].join("\n");
  }
  return [
    `Sign in at ${SIGN_IN_URL} with this email address and your password.`,
    "Forgotten it? Use \"Forgotten your password?\" on the sign-in page.",
  ].join("\n");
}

export type TemplateRow = {
  id: string;
  name: string;
  subject: string;
  /** The plain-text message — or, for a formatted one, its plain-text twin. */
  body: string;
  /** The formatted message (D-139), sanitised; null for a plain-text template. */
  body_html?: string | null;
};

/** Merge fields are resolved at send time, per recipient (FR-COM-001). */
export function renderTemplate(
  template: { subject: string; body: string },
  values: Record<string, string>,
): { subject: string; body: string } {
  const fill = (text: string) =>
    text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_match, key: string) => values[key] ?? `{{${key}}}`);
  return { subject: fill(template.subject), body: fill(template.body) };
}

export const DEFAULT_TEMPLATES = [
  {
    name: "Upload invitation",
    subject: "{{event_name}}: please upload your presentation by {{deadline}}",
    body: [
      "Hi {{speaker_first}},",
      "",
      "You're presenting at {{event_name}}:",
      "",
      "{{presentations}}",
      "",
      "Please upload your presentation by {{deadline}}. Your sign-in details are below — the same sign-in works for every event you speak at.",
      "",
      "{{sign_in}}",
      "",
      "Once signed in, Manage presentations is where you upload, replace a file with a new version, and download your presentation once it's approved — right up to and on the day you present.",
      "",
      "Requirements: 16:9 widescreen, PowerPoint (.pptx) preferred, PDF accepted. Embed all fonts and use H.264 .mp4 for video.",
      "",
      "The DXG presentation team",
    ].join("\n"),
  },
  {
    name: "Reminder — file still missing",
    subject: "Reminder: {{event_name}} presentation due {{deadline}}",
    body: [
      "Hi {{speaker_first}},",
      "",
      "We don't have your presentation yet for:",
      "",
      "{{presentations}}",
      "",
      "The deadline is {{deadline}}.",
      "",
      "{{sign_in}}",
      "",
      "Once signed in, Manage presentations is where you upload your file, and later download it once it's approved — up to and on the day of your presentation.",
      "",
      "If you've already sent it another way, reply to this email and we'll check.",
      "",
      "The DXG presentation team",
    ].join("\n"),
  },
] as const;

/** Every merge field `send` fills in; anything else would reach the speaker as literal braces. */
export const MERGE_FIELDS = [
  "speaker_first",
  "speaker_last",
  "speaker_name",
  "event_name",
  "event_venue",
  "event_dates",
  "talk_title",
  "room",
  "session_date",
  "session_start",
  "session_end",
  "session_time",
  "deadline",
  "upload_link",
  "sign_in",
  "presentations",
] as const;

const TEMPLATE_EDITORS = atLeast("presentation_manager");

/** A template's subject and message, checked the same way wherever one is saved or tried. */
function checkTemplateText(input: {
  subject?: unknown;
  body?: unknown;
  body_html?: unknown;
}): Result<{ subject: string; body: string; body_html: string | null }, DomainError> {
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  // A formatted message (D-139) is cleaned here and its plain-text twin derived from it;
  // every rule below is checked against that text, as a speaker reads it.
  const rawHtml = typeof input.body_html === "string" && input.body_html.trim() ? input.body_html : null;
  if (rawHtml && rawHtml.length > 200_000) {
    return err({ code: "comms.template_invalid", message: "The message is too large — remove some images or formatting." });
  }
  const body_html = rawHtml ? sanitizeEmailHtml(rawHtml) : null;
  const body = body_html
    ? htmlToText(body_html)
    : typeof input.body === "string"
      ? input.body.replace(/\r\n/g, "\n").trim()
      : "";
  if (subject.length < 1 || subject.length > 200) {
    return err({ code: "comms.template_invalid", message: "The subject needs 1–200 characters." });
  }
  if (body.length < 1 || body.length > MESSAGE_MAX_CHARS) {
    return err({ code: "comms.template_invalid", message: `The message needs 1–${MESSAGE_MAX_CHARS.toLocaleString("en-US")} characters.` });
  }
  const used = [...`${subject}\n${body}`.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map((match) => match[1]!.toLowerCase());
  const unknown = [...new Set(used.filter((field) => !(MERGE_FIELDS as readonly string[]).includes(field)))];
  if (unknown.length > 0) {
    return err({
      code: "comms.template_invalid",
      // Plain words (D-112): staff add details with the Insert buttons, not by typing braces.
      message: `${unknown.map((field) => `{{${field}}}`).join(", ")} ${unknown.length === 1 ? "isn't a detail" : "aren't details"} we can fill in. Remove ${unknown.length === 1 ? "it" : "them"} and use the Insert buttons instead.`,
    });
  }
  // The way in is the point of every one of these emails: without it the speaker can do nothing.
  if (!used.includes("sign_in") && !used.includes("upload_link")) {
    return err({
      code: "comms.template_invalid",
      message: "Keep the Sign-in details (or at least the Sign-in link) in the message — it is how each speaker reaches their presentations. Add it back with the Insert buttons.",
    });
  }
  return ok({ subject, body, body_html });
}

/**
 * An event's email template, edited (D-080). The wording was only ever the seeded default:
 * it lived in the database per event, but nothing could change it.
 *
 * Mail already sent keeps the text it was sent with (`communications` stores the rendered
 * copy), so an edit changes the next batch and never rewrites history.
 */
export async function updateTemplate(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  templateId: string,
  input: { subject?: unknown; body?: unknown; body_html?: unknown },
): Promise<Result<TemplateRow, DomainError>> {
  if (!hasAnyRole(actor, TEMPLATE_EDITORS)) {
    return err({ code: "comms.forbidden", message: "Only a presentation manager, project manager or DXG administrator can edit email templates." });
  }
  const checked = checkTemplateText(input);
  if (!checked.ok) return checked;
  const { subject, body, body_html } = checked.value;
  const { rows } = await tx.query<TemplateRow & { client_id: string; old_subject: string }>(
    `UPDATE pmp.communication_templates t
        SET subject = $3, body = $4, body_html = $5, updated_at = now(), lock_version = t.lock_version + 1
       FROM pmp.communication_templates prior
      WHERE t.id = prior.id AND t.id = $1 AND t.event_id = $2
      RETURNING t.id, t.name, t.subject, t.body, t.body_html, t.client_id, prior.subject AS old_subject`,
    [templateId, eventId, subject, body, body_html],
  );
  const updated = rows[0];
  if (!updated) return err({ code: "comms.template_not_found", message: "This template no longer exists on this event — it may have been removed. Refresh the page." });
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: updated.client_id,
    actorUserId: actor.id,
    action: "comms.template_updated",
    subjectType: "communication_template",
    subjectId: updated.id,
    detail: { name: updated.name, subject_before: updated.old_subject, subject_after: subject },
  });
  return ok({ id: updated.id, name: updated.name, subject: updated.subject, body: updated.body, body_html: updated.body_html ?? null });
}

/**
 * A new template for this event, from the one being edited (D-138, Preseria's "save as new
 * template"): an invitation and a reminder are rarely enough — a second-round reminder or a
 * speaker-ready-room notice is another template, not an edit of the first.
 */
export async function createTemplate(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  input: { name?: unknown; subject?: unknown; body?: unknown; body_html?: unknown },
): Promise<Result<TemplateRow, DomainError>> {
  if (!hasAnyRole(actor, TEMPLATE_EDITORS)) {
    return err({ code: "comms.forbidden", message: "Only a presentation manager, project manager or DXG administrator can add email templates." });
  }
  const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim() : "";
  if (name.length < 1 || name.length > 80) {
    return err({ code: "comms.template_invalid", message: "Give the new template a name of 1–80 characters." });
  }
  const checked = checkTemplateText(input);
  if (!checked.ok) return checked;
  const { rows: clash } = await tx.query(
    `SELECT 1 FROM pmp.communication_templates WHERE event_id = $1 AND lower(name) = lower($2)`,
    [eventId, name],
  );
  if (clash.length > 0) {
    return err({ code: "comms.template_invalid", message: `This event already has a template called “${name}”. Choose another name.` });
  }
  const { rows } = await tx.query<TemplateRow & { client_id: string }>(
    `INSERT INTO pmp.communication_templates (client_id, event_id, name, subject, body, body_html)
     SELECT client_id, id, $2, $3, $4, $5 FROM pmp.events WHERE id = $1
     RETURNING id, name, subject, body, body_html, client_id`,
    [eventId, name, checked.value.subject, checked.value.body, checked.value.body_html],
  );
  const created = rows[0];
  if (!created) return err({ code: "comms.event_not_found", message: "This event no longer exists — it may have been removed. Refresh the page." });
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: created.client_id,
    actorUserId: actor.id,
    action: "comms.template_created",
    subjectType: "communication_template",
    subjectId: created.id,
    detail: { name },
  });
  return ok({ id: created.id, name: created.name, subject: created.subject, body: created.body, body_html: created.body_html ?? null });
}

/**
 * One copy of the email, to an address staff choose (D-138, Preseria's "Send a test email"):
 * the banner, button and wording exactly as a speaker gets them, filled in for the first
 * speaker on the list. Its button and link open the speaker sign-in page — a test never
 * carries anyone's personal link. Nothing is logged against a speaker; the audit records it.
 */
export async function sendTestEmail(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  input: { to?: unknown; subject?: unknown; body?: unknown; body_html?: unknown },
): Promise<Result<{ to: string }, DomainError>> {
  if (!hasAnyRole(actor, TEMPLATE_EDITORS)) {
    return err({ code: "comms.forbidden", message: "Only a presentation manager, project manager or DXG administrator can send a test email." });
  }
  const typed = typeof input.to === "string" ? input.to.trim() : "";
  const address = checkAddress(typed);
  if (!address.ok) {
    return err({
      code: "comms.test_invalid",
      message: typed ? `${address.reason}${address.suggestion ? ` Did you mean ${address.suggestion}?` : ""}` : "Enter the address to send the test to.",
    });
  }
  const checked = checkTemplateText(input);
  if (!checked.ok) return checked;

  const { rows: eventRows } = await tx.query<EventFacts & { is_practice: boolean }>(
    `SELECT e.client_id, e.name, (e.settings ->> 'upload_deadline') AS deadline, e.timezone, e.is_practice,
            v.name AS venue, e.starts_on::text AS starts_on, e.ends_on::text AS ends_on
       FROM pmp.events e LEFT JOIN pmp.venues v ON v.id = e.venue_id WHERE e.id = $1`,
    [eventId],
  );
  const event = eventRows[0];
  if (!event) return err({ code: "comms.event_not_found", message: "This event no longer exists — it may have been removed. Refresh the page." });
  // A practice event sends nothing at all (D-116) — not even a test.
  if (event.is_practice) {
    return err({ code: "comms.practice", message: "Practice events never send email. The preview shows exactly what it would look like." });
  }

  const templates = await ensureTemplates(tx, eventId);
  const sample = templates[0] ? (await recipientsFor(tx, eventId, templates[0].id, false))[0] : undefined;
  const talks = sample?.talks.length
    ? sample.talks
    : [{ title: "Sample presentation", room: "Main Hall", starts_at: `${event.starts_on}T14:00:00Z` }];
  const values = {
    ...personFields(sample?.name ?? "Alex Morgan"),
    ...eventFields(event),
    ...talkFields(talks, event.timezone),
    deadline: event.deadline ? formatDeadline(event.deadline, event.timezone) : "the published deadline",
    upload_link: SIGN_IN_URL,
    // A test carries a sample password, never a real one.
    sign_in: signInBlock("XXXX-XXXX-XXXX-XXXX"),
  };
  const rendered = renderTemplate({ subject: checked.value.subject, body: checked.value.body }, values);
  await tx.query(`INSERT INTO pmp.outbox (topic, payload) VALUES ('email.send', $1)`, [
    JSON.stringify({
      to: address.address,
      subject: `[Test] ${rendered.subject}`,
      body: rendered.body,
      ...(checked.value.body_html ? { html_body: fillHtml(checked.value.body_html, values) } : {}),
      look: await lookFor(tx, eventId, { label: SIGN_IN_BUTTON, url: SIGN_IN_URL }),
    }),
  ]);
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: event.client_id,
    actorUserId: actor.id,
    action: "comms.test_sent",
    subjectType: "event",
    subjectId: eventId,
    detail: { to: address.address, subject: rendered.subject },
  });
  return ok({ to: address.address });
}

export async function ensureTemplates(tx: pg.PoolClient, eventId: string): Promise<TemplateRow[]> {
  const { rows: existing } = await tx.query<TemplateRow>(
    // Insertion order, so the invitation leads and reminders follow it.
    `SELECT id, name, subject, body, body_html FROM pmp.communication_templates
      WHERE event_id = $1 ORDER BY created_at, name`,
    [eventId],
  );
  if (existing.length > 0) return existing;

  const { rows: eventRows } = await tx.query<{ client_id: string }>(
    `SELECT client_id FROM pmp.events WHERE id = $1`,
    [eventId],
  );
  if (!eventRows[0]) return [];

  // Seeded in one transaction, so created_at would be identical for all of them;
  // the offset keeps the listed order stable and puts the invitation first.
  for (const [index, template] of DEFAULT_TEMPLATES.entries()) {
    await tx.query(
      `INSERT INTO pmp.communication_templates (client_id, event_id, name, subject, body, created_at)
       VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' milliseconds')::interval)`,
      [eventRows[0].client_id, eventId, template.name, template.subject, template.body, index],
    );
  }
  const { rows } = await tx.query<TemplateRow>(
    // Insertion order, so the invitation leads and reminders follow it.
    `SELECT id, name, subject, body, body_html FROM pmp.communication_templates
      WHERE event_id = $1 ORDER BY created_at, name`,
    [eventId],
  );
  return rows;
}

/** One presentation a speaker is emailed about. */
export type RecipientTalk = { title: string; room: string | null; starts_at: string; ends_at?: string; status: string };

/**
 * One row per *speaker*, not per presentation (D-087). A speaker on two presentations
 * used to be two recipients, so a batch sent them two emails with two different links —
 * the 24-hour guard is read before either is written, so it could not stop the second.
 * `talks` holds every presentation the email is about (for a reminder, only the ones
 * still missing a file); `talk_title`, `room` and `starts_at` describe the first, for
 * screens that show one line.
 */
export type Recipient = {
  speaker_id: string;
  name: string;
  email: string | null;
  talk_title: string;
  room: string | null;
  starts_at: string;
  status: string;
  talks: RecipientTalk[];
  bounced: boolean;
  already_sent: boolean;
};

/**
 * Who a batch would actually reach. Recipients are resolved at send time, not
 * when a batch is scheduled: a reminder must not chase someone who uploaded
 * yesterday (FR-COM-002).
 */
/**
 * How long the same template is withheld from the same speaker (FR-COM-002).
 *
 * This guard used to have no time bound at all: a speaker who had ever received a
 * template was skipped from it forever. Right for an invitation, wrong for the thing
 * the product is supposed to do — the SOW's reminder cadence is T-14, T-7 and T-2, and
 * under "ever" only the first of the three could be sent. It also meant a speaker who
 * lost their link could never be included in a batch again.
 *
 * SCREEN_SPECS §9 states the rule as idempotent by `(batch_id, speaker_id)` — re-running
 * *a batch* must not re-send, while a later batch may reach the same person. There is no
 * `batch_id` column, which is why "the same batch" was approximated as "this template,
 * ever"; a day is the approximation that keeps the useful half. It is long enough that a
 * double-click, a refresh or an impatient second press sends nothing twice, and short
 * enough that every cadence anyone would write — the closest pair in the SOW's is five
 * days apart — goes out as intended.
 */
export const RESEND_COOLDOWN_HOURS = 24;

export async function recipientsFor(
  tx: pg.PoolClient,
  eventId: string,
  templateId: string,
  missingOnly: boolean,
  cooldownHours: number = RESEND_COOLDOWN_HOURS,
  /** Count any email about this event towards the cooldown, not just this template (D-102). */
  cooldownAnyTemplate = false,
  /** The upload invitation goes to a speaker once, ever (D-086) — a batch must not repeat it (D-108). */
  once = false,
): Promise<Recipient[]> {
  const { rows } = await tx.query<{
    speaker_id: string;
    name: string;
    email: string | null;
    talk_title: string;
    room: string | null;
    starts_at: string;
    ends_at: string;
    session_state: string;
    versions: { processing: string; inspection: string; review: string }[] | null;
    bounced: boolean;
    already_sent: boolean;
  }>(
    `SELECT sp.id AS speaker_id, sp.full_name AS name, sp.email::text AS email,
            s.title AS talk_title, r.name AS room, se.starts_at, se.ends_at, se.session_state,
            (SELECT json_agg(json_build_object('processing', fv.processing_state,
                                               'inspection', fv.inspection_state,
                                               'review', fv.review_state) ORDER BY fv.version_number)
               FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
              WHERE f.slot_id = s.id) AS versions,
            -- By speaker *or address* (D-097): an address that bounced or complained on any
            -- event is not mailed again, whichever speaker record now carries it.
            -- By *address* (D-097, D-108): an address that bounced or complained on any event
            -- is not mailed again — but a speaker whose address has since been corrected is.
            EXISTS (SELECT 1 FROM pmp.communications c
                     WHERE lower(c.to_address::text) = lower(sp.email::text)
                       AND c.status IN ('bounced','complained')) AS bounced,
            EXISTS (SELECT 1 FROM pmp.communications c
                     WHERE c.speaker_id = sp.id AND ($4 OR c.template_id = $2)
                       AND c.created_at > now() - make_interval(hours => $3))
            OR ($5 AND EXISTS (SELECT 1 FROM pmp.communications c
                     WHERE c.speaker_id = sp.id AND c.template_id = $2
                       AND c.status NOT IN ('bounced','complained','failed'))) AS already_sent
       FROM pmp.speakers sp
       JOIN pmp.speaker_assignments sa ON sa.speaker_id = sp.id
       JOIN pmp.slots s ON s.id = sa.slot_id
       JOIN pmp.sessions se ON se.id = s.session_id
       LEFT JOIN pmp.rooms r ON r.id = se.room_id
      WHERE sp.event_id = $1 AND sp.merged_into IS NULL AND sp.removed_at IS NULL
      ORDER BY sp.full_name, se.starts_at`,
    [eventId, templateId, cooldownHours, cooldownAnyTemplate, once],
  );

  const perTalk = rows
    .map((row) => ({
      row,
      status: deriveTalkStatus({
        sessionState: row.session_state as never,
        eventArchived: false,
        versions: (row.versions ?? []) as never,
        roomCopies: [],
      }),
    }))
    // A canceled presentation is nothing to upload for, so no email names it.
    .filter(({ status }) => status !== "canceled")
    .filter(({ status }) => (missingOnly ? status === "missing" : true));

  const bySpeaker = new Map<string, Recipient>();
  for (const { row, status } of perTalk) {
    const talk: RecipientTalk = { title: row.talk_title, room: row.room, starts_at: row.starts_at, ends_at: row.ends_at, status };
    const existing = bySpeaker.get(row.speaker_id);
    if (existing) {
      existing.talks.push(talk);
      continue;
    }
    bySpeaker.set(row.speaker_id, {
      speaker_id: row.speaker_id,
      name: row.name,
      email: row.email,
      talk_title: row.talk_title,
      room: row.room,
      starts_at: row.starts_at,
      status,
      talks: [talk],
      bounced: row.bounced,
      already_sent: row.already_sent,
    });
  }
  for (const recipient of bySpeaker.values()) {
    // `starts_at` arrives from pg as a Date, whatever the row type says — compare as time.
    recipient.talks.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    const [first] = recipient.talks;
    recipient.talk_title = recipient.talks.map((talk) => talk.title).join(" · ");
    recipient.room = first!.room;
    recipient.starts_at = first!.starts_at;
    if (recipient.talks.some((talk) => talk.status === "missing")) recipient.status = "missing";
  }
  return [...bySpeaker.values()];
}

export type EventFacts = {
  client_id: string;
  /** A practice event's speakers are made up (D-116): no sign-in is ever created for them. */
  is_practice?: boolean;
  name: string;
  deadline: string | null;
  timezone: string;
  venue: string | null;
  starts_on: string;
  ends_on: string;
};

type QueueInput = {
  eventId: string;
  event: EventFacts;
  template: TemplateRow;
  /** Who sent it, for the audit of a sign-in made on the way; absent for the automatic reminders. */
  actorUserId?: string | undefined;
  recipient: {
    speaker_id: string;
    name: string;
    email: string;
    talks: { title: string; room: string | null; starts_at: string; ends_at?: string }[];
  };
};

/** "A", "A and B", "A, B and C". */
const listed = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/**
 * The per-presentation merge fields (D-087). `{{presentations}}` is one line per
 * presentation; the single-value fields still work for a template written before it —
 * with several presentations they read as a list ("A and B in Hall 1 and Hall 3 …").
 */
export function talkFields(
  talks: { title: string; room: string | null; starts_at: string; ends_at?: string }[],
  timezone: string,
): {
  talk_title: string;
  room: string;
  session_time: string;
  session_date: string;
  session_start: string;
  session_end: string;
  presentations: string;
} {
  const when = (talk: { starts_at: string }) => formatSessionTime(talk.starts_at, timezone);
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: timezone });
  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: timezone, timeZoneName: "short" });
  return {
    talk_title: listed(talks.map((talk) => talk.title)),
    room: listed([...new Set(talks.map((talk) => talk.room ?? "TBC"))]),
    session_time: listed(talks.map(when)),
    // D-138: the session's day and times on their own, as Preseria's macros give them.
    session_date: listed([...new Set(talks.map((talk) => day(talk.starts_at)))]),
    session_start: listed(talks.map((talk) => clock(talk.starts_at))),
    session_end: listed(talks.map((talk) => (talk.ends_at ? clock(talk.ends_at) : "TBC"))),
    presentations: talks.map((talk) => `• ${talk.title} — ${talk.room ?? "Room TBC"}, ${when(talk)}`).join("\n"),
  };
}

/**
 * One speaker's email: a fresh personal link, the template rendered for them, a
 * `communications` row (the delivery log and the "already sent?" record) and an outbox
 * entry the dispatcher delivers. Shared by the batch and the single send (D-086).
 */
async function queueInvitation(tx: pg.PoolClient, input: QueueInput): Promise<string> {
  /*
   * The speaker's sign-in (D-147) is what the email carries: made now if there is none, or
   * its temporary password reissued if it was never used. A practice event's speakers are
   * made up and get no account — the email, never sent (D-116), shows a sample password.
   */
  const signIn = input.event.is_practice
    ? null
    : await ensureSpeakerSignIn(tx, {
        email: input.recipient.email,
        displayName: input.recipient.name,
        eventId: input.eventId,
        clientId: input.event.client_id,
        actorUserId: input.actorUserId,
      });
  const temporaryPassword = input.event.is_practice ? "XXXX-XXXX-XXXX-XXXX" : (signIn?.temporary_password ?? null);
  const values = {
    ...personFields(input.recipient.name),
    ...eventFields(input.event),
    // On the event's clock (D-072). This was the UTC time with no zone, so a 10:30
    // New York session was mailed out as "14:30".
    ...talkFields(input.recipient.talks, input.event.timezone),
    // Worded exactly as the speaker portal shows it, not a raw "2027-03-01".
    deadline: input.event.deadline ? formatDeadline(input.event.deadline, input.event.timezone) : "the published deadline",
    upload_link: SIGN_IN_URL,
    sign_in: signInBlock(temporaryPassword),
  };
  const rendered = renderTemplate(input.template, values);
  // A formatted template (D-139) is sent as formatted HTML; `rendered.body` is its text twin.
  const htmlBody = input.template.body_html ? fillHtml(input.template.body_html, values) : null;
  const sensitive = Boolean(temporaryPassword) && !input.event.is_practice;

  const { rows: comm } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.communications (event_id, client_id, speaker_id, template_id, to_address, subject, body, status)
     VALUES ($1,$2,$3,$4,$5::citext,$6,$7,'queued') RETURNING id`,
    [
      input.eventId,
      input.event.client_id,
      input.recipient.speaker_id,
      input.template.id,
      input.recipient.email,
      rendered.subject,
      // Kept for the archive (D-069) without the password: the stored copy ends up in the
      // client's package, and a password belongs in exactly one place — the speaker's inbox.
      sensitive && temporaryPassword ? rendered.body.replaceAll(temporaryPassword, PASSWORD_REDACTED) : rendered.body,
    ],
  );

  // Delivery is a side effect: it goes through the outbox, never the request.
  await tx.query(`INSERT INTO pmp.outbox (topic, payload) VALUES ('email.send', $1)`, [
    JSON.stringify({
      communication_id: comm[0]!.id,
      to: input.recipient.email,
      subject: rendered.subject,
      body: rendered.body,
      ...(htmlBody ? { html_body: htmlBody } : {}),
      // The dispatcher strips the body from the outbox row once it has gone (D-100).
      ...(sensitive ? { sensitive: true } : {}),
      // Banner, button to the sign-in page, sender name and reply-to (D-138).
      look: await lookFor(tx, input.eventId, { label: SIGN_IN_BUTTON, url: SIGN_IN_URL }),
    }),
  ]);
  return comm[0]!.id;
}

/** The speaker's name fields: first (without a title), last, and as written. */
export function personFields(name: string): { speaker_first: string; speaker_last: string; speaker_name: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = firstName(name);
  const last = words.length > 1 ? words.at(-1)! : "";
  return { speaker_first: first, speaker_last: last, speaker_name: name.trim() };
}

/** The event's own fields: name, venue and its dates, worded for an email. */
export function eventFields(event: Pick<EventFacts, "name" | "venue" | "starts_on" | "ends_on">): {
  event_name: string;
  event_venue: string;
  event_dates: string;
} {
  return {
    event_name: event.name,
    event_venue: event.venue ?? "the venue",
    event_dates: formatDateRange(event.starts_on, event.ends_on),
  };
}

export type SendResult = {
  queued: number;
  skipped: { reason: string; count: number }[];
};

/**
 * FR-COM-001/003. Guards, in order: the event must be able to host a talk at
 * all; a recipient needs a working address; nobody is sent the same batch twice.
 */
export async function sendBatch(
  tx: pg.PoolClient,
  actor: Actor,
  input: {
    eventId: string;
    templateId: string;
    missingOnly: boolean;
    /** The automatic reminders use a shorter guard, so reminder days a day apart both go (D-096). */
    cooldownHours?: number;
    /**
     * The automatic reminders also stand back for anyone emailed about this event at all
     * in the cooldown (D-102): a speaker just sent their upload link does not need a
     * "reminder" of it a minute later.
     */
    cooldownAnyTemplate?: boolean;
  },
): Promise<Result<SendResult, DomainError>> {
  const { rows: readiness } = await tx.query<{
    rooms: string;
    days: string;
    client_id: string;
    is_practice: boolean;
    name: string;
    deadline: string | null;
    timezone: string;
    venue: string | null;
    starts_on: string;
    ends_on: string;
  }>(
    `SELECT (SELECT count(*)::text FROM pmp.rooms WHERE event_id = e.id) AS rooms,
            (SELECT count(*)::text FROM pmp.event_days WHERE event_id = e.id) AS days,
            e.client_id, e.is_practice, e.name, (e.settings ->> 'upload_deadline') AS deadline, e.timezone,
            v.name AS venue, e.starts_on::text AS starts_on, e.ends_on::text AS ends_on
       FROM pmp.events e LEFT JOIN pmp.venues v ON v.id = e.venue_id WHERE e.id = $1`,
    [input.eventId],
  );
  const event = readiness[0];
  if (!event) return err({ code: "comms.event_not_found", message: "This event no longer exists — it may have been removed. Refresh the page." });

  // The baseline's rule: invitations cannot go out before the event can host a
  // talk, because the link would point at nothing (SCREEN_SPECS §2).
  if (Number(event.rooms) === 0 || Number(event.days) === 0) {
    return err({
      code: "comms.event_incomplete",
      message:
        "Invitations can't be sent until the event has at least one day and one room — there would be nothing to upload for.",
    });
  }

  const { rows: templateRows } = await tx.query<TemplateRow>(
    `SELECT id, name, subject, body, body_html FROM pmp.communication_templates WHERE id = $1`,
    [input.templateId],
  );
  const template = templateRows[0];
  if (!template) return err({ code: "comms.template_not_found", message: "This template no longer exists — it may have been removed. Refresh the page." });

  const cooldown = input.cooldownHours ?? RESEND_COOLDOWN_HOURS;
  // Anything but a reminder is the once-only upload invitation (D-086, D-108).
  const once = !/reminder/i.test(template.name);
  const recipients = await recipientsFor(
    tx,
    input.eventId,
    input.templateId,
    input.missingOnly,
    cooldown,
    input.cooldownAnyTemplate ?? false,
    once,
  );
  const skipped = new Map<string, number>();
  const note = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  let queued = 0;
  for (const recipient of recipients) {
    if (!recipient.email) {
      note("no email address");
      continue;
    }
    if (recipient.bounced) {
      note("previous email bounced");
      continue;
    }
    if (await isStaffAddress(tx, recipient.email)) {
      note("address belongs to a DXG staff account");
      continue;
    }
    if (recipient.already_sent) {
      // Named by what it is, so an operator can tell "I already did this" from
      // "this address is dead" — the two reasons a chase list comes back empty.
      note(
        input.cooldownAnyTemplate
          ? `emailed about this event in the last ${cooldown} hours`
          : once
            ? "already sent the upload invitation"
            : `already emailed this in the last ${cooldown} hours`,
      );
      continue;
    }

    await queueInvitation(tx, {
      eventId: input.eventId,
      event,
      template,
      actorUserId: actor.isMachine ? undefined : actor.id,
      recipient: { speaker_id: recipient.speaker_id, name: recipient.name, email: recipient.email, talks: recipient.talks },
    });
    queued += 1;
  }

  await appendAudit(tx, {
    partitionId: input.eventId,
    clientId: event.client_id,
    actorUserId: actor.id,
    action: "comms.batch_queued",
    subjectType: "communication_template",
    subjectId: template.id,
    detail: { queued, skipped: Object.fromEntries(skipped), missing_only: input.missingOnly },
  });

  return ok({
    queued,
    skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })),
  });
}

/** A staff member's address can never carry a speaker's sign-in (D-146, D-147). */
async function isStaffAddress(tx: pg.PoolClient, email: string): Promise<boolean> {
  const { rows } = await tx.query<{ account_kind: string }>(
    `SELECT account_kind FROM pmp.users WHERE lower(email::text) = lower($1) AND is_active AND deleted_at IS NULL`,
    [email],
  );
  return rows[0] !== undefined && rows[0].account_kind !== "speaker";
}

/** What the Speakers screen shows about the last email a speaker was sent (D-086). */
export type LastEmail = { status: string; at: string; to: string; count: number };

/**
 * Emails one speaker their upload link, with the event's invitation template (D-086).
 *
 * "Send upload link" used to issue a link and show it in a toast — nothing was sent,
 * and nothing recorded that the speaker had been contacted. It now goes through the
 * same path as a batch (personal link, rendered template, communications row, outbox),
 * so it is in the delivery log and its status moves queued → sent → delivered.
 *
 * Sent once per speaker, never again (Travis's call): a second request is refused, and
 * the screen disables the button once the email has gone. Only an email that failed
 * before leaving (status `failed`) does not count. A bounce is refused too — the
 * address needs fixing, not another attempt.
 */
export async function sendUploadLink(
  tx: pg.PoolClient,
  actor: Actor,
  input: { eventId: string; speakerId: string },
): Promise<Result<{ communication_id: string; to: string }, DomainError>> {
  const { rows: eventRows } = await tx.query<{
    rooms: string;
    days: string;
    client_id: string;
    is_practice: boolean;
    name: string;
    deadline: string | null;
    timezone: string;
    venue: string | null;
    starts_on: string;
    ends_on: string;
  }>(
    `SELECT (SELECT count(*)::text FROM pmp.rooms WHERE event_id = e.id) AS rooms,
            (SELECT count(*)::text FROM pmp.event_days WHERE event_id = e.id) AS days,
            e.client_id, e.is_practice, e.name, (e.settings ->> 'upload_deadline') AS deadline, e.timezone,
            v.name AS venue, e.starts_on::text AS starts_on, e.ends_on::text AS ends_on
       FROM pmp.events e LEFT JOIN pmp.venues v ON v.id = e.venue_id WHERE e.id = $1`,
    [input.eventId],
  );
  const event = eventRows[0];
  if (!event) return err({ code: "comms.event_not_found", message: "This event no longer exists — it may have been removed. Refresh the page." });
  if (Number(event.rooms) === 0 || Number(event.days) === 0) {
    return err({
      code: "comms.event_incomplete",
      message: "Sign-in emails can't be sent until the event has at least one day and one room.",
    });
  }

  // The speaker and every presentation they are on — one email names them all (D-087).
  const { rows: speakerRows } = await tx.query<{
    name: string;
    email: string | null;
    talks: { title: string; room: string | null; starts_at: string }[];
  }>(
    `SELECT sp.full_name AS name, sp.email::text AS email,
            COALESCE((
              SELECT json_agg(json_build_object('title', s.title, 'room', r.name, 'starts_at', se.starts_at)
                              ORDER BY se.starts_at)
                FROM pmp.speaker_assignments sa
                JOIN pmp.slots s     ON s.id = sa.slot_id
                JOIN pmp.sessions se ON se.id = s.session_id
                LEFT JOIN pmp.rooms r ON r.id = se.room_id
               WHERE sa.speaker_id = sp.id AND se.session_state <> 'canceled'
            ), '[]'::json) AS talks
       FROM pmp.speakers sp
      WHERE sp.id = $1 AND sp.event_id = $2 AND sp.merged_into IS NULL AND sp.removed_at IS NULL`,
    [input.speakerId, input.eventId],
  );
  const speaker = speakerRows[0];
  if (!speaker) return err({ code: "comms.speaker_not_found", message: "This speaker no longer exists on this event — it may have been removed. Refresh the page." });
  if (!speaker.email) {
    return err({ code: "comms.no_email", message: `${speaker.name} has no email address. Add one first.` });
  }
  if (speaker.talks.length === 0) {
    return err({
      code: "comms.no_talk",
      message: `${speaker.name} is not on any presentation yet, so there is nothing to upload for. Assign a presentation first.`,
    });
  }

  const { rows: history } = await tx.query<{ status: string; to_address: string }>(
    `SELECT status, to_address::text
       FROM pmp.communications
      WHERE speaker_id = $1
         -- A bounce or complaint on this address anywhere counts too (D-097).
         OR (lower(to_address::text) = lower($2) AND status IN ('bounced','complained'))
      ORDER BY created_at DESC`,
    [input.speakerId, speaker.email],
  );
  // Only a bounce on the address on file now blocks: once corrected, the email can go (D-108).
  if (
    history.some(
      (row) =>
        (row.status === "bounced" || row.status === "complained") &&
        row.to_address.toLowerCase() === (speaker.email ?? "").toLowerCase(),
    )
  ) {
    return err({
      code: "comms.bounced_conflict",
      message: `An earlier email to ${speaker.email} bounced. Correct the address on the Agenda, then send the sign-in again.`,
    });
  }
  /*
   * Sent again freely while the sign-in is unused (D-147): each send reissues the temporary
   * password, which is what "Resend" is for. Once the speaker has chosen a password there is
   * nothing to send — they sign in with it, and the page offers "Forgotten your password?".
   */
  const { rows: account } = await tx.query<{ must_change_password: boolean; account_kind: string }>(
    `SELECT must_change_password, account_kind FROM pmp.users
      WHERE lower(email::text) = lower($1) AND is_active AND deleted_at IS NULL`,
    [speaker.email],
  );
  // A staff member's address is never a speaker's sign-in (D-146): say so here rather than
  // mailing them an invitation whose "your password" opens nothing on the speaker site.
  if (account[0] && account[0].account_kind !== "speaker") {
    return err({
      code: "comms.staff_address",
      message: `${speaker.email} belongs to a DXG staff account, so it can't be a speaker's sign-in. Give ${speaker.name} a different email address on the Agenda, then send the sign-in.`,
    });
  }
  if (account[0] && account[0].account_kind === "speaker" && !account[0].must_change_password) {
    return err({
      code: "comms.already_signed_in",
      message: `${speaker.name} already has a sign-in and has chosen their password, so there is nothing to send. They can use "Forgotten your password?" on the sign-in page.`,
    });
  }

  const templates = await ensureTemplates(tx, input.eventId);
  const template = templates[0];
  if (!template) return err({ code: "comms.template_not_found", message: "This event has no invitation template." });

  const communicationId = await queueInvitation(tx, {
    eventId: input.eventId,
    event,
    template,
    actorUserId: actor.id,
    recipient: {
      speaker_id: input.speakerId,
      name: speaker.name,
      email: speaker.email,
      talks: speaker.talks,
    },
  });

  await appendAudit(tx, {
    partitionId: input.eventId,
    clientId: event.client_id,
    actorUserId: actor.id,
    action: "comms.upload_link_sent",
    subjectType: "speaker",
    subjectId: input.speakerId,
    detail: { communication_id: communicationId, template_id: template.id },
  });
  return ok({ communication_id: communicationId, to: speaker.email });
}

export type DeliveryRow = {
  id: string;
  speaker: string | null;
  to_address: string;
  subject: string;
  status: string;
  sent_at: string | null;
  created_at: string;
};

export async function deliveryLog(tx: pg.PoolClient, eventId: string): Promise<DeliveryRow[]> {
  const { rows } = await tx.query<DeliveryRow>(
    `SELECT c.id, sp.full_name AS speaker, c.to_address::text, c.subject, c.status, c.sent_at, c.created_at
       FROM pmp.communications c
       LEFT JOIN pmp.speakers sp ON sp.id = c.speaker_id
      WHERE c.event_id = $1
      ORDER BY c.created_at DESC
      LIMIT 200`,
    [eventId],
  );
  return rows;
}

export type Stats = {
  queued: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  /** A practice event's emails, recorded and never sent (D-116). */
  practice: number;
};

export async function deliveryStats(tx: pg.PoolClient, eventId: string): Promise<Stats> {
  const { rows } = await tx.query<Record<string, string>>(
    `SELECT count(*) FILTER (WHERE status = 'queued')::text AS queued,
            count(*) FILTER (WHERE status = 'sent')::text AS sent,
            count(*) FILTER (WHERE status = 'delivered')::text AS delivered,
            count(*) FILTER (WHERE status = 'opened')::text AS opened,
            count(*) FILTER (WHERE status = 'clicked')::text AS clicked,
            count(*) FILTER (WHERE status IN ('bounced','complained'))::text AS bounced,
            count(*) FILTER (WHERE status = 'practice')::text AS practice
       FROM pmp.communications WHERE event_id = $1`,
    [eventId],
  );
  const row = rows[0] ?? {};
  return {
    queued: Number(row.queued ?? 0),
    sent: Number(row.sent ?? 0),
    delivered: Number(row.delivered ?? 0),
    opened: Number(row.opened ?? 0),
    clicked: Number(row.clicked ?? 0),
    bounced: Number(row.bounced ?? 0),
    practice: Number(row.practice ?? 0),
  };
}

/** Correlates an SES event to the communication it belongs to. */
export async function findCommunication(
  tx: pg.PoolClient,
  input: { communicationId: string | null; messageId: string | null },
): Promise<string | null> {
  if (input.communicationId) {
    const { rows } = await tx.query<{ id: string }>(`SELECT id FROM pmp.communications WHERE id = $1`, [
      input.communicationId,
    ]);
    if (rows[0]) return rows[0].id;
  }
  if (input.messageId) {
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM pmp.communications WHERE provider_message_id = $1`,
      [input.messageId],
    );
    if (rows[0]) return rows[0].id;
  }
  return null;
}

/** Provider webhook (SES via SNS in production): delivery, open, click, bounce. */
export async function recordDeliveryEvent(
  tx: pg.PoolClient,
  input: { communicationId: string; eventType: string; payload: Record<string, unknown> },
): Promise<Result<{ status: string }, DomainError>> {
  const allowed = ["sent", "delivered", "opened", "clicked", "bounced", "complained", "failed"];
  if (!allowed.includes(input.eventType)) {
    return err({ code: "comms.unknown_event", message: `Unknown delivery event “${input.eventType}”.` });
  }

  const { rows } = await tx.query<{ event_id: string; client_id: string }>(
    `SELECT event_id, client_id FROM pmp.communications WHERE id = $1`,
    [input.communicationId],
  );
  if (!rows[0]) return err({ code: "comms.not_found", message: "This communication no longer exists — it may have been removed. Refresh the page." });

  await tx.query(
    `UPDATE pmp.communications
        SET status = $1, status_detail = $2,
            sent_at = CASE WHEN $1 IN ('sent','delivered') THEN COALESCE(sent_at, now()) ELSE sent_at END
      WHERE id = $3`,
    [input.eventType, JSON.stringify(input.payload), input.communicationId],
  );
  await tx.query(
    `INSERT INTO pmp.communication_events (communication_id, event_id, client_id, event_type, payload, occurred_at)
     VALUES ($1,$2,$3,$4,$5, now())`,
    [input.communicationId, rows[0].event_id, rows[0].client_id, input.eventType, JSON.stringify(input.payload)],
  );

  return ok({ status: input.eventType });
}
