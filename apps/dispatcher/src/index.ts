import { withSystemScope, closePool } from "@pmp/db";
import { senderFromEnv } from "@pmp/email";
import type { Message } from "@pmp/email";

/**
 * The outbox dispatcher (BUILD_SPEC §6.2). Side effects are written inside the
 * transaction that caused them and delivered from here, so a request never
 * half-commits: either the state change and its consequences both exist, or
 * neither does.
 */
const sender = senderFromEnv();
const INTERVAL_MS = Number(process.env.DISPATCH_INTERVAL_MS ?? 1000);
const BATCH = 20;

type OutboxRow = { id: string; topic: string; payload: Record<string, unknown> };

async function handle(row: OutboxRow): Promise<void> {
  if (row.topic !== "email.send") return; // other topics belong to the worker

  const payload = row.payload as {
    to?: string;
    subject?: string;
    body?: string;
    communication_id?: string;
  };
  if (!payload.to || !payload.subject) {
    throw new Error("email.send payload needs `to` and `subject`");
  }

  const message: Message = {
    to: payload.to,
    subject: payload.subject,
    body: payload.body ?? "",
    kind: row.topic,
    ref: payload.communication_id,
  };
  const delivery = await sender.send(message);

  // Speaker mail has a communication row to update; account mail does not.
  if (payload.communication_id) {
    await withSystemScope(async (tx) => {
      await tx.query(
        `UPDATE pmp.communications
            SET status = 'sent', sent_at = now(), provider_message_id = $2
          WHERE id = $1 AND status = 'queued'`,
        [payload.communication_id, delivery.id],
      );
      await tx.query(
        `INSERT INTO pmp.communication_events
           (communication_id, event_id, client_id, event_type, payload, occurred_at)
         SELECT id, event_id, client_id, 'sent', $2, now() FROM pmp.communications WHERE id = $1`,
        [payload.communication_id, JSON.stringify({ transport: sender.name, ...delivery.detail })],
      );
    });
  }
}

async function drain(): Promise<number> {
  return withSystemScope(async (tx) => {
    // SKIP LOCKED so more than one dispatcher can run without collisions.
    const { rows } = await tx.query<OutboxRow>(
      `SELECT id, topic, payload FROM pmp.outbox
        WHERE dispatched_at IS NULL
        ORDER BY id
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [BATCH],
    );

    for (const row of rows) {
      try {
        await handle(row);
        await tx.query(`UPDATE pmp.outbox SET dispatched_at = now() WHERE id = $1`, [row.id]);
      } catch (error) {
        // Left undispatched so it is retried rather than lost.
        console.error(`[dispatcher] ${row.topic} #${row.id} failed:`, error);
      }
    }
    return rows.length;
  });
}

async function loop(): Promise<void> {
  console.error(`[dispatcher] running · transport=${sender.name} · every ${INTERVAL_MS}ms`);
  for (;;) {
    try {
      const handled = await drain();
      if (handled === 0) await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    } catch (error) {
      console.error("[dispatcher] loop error:", error);
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS * 5));
    }
  }
}

process.on("SIGINT", () => {
  void closePool().then(() => process.exit(0));
});

await loop();
