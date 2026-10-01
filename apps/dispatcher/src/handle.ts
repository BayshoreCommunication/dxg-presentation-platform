import type pg from "pg";
import type { EmailLook, EmailSender, Message } from "@pmp/email";
import { renderEmailHtml } from "@pmp/email";
import { suppressionReason } from "./guard.ts";

export type OutboxRow = { id: string; topic: string; payload: Record<string, unknown> };

/** Runs work in a transaction; `withSystemScope` in the dispatcher, a stub in tests. */
export type Db = <T>(fn: (tx: pg.PoolClient) => Promise<T>) => Promise<T>;

export type Deps = {
  sender: EmailSender;
  db: Db;
  /** Defaults to the D-097 guard; replaceable so a test needs no DNS. */
  refuse?: (tx: pg.PoolClient, to: string) => Promise<string | null>;
};

/**
 * Whether this email belongs to a practice event (D-116). Asked of the event, not the
 * address: whatever queued it and whoever it is addressed to, practice mail never leaves.
 */
async function isPractice(tx: pg.PoolClient, communicationId: string): Promise<boolean> {
  const { rows } = await tx.query<{ is_practice: boolean }>(
    `SELECT e.is_practice FROM pmp.communications c JOIN pmp.events e ON e.id = c.event_id WHERE c.id = $1`,
    [communicationId],
  );
  return rows[0]?.is_practice === true;
}

/** Records a decision not to send, on the communication and its event history. */
async function settle(tx: pg.PoolClient, communicationId: string, status: "failed" | "practice", detail: Record<string, unknown>) {
  await tx.query(
    `UPDATE pmp.communications SET status = $2, status_detail = $3 WHERE id = $1 AND status = 'queued'`,
    [communicationId, status, JSON.stringify(detail)],
  );
  await tx.query(
    `INSERT INTO pmp.communication_events
       (communication_id, event_id, client_id, event_type, payload, occurred_at)
     SELECT id, event_id, client_id, $2, $3, now() FROM pmp.communications WHERE id = $1`,
    [communicationId, status, JSON.stringify(detail)],
  );
}

/**
 * One outbox row, end to end. Returning normally means "dispatched"; throwing leaves the
 * row for a retry. Kept apart from the polling loop so it can be tested without one.
 */
export async function handle(row: OutboxRow, deps: Deps): Promise<void> {
  if (row.topic !== "email.send") return; // other topics belong to the worker

  const payload = row.payload as {
    to?: string;
    subject?: string;
    body?: string;
    communication_id?: string;
    /** Speaker mail's branding (D-138): banner, button, sender name and reply-to. */
    look?: EmailLook & { from_name?: string | null; reply_to?: string | null };
    /** The formatted message (D-139), sanitised by the API; `body` is its plain-text twin. */
    html_body?: string;
  };
  if (!payload.to || !payload.subject) {
    throw new Error("email.send payload needs `to` and `subject`");
  }

  // D-116: a practice event's mail is recorded as "Practice — not sent" and goes no further.
  // First of all the checks, so nothing about it — not even a DNS lookup — reaches outside.
  const communicationId = payload.communication_id;
  if (communicationId && (await deps.db((tx) => isPractice(tx, communicationId)))) {
    await deps.db((tx) => settle(tx, communicationId, "practice", { reason: "practice event" }));
    console.error(`[dispatcher] practice event — not sent to ${payload.to}`);
    return;
  }

  // Never hand the provider an address that will bounce, or one that already has (D-097).
  const refuse = deps.refuse ?? suppressionReason;
  const refused = await deps.db((tx) => refuse(tx, payload.to!));
  if (refused) {
    console.error(`[dispatcher] not sent to ${payload.to} — ${refused}`);
    if (communicationId) await deps.db((tx) => settle(tx, communicationId, "failed", { reason: refused }));
    return; // Dispatched: it was decided, not deferred — retrying would refuse again.
  }

  const look = payload.look;
  const message: Message = {
    to: payload.to,
    subject: payload.subject,
    body: payload.body ?? "",
    kind: row.topic,
    ref: communicationId,
    ...(look
      ? {
          html: renderEmailHtml({ subject: payload.subject, body: payload.body ?? "", body_html: payload.html_body ?? null, ...look }),
          ...(look.from_name ? { fromName: look.from_name } : {}),
          ...(look.reply_to ? { replyTo: look.reply_to } : {}),
        }
      : {}),
  };
  const delivery = await deps.sender.send(message);

  // Speaker mail has a communication row to update; account mail does not.
  if (communicationId) {
    await deps.db(async (tx) => {
      await tx.query(
        `UPDATE pmp.communications
            SET status = 'sent', sent_at = now(), provider_message_id = $2
          WHERE id = $1 AND status = 'queued'`,
        [communicationId, delivery.id],
      );
      await tx.query(
        `INSERT INTO pmp.communication_events
           (communication_id, event_id, client_id, event_type, payload, occurred_at)
         SELECT id, event_id, client_id, 'sent', $2, now() FROM pmp.communications WHERE id = $1`,
        [communicationId, JSON.stringify({ transport: deps.sender.name, ...delivery.detail })],
      );
    });
  }
}
