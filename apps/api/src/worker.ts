import os from "node:os";
import { writeFileSync } from "node:fs";
import { withSystemScope, closePool } from "@pmp/db";
import { assertProductionConfig } from "./config.ts";
import { findLibreOffice, startPdfWorker, stopPdfWorker } from "./services/pdf.ts";
import { startReminderScheduler, stopReminderScheduler } from "./services/reminders.ts";

/**
 * The background worker (D-103): PDF previews and automatic reminders, in their own process.
 *
 * Both used to run inside the API, which tied them to the API's lifetime and made a second
 * API instance unsafe — two copies of every loop. The API now only queues work (a row in
 * Postgres plus a NOTIFY); this process does it. It shares the API's code and image, so
 * the conversion and reminder logic has one home, and it needs the same settings.
 *
 * It is safe to run more than one: conversions are claimed with SKIP LOCKED and reminders
 * under an advisory lock. It answers no requests; it records a heartbeat, which
 * /ops/health reports and the container health check reads.
 */
assertProductionConfig();

// Host and pid: two workers on one machine (development, or a scaled service) are two rows.
const NAME = `worker@${os.hostname()}#${process.pid}`;
const HEARTBEAT_MS = 30_000;
/** Read by the container health check (deploy/server/docker-compose.yml). */
const ALIVE_FILE = process.env.WORKER_ALIVE_FILE ?? `${os.tmpdir()}/pmp-worker-alive`;
const startedAt = new Date();

async function beat(): Promise<void> {
  await withSystemScope((tx) =>
    tx.query(
      `INSERT INTO pmp.worker_heartbeats (name, started_at, beat_at, detail)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (name) DO UPDATE SET started_at = EXCLUDED.started_at, beat_at = now(), detail = EXCLUDED.detail`,
      [NAME, startedAt, JSON.stringify({ jobs: ["pdf", "reminders"], pid: process.pid })],
    ),
  );
  // Each container has its own hostname, so a crashed one leaves a row; clear old ones.
  await withSystemScope((tx) =>
    tx.query(`DELETE FROM pmp.worker_heartbeats WHERE beat_at < now() - interval '1 day'`),
  );
  writeFileSync(ALIVE_FILE, new Date().toISOString());
}

const heartbeat = setInterval(
  () => void beat().catch((error: unknown) => console.error("[worker] heartbeat failed", error)),
  HEARTBEAT_MS,
);

await beat();
if (!(await findLibreOffice())) {
  console.error("[worker] LibreOffice not found — PDF previews will fail until it is installed (LIBREOFFICE_PATH)");
}
await startPdfWorker();
startReminderScheduler();
console.error(`[worker] ${NAME} running · pdf previews + automatic reminders`);

/*
 * A deploy stops the container with SIGTERM: stop taking work, let the file in hand finish
 * (up to 25 s — compose gives 30), then close the pool. A conversion cut off anyway is
 * taken back by the next worker once its claim goes stale.
 */
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.error(`[worker] ${signal} — finishing current work`);
    clearInterval(heartbeat);
    void Promise.all([stopPdfWorker(), stopReminderScheduler()])
      .then(() => withSystemScope((tx) => tx.query(`DELETE FROM pmp.worker_heartbeats WHERE name = $1`, [NAME])))
      .catch((error: unknown) => console.error("[worker] shutdown", error))
      .finally(() => void closePool().finally(() => process.exit(0)));
  });
}
