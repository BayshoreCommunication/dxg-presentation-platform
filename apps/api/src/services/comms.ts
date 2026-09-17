import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { appendAudit } from "@pmp/db";
import { deriveTalkStatus } from "@pmp/domain";
import type { Actor, DomainError, Result } from "@pmp/domain";
import { err, ok } from "@pmp/domain";

const hashToken = (token: string): Buffer => createHash("sha256").update(token).digest();

export type TemplateRow = {
  id: string;
  name: string;
  subject: string;
  body: string;
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
      "You're presenting at {{event_name}} — {{talk_title}} in {{room}} on {{session_time}}.",
      "",
      "Please upload your presentation by {{deadline}} using your personal secure link. No account is needed.",
      "",
      "{{upload_link}}",
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
      "We don't have your presentation for {{talk_title}} yet. The deadline is {{deadline}}.",
      "",
      "{{upload_link}}",
      "",
      "If you've already sent it another way, reply to this email and we'll check.",
      "",
      "The DXG presentation team",
    ].join("\n"),
  },
] as const;

export async function ensureTemplates(tx: pg.PoolClient, eventId: string): Promise<TemplateRow[]> {
  const { rows: existing } = await tx.query<TemplateRow>(
    // Insertion order, so the invitation leads and reminders follow it.
    `SELECT id, name, subject, body FROM pmp.communication_templates
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
    `SELECT id, name, subject, body FROM pmp.communication_templates
      WHERE event_id = $1 ORDER BY created_at, name`,
    [eventId],
  );
  return rows;
}

export type Recipient = {
  speaker_id: string;
  name: string;
  email: string | null;
  talk_title: string;
  room: string | null;
  starts_at: string;
  status: string;
  bounced: boolean;
  already_sent: boolean;
};

/**
 * Who a batch would actually reach. Recipients are resolved at send time, not
 * when a batch is scheduled: a reminder must not chase someone who uploaded
 * yesterday (FR-COM-002).
 */
export async function recipientsFor(
  tx: pg.PoolClient,
  eventId: string,
  templateId: string,
  missingOnly: boolean,
): Promise<Recipient[]> {
  const { rows } = await tx.query<{
    speaker_id: string;
    name: string;
    email: string | null;
    talk_title: string;
    room: string | null;
    starts_at: string;
    session_state: string;
    versions: { processing: string; inspection: string; review: string }[] | null;
    bounced: boolean;
    already_sent: boolean;
  }>(
    `SELECT sp.id AS speaker_id, sp.full_name AS name, sp.email::text AS email,
            s.title AS talk_title, r.name AS room, se.starts_at, se.session_state,
            (SELECT json_agg(json_build_object('processing', fv.processing_state,
                                               'inspection', fv.inspection_state,
                                               'review', fv.review_state) ORDER BY fv.version_number)
               FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
              WHERE f.slot_id = s.id) AS versions,
            EXISTS (SELECT 1 FROM pmp.communications c
                     WHERE c.speaker_id = sp.id AND c.status IN ('bounced','complained')) AS bounced,
            EXISTS (SELECT 1 FROM pmp.communications c
                     WHERE c.speaker_id = sp.id AND c.template_id = $2) AS already_sent
       FROM pmp.speakers sp
       JOIN pmp.speaker_assignments sa ON sa.speaker_id = sp.id
       JOIN pmp.slots s ON s.id = sa.slot_id
       JOIN pmp.sessions se ON se.id = s.session_id
       LEFT JOIN pmp.rooms r ON r.id = se.room_id
      WHERE sp.event_id = $1 AND sp.merged_into IS NULL
      ORDER BY sp.full_name`,
    [eventId, templateId],
  );

  return rows
    .map((row) => ({
      speaker_id: row.speaker_id,
      name: row.name,
      email: row.email,
      talk_title: row.talk_title,
      room: row.room,
      starts_at: row.starts_at,
      status: deriveTalkStatus({
        sessionState: row.session_state as never,
        eventArchived: false,
        versions: (row.versions ?? []) as never,
        roomCopies: [],
      }),
      bounced: row.bounced,
      already_sent: row.already_sent,
    }))
    .filter((row) => (missingOnly ? row.status === "missing" : true));
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
  input: { eventId: string; templateId: string; missingOnly: boolean },
): Promise<Result<SendResult, DomainError>> {
  const { rows: readiness } = await tx.query<{ rooms: string; days: string; client_id: string; name: string; deadline: string | null }>(
    `SELECT (SELECT count(*)::text FROM pmp.rooms WHERE event_id = e.id) AS rooms,
            (SELECT count(*)::text FROM pmp.event_days WHERE event_id = e.id) AS days,
            e.client_id, e.name, (e.settings ->> 'upload_deadline') AS deadline
       FROM pmp.events e WHERE e.id = $1`,
    [input.eventId],
  );
  const event = readiness[0];
  if (!event) return err({ code: "comms.event_not_found", message: "No such event." });

  // The baseline's rule: invitations cannot go out before the event can host a
  // talk, because the link would point at nothing (SCREEN_SPECS §2).
  if (Number(event.rooms) === 0 || Number(event.days) === 0) {
    return err({
      code: "comms.event_incomplete",
      message:
        "Invitations can't be sent until the event has at least one day and one room — a speaker link would point at nothing.",
    });
  }

  const { rows: templateRows } = await tx.query<TemplateRow>(
    `SELECT id, name, subject, body FROM pmp.communication_templates WHERE id = $1`,
    [input.templateId],
  );
  const template = templateRows[0];
  if (!template) return err({ code: "comms.template_not_found", message: "No such template." });

  const recipients = await recipientsFor(tx, input.eventId, input.templateId, input.missingOnly);
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
    if (recipient.already_sent) {
      note("already received this batch");
      continue;
    }

    // Each recipient gets their own link; a batch never contains a shared URL.
    const token = randomUUID();
    await tx.query(
      `INSERT INTO pmp.speaker_tokens (speaker_id, event_id, client_id, kind, token_hash, expires_at)
       VALUES ($1,$2,$3,'magic_link',$4, now() + interval '30 days')`,
      [recipient.speaker_id, input.eventId, event.client_id, hashToken(token)],
    );

    const rendered = renderTemplate(template, {
      speaker_first: recipient.name.split(" ").slice(-1)[0] ?? recipient.name,
      speaker_name: recipient.name,
      event_name: event.name,
      talk_title: recipient.talk_title,
      room: recipient.room ?? "TBC",
      session_time: new Date(recipient.starts_at).toISOString().slice(0, 16).replace("T", " "),
      deadline: event.deadline ?? "the published deadline",
      upload_link: `http://localhost:3001/t/${token}`,
    });

    const { rows: comm } = await tx.query<{ id: string }>(
      `INSERT INTO pmp.communications (event_id, client_id, speaker_id, template_id, to_address, subject, status)
       VALUES ($1,$2,$3,$4,$5::citext,$6,'queued') RETURNING id`,
      [input.eventId, event.client_id, recipient.speaker_id, template.id, recipient.email, rendered.subject],
    );

    // Delivery is a side effect: it goes through the outbox, never the request.
    await tx.query(`INSERT INTO pmp.outbox (topic, payload) VALUES ('email.send', $1)`, [
      JSON.stringify({
        communication_id: comm[0]!.id,
        to: recipient.email,
        subject: rendered.subject,
        body: rendered.body,
      }),
    ]);
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

export type Stats = { queued: number; sent: number; delivered: number; opened: number; clicked: number; bounced: number };

export async function deliveryStats(tx: pg.PoolClient, eventId: string): Promise<Stats> {
  const { rows } = await tx.query<Record<string, string>>(
    `SELECT count(*) FILTER (WHERE status = 'queued')::text AS queued,
            count(*) FILTER (WHERE status = 'sent')::text AS sent,
            count(*) FILTER (WHERE status = 'delivered')::text AS delivered,
            count(*) FILTER (WHERE status = 'opened')::text AS opened,
            count(*) FILTER (WHERE status = 'clicked')::text AS clicked,
            count(*) FILTER (WHERE status IN ('bounced','complained'))::text AS bounced
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
  if (!rows[0]) return err({ code: "comms.not_found", message: "No such communication." });

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
