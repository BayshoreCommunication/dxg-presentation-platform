import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import type pg from "pg";
import { getPool, withSystemScope } from "@pmp/db";
import { storage } from "./ingest.ts";

/**
 * PDF copies of approved presentations, made with LibreOffice (D-067).
 *
 * LibreOffice runs headless as a separate process per file. Each run gets its own
 * throwaway user profile: two `soffice` processes sharing the default profile lock
 * each other out, and a profile left behind by a crashed run poisons the next one.
 *
 * Conversion is slow — seconds per deck, minutes for a large one — so it never runs
 * inside a request. The API queues work in `pdf_conversions` and wakes the worker with a
 * Postgres NOTIFY; the **worker process** (`src/worker.ts`, D-103) drains it one file at a
 * time. The queue lives in Postgres, so a restart loses nothing, and a claim held by a
 * worker that died is taken back once it is older than a conversion can last.
 */

const TIMEOUT_MS = Number(process.env.PDF_TIMEOUT_MS ?? 180_000);

/** Formats LibreOffice's Impress/Writer filters open. Keynote imports, with lower fidelity. */
const CONVERTIBLE = new Set([".pptx", ".ppt", ".pps", ".ppsx", ".odp", ".key", ".docx", ".doc", ".odt"]);

const CANDIDATES = [
  process.env.LIBREOFFICE_PATH,
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "/opt/homebrew/bin/soffice",
  "/usr/local/bin/soffice",
  "/usr/bin/soffice",
  "/usr/bin/libreoffice",
].filter((candidate): candidate is string => Boolean(candidate));

let resolved: string | null | undefined;

/** Where `soffice` is, or null when LibreOffice is not installed. Looked up once. */
export async function findLibreOffice(): Promise<string | null> {
  if (resolved !== undefined) return resolved;
  for (const candidate of CANDIDATES) {
    try {
      await access(candidate, constants.X_OK);
      resolved = candidate;
      return resolved;
    } catch {
      // try the next one
    }
  }
  resolved = null;
  return resolved;
}

export class ConversionError extends Error {}

/**
 * One file to PDF. A PDF original is returned as it is — converting a PDF to a PDF
 * only loses fidelity. Throws `ConversionError` with a reason an operator can act on.
 */
export async function convertToPdf(body: Buffer, filename: string): Promise<Buffer> {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".pdf") return body;
  if (!CONVERTIBLE.has(extension)) {
    throw new ConversionError(`“${extension || "no extension"}” files cannot be converted to PDF.`);
  }
  const soffice = await findLibreOffice();
  if (!soffice) throw new ConversionError("Slide previews can't be made on this server yet. Contact DXG support.");

  const work = await mkdtemp(path.join(os.tmpdir(), "pmp-pdf-"));
  try {
    // A plain ASCII name: the original may hold characters the filter chokes on, and
    // LibreOffice names its output after its input.
    const input = path.join(work, `input${extension}`);
    const outDir = path.join(work, "out");
    const profile = path.join(work, "profile");
    await mkdir(outDir);
    await writeFile(input, body);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        soffice,
        [
          `-env:UserInstallation=file://${profile}`,
          "--headless",
          "--norestore",
          "--nolockcheck",
          "--convert-to",
          "pdf",
          "--outdir",
          outDir,
          input,
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new ConversionError(`Conversion took longer than ${Math.round(TIMEOUT_MS / 1000)} seconds and was stopped.`));
      }, TIMEOUT_MS);
      child.on("error", (error) => {
        clearTimeout(timer);
        console.error("[pdf] converter could not be started:", error.message);
        reject(new ConversionError("The slide preview couldn't be started. Try again later; if it keeps failing, contact DXG support."));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else {
          console.error(`[pdf] converter exited with code ${code}:`, stderr.trim().slice(0, 300));
          reject(new ConversionError("This file couldn't be turned into slides. It may be damaged or password-protected."));
        }
      });
    });

    const produced = (await readdir(outDir)).find((name) => name.toLowerCase().endsWith(".pdf"));
    if (!produced) {
      throw new ConversionError("This file couldn't be turned into slides. It may be damaged or password-protected.");
    }
    return await readFile(path.join(outDir, produced));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/* ── the queue ────────────────────────────────────────────────────────────── */

