import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";
import { appendAudit } from "@pmp/db";
import { writeZip, sha256Of } from "@pmp/files";
import { archiveLifecycle, transition } from "@pmp/domain";
import type { Actor, DomainError, Result } from "@pmp/domain";
import { err, ok } from "@pmp/domain";
import { storage } from "./ingest.ts";

const ARCHIVE_ROOT = path.join(process.env.FILE_ROOT ?? ".data", "archives");

export type Candidate = {
  slot_id: string;
  title: string;
  room: string | null;
  speaker: string | null;
  file_version_id: string | null;
  version_number: number | null;
  size_bytes: string | null;
  sha256: string | null;
  s3_key: string | null;
  original_filename: string | null;
  release_permission: string;
  restricted: boolean;
  approved_at: string | null;
  approved_by: string | null;
};

export type ScopePreview = {
  included: Candidate[];
  excluded: { title: string; speaker: string | null; reason: string }[];
  total_bytes: number;
  rooms: number;
  days: number;
};

/**
 * FR-ARCH-001: approved finals only. Exclusions are counted, not silently
 * dropped — a client asking "where is my talk?" gets an answer.
 */
export async function scopePreview(tx: pg.PoolClient, eventId: string): Promise<ScopePreview> {
  const { rows } = await tx.query<Candidate>(
    `SELECT s.id AS slot_id, s.title, r.name AS room, s.restricted,
            (SELECT sp.full_name FROM pmp.speaker_assignments sa
               JOIN pmp.speakers sp ON sp.id = sa.speaker_id WHERE sa.slot_id = s.id LIMIT 1) AS speaker,
            COALESCE((SELECT sp.release_permission FROM pmp.speaker_assignments sa
               JOIN pmp.speakers sp ON sp.id = sa.speaker_id WHERE sa.slot_id = s.id LIMIT 1),
              'undecided') AS release_permission,
            fv.id AS file_version_id, fv.version_number, fv.size_bytes::text,
            encode(fv.sha256, 'hex') AS sha256, fv.s3_key, fv.original_filename,
            fv.approved_at, u.display_name AS approved_by
       FROM pmp.slots s
       JOIN pmp.sessions se ON se.id = s.session_id
       LEFT JOIN pmp.rooms r ON r.id = se.room_id
       LEFT JOIN pmp.files f ON f.slot_id = s.id
       LEFT JOIN pmp.file_versions fv ON fv.file_id = f.id AND fv.review_state = 'approved'
       LEFT JOIN pmp.users u ON u.id = fv.approved_by
      WHERE s.event_id = $1
      ORDER BY se.starts_at`,
    [eventId],
  );

  const included: Candidate[] = [];
  const excluded: ScopePreview["excluded"] = [];

  for (const row of rows) {
    if (!row.file_version_id) {
      excluded.push({ title: row.title, speaker: row.speaker, reason: "no approved version" });
    } else if (row.restricted) {
      excluded.push({ title: row.title, speaker: row.speaker, reason: "restricted from distribution" });
    } else if (row.release_permission === "none") {
      excluded.push({ title: row.title, speaker: row.speaker, reason: "speaker withheld permission" });
    } else if (row.release_permission === "pdf_only") {
      // PDF conversion is M6-2; until it exists the original must not be shipped
      // to someone whose permission covers a PDF only.
      excluded.push({
        title: row.title,
        speaker: row.speaker,
        reason: "PDF-only permission — conversion not yet available",
      });
    } else if (row.release_permission === "undecided") {
      excluded.push({ title: row.title, speaker: row.speaker, reason: "release permission not set" });
    } else {
      included.push(row);
    }
  }

  const { rows: counts } = await tx.query<{ rooms: string; days: string }>(
    `SELECT count(DISTINCT se.room_id)::text AS rooms, count(DISTINCT se.starts_at::date)::text AS days
       FROM pmp.sessions se WHERE se.event_id = $1`,
    [eventId],
  );

  return {
    included,
    excluded,
    total_bytes: included.reduce((sum, row) => sum + Number(row.size_bytes ?? 0), 0),
    rooms: Number(counts[0]?.rooms ?? 0),
    days: Number(counts[0]?.days ?? 0),
  };
}

export type BuildResult = {
  package_id: string;
  archive_state: string;
  file_count: number;
  size_bytes: number;
  sha256: string;
  excluded: number;
};

