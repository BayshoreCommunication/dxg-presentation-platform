import { withSystemScope, closePool } from "@pmp/db";
import { senderFromEnv } from "@pmp/email";
import { handle as handleRow } from "./handle.ts";
import type { OutboxRow } from "./handle.ts";

/**
 * The outbox dispatcher (BUILD_SPEC §6.2). Side effects are written inside the
 * transaction that caused them and delivered from here, so a request never
 * half-commits: either the state change and its consequences both exist, or
 * neither does.
 */
const sender = senderFromEnv();
const INTERVAL_MS = Number(process.env.DISPATCH_INTERVAL_MS ?? 1000);
const BATCH = 20;

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
        await handleRow(row, { sender, db: withSystemScope });
        // A `sensitive` email carries a temporary password (D-100): once it has been
        // handled, the stored copy keeps who and what, but not the password.
        await tx.query(
          `UPDATE pmp.outbox
              SET dispatched_at = now(),
                  payload = CASE WHEN payload->>'sensitive' = 'true'
                                 THEN (payload - 'html_body') || '{"body":"[removed after sending: contained a temporary password]"}'::jsonb
                                 ELSE payload END
            WHERE id = $1`,
          [row.id],
        );
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