let draining = false;

/** The channel the API notifies when there is PDF work; the worker listens on it (D-103). */
export const PDF_CHANNEL = "pmp_pdf_queued";

/** Wakes the worker. Inside a transaction Postgres delivers it on commit, so the row is visible. */
export const notifyPdfWorker = (tx: pg.PoolClient) => tx.query(`SELECT pg_notify('${PDF_CHANNEL}', '')`);

/**
 * Puts these versions in line for conversion and wakes the worker. Versions already
 * converted are left alone; failed ones are retried only when `retry` is set, so a deck
 * that cannot convert is not re-run every time someone opens the builder.
 */
export async function queuePdfs(fileVersionIds: string[], retry = false): Promise<number> {
  if (fileVersionIds.length === 0) return 0;
  return withSystemScope(async (tx) => {
    const { rowCount } = await tx.query(
      `INSERT INTO pmp.pdf_conversions (file_version_id, event_id, client_id)
       SELECT fv.id, fv.event_id, fv.client_id
         FROM pmp.file_versions fv
        WHERE fv.id = ANY($1::uuid[])
       ON CONFLICT (file_version_id) DO UPDATE
          SET state = 'queued', error = NULL, updated_at = now()
        WHERE $2 AND pmp.pdf_conversions.state = 'failed'`,
      [fileVersionIds, retry],
    );
    if (rowCount) await notifyPdfWorker(tx);
    return rowCount ?? 0;
  });
}

/**
 * A claim older than the longest a conversion may run (plus a minute) belongs to a worker
 * that died mid-file — a crash, or a deploy that stopped it — so it goes back in line.
 * Only stale claims: a second worker's live job is never taken from it.
 */
const STALE_CLAIM_MS = TIMEOUT_MS + 60_000;

async function reclaimStale(): Promise<void> {
  await withSystemScope((tx) =>
    tx.query(
      `UPDATE pmp.pdf_conversions SET state = 'queued', updated_at = now()
        WHERE state = 'converting' AND updated_at < now() - make_interval(secs => $1)`,
      [STALE_CLAIM_MS / 1000],
    ),
  );
}

/**
 * The poll is the fallback for a missed notification (a dropped LISTEN connection), a
 * cheap indexed query when there is nothing to do.
 */
const POLL_MS = Number(process.env.PDF_POLL_MS ?? 5000);
let polling: NodeJS.Timeout | undefined;
let listener: pg.PoolClient | undefined;
let stopping = false;
let current: Promise<void> = Promise.resolve();

/** Starts converting — in the worker process only (D-103). */
export async function startPdfWorker(): Promise<void> {
  stopping = false;
  await reclaimStale();
  await listen();
  wake();
  polling ??= setInterval(() => {
    void reclaimStale().catch((error: unknown) => console.error("[pdf] reclaim failed", error));
    wake();
  }, POLL_MS);
}

/** Stops taking new files and waits for the one in hand, up to `graceMs`. */
export async function stopPdfWorker(graceMs = 25_000): Promise<void> {
  stopping = true;
  if (polling) clearInterval(polling);
  polling = undefined;
  listener?.release();
  listener = undefined;
  await Promise.race([current, new Promise((resolve) => setTimeout(resolve, graceMs).unref())]);
}

const wake = () => {
  if (!draining && !stopping) current = drain();
};