/** Builds the package and its manifest, then verifies the zip against the manifest. */
export async function buildPackage(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
): Promise<Result<BuildResult, DomainError>> {
  const { rows: eventRows } = await tx.query<{ client_id: string; name: string }>(
    `SELECT client_id, name FROM pmp.events WHERE id = $1`,
    [eventId],
  );
  if (!eventRows[0]) return err({ code: "archive.event_not_found", message: "No such event." });

  const start = transition(archiveLifecycle, { from: "draft", action: "build", actor });
  if (!start.ok) return err(start.error);

  const scope = await scopePreview(tx, eventId);

  const { rows: packageRows } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.archive_packages (event_id, client_id, scope, archive_state, built_by)
     VALUES ($1, $2, $3, 'building', $4) RETURNING id`,
    [
      eventId,
      eventRows[0].client_id,
      JSON.stringify({ rule: "approved finals only", rooms: scope.rooms, days: scope.days }),
      actor.id,
    ],
  );
  const packageId = packageRows[0]!.id;

  const entries: { name: string; body: Buffer }[] = [];
  const manifestFiles: Record<string, unknown>[] = [];

  for (const candidate of scope.included) {
    let body: Buffer;
    try {
      body = await storage.read(candidate.s3_key!);
    } catch {
      await tx.query(`UPDATE pmp.archive_packages SET archive_state = 'draft' WHERE id = $1`, [packageId]);
      return err({
        code: "archive.object_missing",
        message: `The stored file for “${candidate.title}” could not be read from storage. Nothing was packaged.`,
        detail: { slot_id: candidate.slot_id, s3_key: candidate.s3_key },
      });
    }
    const digest = sha256Of(body);
    if (candidate.sha256 && digest !== candidate.sha256) {
      await tx.query(`UPDATE pmp.archive_packages SET archive_state = 'draft' WHERE id = $1`, [packageId]);
      return err({
        code: "archive.checksum_mismatch",
        message: `The stored bytes for “${candidate.title}” no longer match their recorded checksum. Nothing was packaged.`,
      });
    }
    const entryName = `${candidate.room ?? "Unassigned"}/${candidate.original_filename ?? "presentation.pptx"}`;
    entries.push({ name: entryName, body });
    manifestFiles.push({
      path: entryName,
      talk: candidate.title,
      speaker: candidate.speaker,
      room: candidate.room,
      version: candidate.version_number,
      sha256: digest,
      size_bytes: Number(candidate.size_bytes ?? 0),
      approved_at: candidate.approved_at,
      approved_by: candidate.approved_by,
    });
  }

  const manifest = {
    event: eventRows[0].name,
    built_at: new Date().toISOString(),
    rule: "approved finals only",
    file_count: manifestFiles.length,
    excluded: scope.excluded,
    files: manifestFiles,
  };
  entries.unshift({ name: "manifest.json", body: Buffer.from(JSON.stringify(manifest, null, 2)) });

  const zip = writeZip(entries);
  const key = `${packageId}.zip`;
  await mkdir(ARCHIVE_ROOT, { recursive: true });
  await writeFile(path.join(ARCHIVE_ROOT, key), zip);

  const built = transition(archiveLifecycle, {
    from: "building",
    action: "built",
    actor: { ...actor, isMachine: true },
  });
  if (!built.ok) return err(built.error);

  await tx.query(
    `UPDATE pmp.archive_packages
        SET archive_state = $1, manifest = $2, s3_key = $3, lock_version = lock_version + 1
      WHERE id = $4`,
    [built.value.to, JSON.stringify(manifest), key, packageId],
  );
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: eventRows[0].client_id,
    actorUserId: actor.id,
    action: "archive.built",
    subjectType: "archive_package",
    subjectId: packageId,
    detail: { file_count: manifestFiles.length, excluded: scope.excluded.length, sha256: sha256Of(zip) },
  });

  return ok({
    package_id: packageId,
    archive_state: built.value.to,
    file_count: manifestFiles.length,
    size_bytes: zip.length,
    sha256: sha256Of(zip),
    excluded: scope.excluded.length,
  });
}

/** Delivery issues an expiring link; every download is logged (FR-ARCH-002). */
export async function deliverPackage(
  tx: pg.PoolClient,
  actor: Actor,
  packageId: string,
  days = 7,
): Promise<Result<{ link_expires_at: string; token: string }, DomainError>> {
  const { rows } = await tx.query<{ archive_state: string; event_id: string; client_id: string }>(
    `SELECT archive_state, event_id, client_id FROM pmp.archive_packages WHERE id = $1 FOR UPDATE`,
    [packageId],
  );
  if (!rows[0]) return err({ code: "archive.not_found", message: "No such package." });

  const decision = transition(archiveLifecycle, {
    from: rows[0].archive_state as never,
    action: "deliver",
    actor,
  });
  if (!decision.ok) return err(decision.error);

  const token = randomUUID();
  const expires = new Date(Date.now() + days * 86_400_000).toISOString();
  await tx.query(
    `UPDATE pmp.archive_packages
        SET archive_state = $1, link_expires_at = $2, lock_version = lock_version + 1
      WHERE id = $3`,
    [decision.value.to, expires, packageId],
  );
  await appendAudit(tx, {
    partitionId: rows[0].event_id,
    clientId: rows[0].client_id,
    actorUserId: actor.id,
    action: "archive.delivered",
    subjectType: "archive_package",
    subjectId: packageId,
    detail: { link_expires_at: expires, retention_days: days },
  });
  return ok({ link_expires_at: expires, token });
}

export type DownloadResult = { body: Buffer; filename: string };

export async function downloadPackage(
  tx: pg.PoolClient,
  actor: Actor,
  packageId: string,
): Promise<Result<DownloadResult, DomainError>> {
  const { rows } = await tx.query<{
    archive_state: string;
    s3_key: string | null;
    link_expires_at: string | null;
    event_id: string;
    client_id: string;
  }>(
    `SELECT archive_state, s3_key, link_expires_at, event_id, client_id
       FROM pmp.archive_packages WHERE id = $1`,
    [packageId],
  );
  const row = rows[0];
  if (!row || !row.s3_key) return err({ code: "archive.not_found", message: "No such package." });

  if (row.archive_state !== "delivered") {
    return err({
      code: "archive.not_delivered",
      message: `This package is “${row.archive_state}” — it has not been delivered to the client portal yet.`,
    });
  }
  if (row.link_expires_at && new Date(row.link_expires_at) < new Date()) {
    await tx.query(`UPDATE pmp.archive_packages SET archive_state = 'expired' WHERE id = $1`, [packageId]);
    return err({
      code: "archive.link_expired",
      message: "This download link has expired. Ask DXG to re-issue it.",
    });
  }

  const body = await readFile(path.join(ARCHIVE_ROOT, row.s3_key));

  // Every download is logged, with who and when (FR-ARCH-002).
  await tx.query(
    `INSERT INTO pmp.archive_downloads (package_id, event_id, client_id, downloaded_by)
     VALUES ($1,$2,$3,$4)`,
    [packageId, row.event_id, row.client_id, actor.id],
  );
  await appendAudit(tx, {
    partitionId: row.event_id,
    clientId: row.client_id,
    actorUserId: actor.id,
    action: "archive.downloaded",
    subjectType: "archive_package",
    subjectId: packageId,
    detail: { bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") },
  });

  return ok({ body, filename: `${packageId}.zip` });
}

export async function latestPackage(tx: pg.PoolClient, eventId: string) {
  const { rows } = await tx.query<{
    id: string;
    archive_state: string;
    manifest: { file_count?: number } | null;
    link_expires_at: string | null;
    created_at: string;
    downloads: string;
  }>(
    `SELECT p.id, p.archive_state, p.manifest, p.link_expires_at, p.created_at,
            (SELECT count(*)::text FROM pmp.archive_downloads d WHERE d.package_id = p.id) AS downloads
       FROM pmp.archive_packages p
      WHERE p.event_id = $1
      ORDER BY p.created_at DESC LIMIT 1`,
    [eventId],
  );
  return rows[0] ?? null;
}

export type DownloadRecord = { downloaded_at: string; downloaded_by: string | null };

/**
 * Who downloaded the event's latest package, and when, newest first. Every download
 * was already recorded (FR-ARCH-002); this makes the record visible where the package
 * is — the client portal and the archive builder both show it.
 */
export async function packageDownloads(tx: pg.PoolClient, eventId: string, limit = 100): Promise<DownloadRecord[]> {
  const { rows } = await tx.query<DownloadRecord>(
    `SELECT d.occurred_at AS downloaded_at, u.display_name AS downloaded_by
       FROM pmp.archive_downloads d
       LEFT JOIN pmp.users u ON u.id = d.downloaded_by
      WHERE d.package_id = (SELECT id FROM pmp.archive_packages WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1)
      ORDER BY d.occurred_at DESC
      LIMIT $2`,
    [eventId, limit],
  );
  return rows;
}