/** A dedicated connection that LISTENs; re-established after a drop, the poll covering the gap. */
async function listen(): Promise<void> {
  try {
    const client = await getPool().connect();
    client.on("notification", wake);
    client.on("error", (error) => {
      console.error("[pdf] listen connection lost", error.message);
      client.release(true);
      if (listener === client) listener = undefined;
      if (!stopping) setTimeout(() => void listen(), 5_000).unref();
    });
    await client.query(`LISTEN ${PDF_CHANNEL}`);
    listener = client;
  } catch (error) {
    console.error("[pdf] could not listen; polling only", error);
    if (!stopping) setTimeout(() => void listen(), 5_000).unref();
  }
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (!stopping) {
      const job = await withSystemScope(async (tx) => {
        const { rows } = await tx.query<{
          file_version_id: string;
          event_id: string;
          client_id: string;
          s3_key: string | null;
          original_filename: string | null;
        }>(
          `UPDATE pmp.pdf_conversions pc
              SET state = 'converting', attempts = attempts + 1, updated_at = now()
             FROM pmp.file_versions fv
            WHERE pc.file_version_id = fv.id
              AND pc.file_version_id = (SELECT file_version_id FROM pmp.pdf_conversions
                                         WHERE state = 'queued' ORDER BY created_at
                                         FOR UPDATE SKIP LOCKED LIMIT 1)
           RETURNING pc.file_version_id, pc.event_id, pc.client_id, fv.s3_key, fv.original_filename`,
        );
        return rows[0];
      });
      if (!job) return;
      await convertOne(job);
    }
  } catch (error) {
    console.error("pdf queue stopped", error);
  } finally {
    draining = false;
  }
}

async function convertOne(job: {
  file_version_id: string;
  event_id: string;
  client_id: string;
  s3_key: string | null;
  original_filename: string | null;
}): Promise<void> {
  try {
    if (!job.s3_key) throw new ConversionError("The file has no stored copy to convert.");
    const pdf = await convertToPdf(await storage.read(job.s3_key), job.original_filename ?? "presentation.pptx");
    const stored = await storage.put(`derived/pdf/${job.file_version_id}-${randomUUID()}.pdf`, pdf);
    await withSystemScope(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO pmp.derived_objects (file_version_id, event_id, client_id, kind, bucket, s3_key)
         VALUES ($1, $2, $3, 'pdf', $5, $4) RETURNING id`,
        // The bucket it really lives in: it was recorded as 'local' even on S3 (D-102).
        [
          job.file_version_id,
          job.event_id,
          job.client_id,
          stored.key,
          process.env.FILE_STORAGE === "s3" ? (process.env.S3_BUCKET ?? "s3") : "local",
        ],
      );
      await tx.query(
        `UPDATE pmp.pdf_conversions SET state = 'done', error = NULL, derived_object_id = $2, updated_at = now()
          WHERE file_version_id = $1`,
        [job.file_version_id, rows[0]!.id],
      );
    });
  } catch (error) {
    const message = error instanceof ConversionError ? error.message : "Conversion failed unexpectedly.";
    if (!(error instanceof ConversionError)) console.error("pdf conversion failed", job.file_version_id, error);
    await withSystemScope((tx) =>
      tx.query(
        `UPDATE pmp.pdf_conversions SET state = 'failed', error = $2, updated_at = now() WHERE file_version_id = $1`,
        [job.file_version_id, message],
      ),
    );
  }
}

/* ── reading it back ──────────────────────────────────────────────────────── */

export type PdfState = { state: "queued" | "converting" | "done" | "failed"; error: string | null; s3_key: string | null };

/** Conversion state for these versions, keyed by version id. Absent means never queued. */
export async function pdfStates(tx: pg.PoolClient, fileVersionIds: string[]): Promise<Map<string, PdfState>> {
  if (fileVersionIds.length === 0) return new Map();
  const { rows } = await tx.query<PdfState & { file_version_id: string }>(
    `SELECT pc.file_version_id, pc.state, pc.error, d.s3_key
       FROM pmp.pdf_conversions pc
       LEFT JOIN pmp.derived_objects d ON d.id = pc.derived_object_id AND d.deleted_at IS NULL
      WHERE pc.file_version_id = ANY($1::uuid[])`,
    [fileVersionIds],
  );
  return new Map(rows.map((row) => [row.file_version_id, { state: row.state, error: row.error, s3_key: row.s3_key }]));
}
