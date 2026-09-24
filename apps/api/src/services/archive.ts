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
import { findLibreOffice, pdfStates } from "./pdf.ts";

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
  /**
   * Which packages this talk goes in (D-067). Full release: both. PDF-only release:
   * the PDF package alone — the original deck must not reach someone whose permission
   * covers a PDF only.
   */
  formats: ("pptx" | "pdf")[];
};

export type PdfProgress = {
  /** Talks that belong in the PDF package. */
  eligible: number;
  converted: number;
  /** Queued or converting right now. */
  in_progress: number;
  /** Approved but never queued — made before conversion existed, or queued manually. */
  not_started: number;
  failed: { title: string; speaker: string | null; error: string }[];
  /** Whether LibreOffice is available to the server. */
  converter_available: boolean;
};

export type ScopePreview = {
  included: Candidate[];
  excluded: { title: string; speaker: string | null; reason: string }[];
  total_bytes: number;
  rooms: number;
  days: number;
  pptx_count: number;
  pdf: PdfProgress;
  /** Emails included (D-069). */
  emails: number;
  /** Earlier versions included in the PowerPoint package (D-069). */
  earlier_versions: number;
};

/**
 * FR-ARCH-001: approved finals only. Exclusions are counted, not silently
 * dropped — a client asking "where is my talk?" gets an answer.
 */
export async function scopePreview(tx: pg.PoolClient, eventId: string): Promise<ScopePreview> {
  const { rows } = await tx.query<Omit<Candidate, "formats">>(
    `SELECT s.id AS slot_id, s.title, r.name AS room, s.restricted,
            -- Every presenter, and the most restrictive of their permissions (D-089): a
            -- co-presented talk is shared only as far as *each* presenter agreed. This read
            -- one presenter with LIMIT 1 and no order, so which of them decided was chance.
            (SELECT string_agg(sp.full_name, ', ' ORDER BY sp.full_name)
               FROM pmp.speaker_assignments sa JOIN pmp.speakers sp ON sp.id = sa.speaker_id
              WHERE sa.slot_id = s.id) AS speaker,
            (SELECT CASE
                      WHEN count(*) = 0 THEN 'undecided'
                      WHEN bool_or(sp.release_permission = 'none') THEN 'none'
                      WHEN bool_or(sp.release_permission = 'undecided') THEN 'undecided'
                      WHEN bool_or(sp.release_permission = 'pdf_only') THEN 'pdf_only'
                      ELSE 'full'
                    END
               FROM pmp.speaker_assignments sa JOIN pmp.speakers sp ON sp.id = sa.speaker_id
              WHERE sa.slot_id = s.id) AS release_permission,
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
    } else if (row.release_permission === "undecided") {
      excluded.push({ title: row.title, speaker: row.speaker, reason: "release permission not set" });
    } else if (row.release_permission === "pdf_only") {
      included.push({ ...row, formats: ["pdf"] });
    } else {
      included.push({ ...row, formats: ["pptx", "pdf"] });
    }
  }

  const forPdf = included.filter((row) => row.formats.includes("pdf"));
  const states = await pdfStates(tx, forPdf.map((row) => row.file_version_id!));
  const pdf: PdfProgress = {
    eligible: forPdf.length,
    converted: 0,
    in_progress: 0,
    not_started: 0,
    failed: [],
    converter_available: (await findLibreOffice()) !== null,
  };
  for (const row of forPdf) {
    const state = states.get(row.file_version_id!);
    if (!state) pdf.not_started += 1;
    else if (state.state === "done" && state.s3_key) pdf.converted += 1;
    else if (state.state === "failed") pdf.failed.push({ title: row.title, speaker: row.speaker, error: state.error ?? "" });
    else pdf.in_progress += 1;
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
    pptx_count: included.filter((row) => row.formats.includes("pptx")).length,
    pdf,
    emails: (await archiveEmails(tx, eventId)).length,
    earlier_versions: (await earlierVersions(tx, included.filter((row) => row.formats.includes("pptx")))).length,
  };
}

/**
 * The event's emails for the archive (D-069): everything sent, except mail about a
 * speaker whose talks are kept out — no release permission, permission not set, or
 * every talk restricted. Their files are withheld, so their correspondence is too.
 * Bodies are stored with personal sign-in links already removed (migration 014).
 */
export type ArchiveEmail = {
  sent_at: string | null;
  to_address: string;
  speaker: string | null;
  subject: string;
  status: string;
  body: string | null;
};

export async function archiveEmails(tx: pg.PoolClient, eventId: string): Promise<ArchiveEmail[]> {
  const { rows } = await tx.query<ArchiveEmail>(
    `SELECT COALESCE(c.sent_at, c.created_at)::text AS sent_at, c.to_address::text AS to_address,
            sp.full_name AS speaker, c.subject, c.status, c.body
       FROM pmp.communications c
       LEFT JOIN pmp.speakers sp ON sp.id = c.speaker_id
      WHERE c.event_id = $1
        AND (sp.id IS NULL OR (
              sp.release_permission IN ('full', 'pdf_only')
              AND EXISTS (SELECT 1 FROM pmp.speaker_assignments sa
                            JOIN pmp.slots s ON s.id = sa.slot_id
                           WHERE sa.speaker_id = sp.id AND s.restricted = false)))
      ORDER BY COALESCE(c.sent_at, c.created_at)`,
    [eventId],
  );
  return rows;
}

/**
 * Every earlier version of the talks in the PowerPoint package (D-069) — the history,
 * not just the final. Only versions that passed the malware scan (`stored`): a
 * quarantined file never leaves the platform, archive or not.
 */
export type EarlierVersion = {
  slot_id: string;
  title: string;
  room: string | null;
  version_number: number;
  review_state: string;
  sha256: string;
  s3_key: string;
  original_filename: string | null;
};

export async function earlierVersions(
  tx: pg.PoolClient,
  finals: { slot_id: string; file_version_id: string | null }[],
): Promise<EarlierVersion[]> {
  if (finals.length === 0) return [];
  const { rows } = await tx.query<EarlierVersion>(
    `SELECT s.id AS slot_id, s.title, r.name AS room, fv.version_number, fv.review_state,
            encode(fv.sha256, 'hex') AS sha256, fv.s3_key, fv.original_filename
       FROM pmp.file_versions fv
       JOIN pmp.files f ON f.id = fv.file_id
       JOIN pmp.slots s ON s.id = f.slot_id
       JOIN pmp.sessions se ON se.id = s.session_id
       LEFT JOIN pmp.rooms r ON r.id = se.room_id
      WHERE s.id = ANY($1::uuid[])
        AND fv.id <> ALL($2::uuid[])
        AND fv.processing_state = 'stored'
        AND fv.s3_key IS NOT NULL
      ORDER BY s.id, fv.version_number`,
    [finals.map((row) => row.slot_id), finals.map((row) => row.file_version_id).filter(Boolean)],
  );
  return rows;
}

/** A name safe to use as a folder or file in a zip, from free text. */
const safeName = (value: string) => value.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "untitled";

/** The emails as zip entries: one readable text file each, plus a spreadsheet log. */
function emailEntries(emails: ArchiveEmail[]): { name: string; body: Buffer }[] {
  if (emails.length === 0) return [];
  const csv = (value: string | null) => `"${(value ?? "").replace(/"/g, '""')}"`;
  const log = [
    "sent_at,to,speaker,subject,status",
    ...emails.map((mail) => [mail.sent_at, mail.to_address, mail.speaker, mail.subject, mail.status].map(csv).join(",")),
  ].join("\n");
  const entries = [{ name: "emails/emails.csv", body: Buffer.from(log) }];
  emails.forEach((mail, index) => {
    const text = [
      `To: ${mail.speaker ? `${mail.speaker} <${mail.to_address}>` : mail.to_address}`,
      `Subject: ${mail.subject}`,
      `Sent: ${mail.sent_at ?? "not sent"}`,
      `Status: ${mail.status}`,
      "",
      mail.body ?? "(The text of this email was not recorded.)",
    ].join("\n");
    const stamp = (mail.sent_at ?? "").slice(0, 16).replace(/[:T ]/g, "-");
    entries.push({
      name: `emails/${String(index + 1).padStart(3, "0")} ${stamp} ${safeName(mail.speaker ?? mail.to_address)} - ${safeName(mail.subject)}.txt`,
      body: Buffer.from(text),
    });
  });
  return entries;
}

/** The approved versions that belong in the PDF package — what "Convert to PDF" queues. */
export async function pdfCandidates(tx: pg.PoolClient, eventId: string): Promise<string[]> {
  const scope = await scopePreview(tx, eventId);
  return scope.included.filter((row) => row.formats.includes("pdf")).map((row) => row.file_version_id!);
}

export type BuildResult = {
  package_id: string;
  archive_state: string;
  file_count: number;
  size_bytes: number;
  sha256: string;
  excluded: number;
  pdf_file_count: number;
  pdf_not_converted: number;
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

  for (const candidate of scope.included.filter((row) => row.formats.includes("pptx"))) {
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

  /*
   * Earlier versions, in the PowerPoint package only (D-069): the history of each talk,
   * each checked against its recorded checksum like the finals. A version that fails
   * the check stops the build — nothing unverified is shipped.
   */
  const history = await earlierVersions(tx, scope.included.filter((row) => row.formats.includes("pptx")));
  const historyFiles: Record<string, unknown>[] = [];
  for (const version of history) {
    let body: Buffer;
    try {
      body = await storage.read(version.s3_key);
    } catch {
      await tx.query(`UPDATE pmp.archive_packages SET archive_state = 'draft' WHERE id = $1`, [packageId]);
      return err({
        code: "archive.object_missing",
        message: `Version ${version.version_number} of “${version.title}” could not be read from storage. Nothing was packaged.`,
      });
    }
    if (sha256Of(body) !== version.sha256) {
      await tx.query(`UPDATE pmp.archive_packages SET archive_state = 'draft' WHERE id = $1`, [packageId]);
      return err({
        code: "archive.checksum_mismatch",
        message: `Version ${version.version_number} of “${version.title}” no longer matches its checksum. Nothing was packaged.`,
      });
    }
    const entryName = `${version.room ?? "Unassigned"}/earlier versions/${safeName(version.title)}/v${version.version_number} ${version.original_filename ?? "presentation.pptx"}`;
    entries.push({ name: entryName, body });
    historyFiles.push({
      path: entryName,
      talk: version.title,
      version: version.version_number,
      review_state: version.review_state,
      sha256: version.sha256,
      size_bytes: body.length,
    });
  }

  // The event's emails go in both packages (D-069).
  const emails = await archiveEmails(tx, eventId);
  const mailEntries = emailEntries(emails);

  /*
   * The PDF package: every talk whose permission allows a PDF and whose PDF exists.
   * Talks still converting, or whose conversion failed, are named in its manifest
   * rather than silently missing — the same rule the exclusions follow.
   */
  const pdfEntries: { name: string; body: Buffer }[] = [];
  const pdfFiles: Record<string, unknown>[] = [];
  const notConverted: { talk: string; speaker: string | null; reason: string }[] = [];
  const forPdf = scope.included.filter((row) => row.formats.includes("pdf"));
  const states = await pdfStates(tx, forPdf.map((row) => row.file_version_id!));
  for (const candidate of forPdf) {
    const state = states.get(candidate.file_version_id!);
    if (!state || state.state !== "done" || !state.s3_key) {
      notConverted.push({
        talk: candidate.title,
        speaker: candidate.speaker,
        reason:
          state?.state === "failed"
            ? `conversion failed: ${state.error ?? "unknown"}`
            : state
              ? "still converting"
              : "not converted yet",
      });
      continue;
    }
    let body: Buffer;
    try {
      body = await storage.read(state.s3_key);
    } catch {
      notConverted.push({ talk: candidate.title, speaker: candidate.speaker, reason: "PDF copy missing from storage" });
      continue;
    }
    const base = (candidate.original_filename ?? "presentation").replace(/\.[^.]+$/, "");
    const entryName = `${candidate.room ?? "Unassigned"}/${base}.pdf`;
    pdfEntries.push({ name: entryName, body });
    pdfFiles.push({
      path: entryName,
      talk: candidate.title,
      speaker: candidate.speaker,
      room: candidate.room,
      version: candidate.version_number,
      sha256: sha256Of(body),
      size_bytes: body.length,
      pdf_only: !candidate.formats.includes("pptx"),
    });
  }

  const manifest = {
    event: eventRows[0].name,
    built_at: new Date().toISOString(),
    rule: "approved finals only",
    file_count: manifestFiles.length,
    excluded: scope.excluded,
    files: manifestFiles,
    earlier_versions: historyFiles,
    emails: emails.length,
    pdf: { file_count: pdfFiles.length, eligible: forPdf.length, not_converted: notConverted },
  };
  entries.unshift({ name: "manifest.json", body: Buffer.from(JSON.stringify(manifest, null, 2)) });
  entries.push(...mailEntries);
  const pdfManifest = {
    event: eventRows[0].name,
    built_at: manifest.built_at,
    rule: "approved finals only, as PDF",
    file_count: pdfFiles.length,
    excluded: scope.excluded,
    not_converted: notConverted,
    files: pdfFiles,
    emails: emails.length,
  };
  pdfEntries.unshift({ name: "manifest.json", body: Buffer.from(JSON.stringify(pdfManifest, null, 2)) });
  pdfEntries.push(...mailEntries);

  const zip = writeZip(entries);
  const key = `${packageId}.zip`;
  const pdfZip = writeZip(pdfEntries);
  const pdfKey = `${packageId}-pdf.zip`;
  await mkdir(ARCHIVE_ROOT, { recursive: true });
  await writeFile(path.join(ARCHIVE_ROOT, key), zip);
  await writeFile(path.join(ARCHIVE_ROOT, pdfKey), pdfZip);

  const built = transition(archiveLifecycle, {
    from: "building",
    action: "built",
    actor: { ...actor, isMachine: true },
  });
  if (!built.ok) return err(built.error);

  await tx.query(
    `UPDATE pmp.archive_packages
        SET archive_state = $1, manifest = $2, s3_key = $3, pdf_s3_key = $5, lock_version = lock_version + 1
      WHERE id = $4`,
    [built.value.to, JSON.stringify(manifest), key, packageId, pdfKey],
  );
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: eventRows[0].client_id,
    actorUserId: actor.id,
    action: "archive.built",
    subjectType: "archive_package",
    subjectId: packageId,
    detail: {
      file_count: manifestFiles.length,
      pdf_file_count: pdfFiles.length,
      pdf_not_converted: notConverted.length,
      excluded: scope.excluded.length,
      sha256: sha256Of(zip),
      pdf_sha256: sha256Of(pdfZip),
    },
  });

  return ok({
    package_id: packageId,
    archive_state: built.value.to,
    file_count: manifestFiles.length,
    size_bytes: zip.length,
    sha256: sha256Of(zip),
    excluded: scope.excluded.length,
    pdf_file_count: pdfFiles.length,
    pdf_not_converted: notConverted.length,
  });
}

/** Delivery issues an expiring link; every download is logged (FR-ARCH-002). */
/** How long the client's download link lasts: 30 days from the event's end (D-069). */
export const RETENTION_DAYS = 30;
/** A package delivered late still gets at least this long. */
const MINIMUM_DAYS = 7;

/**
 * When the link expires: the end of the event's last day plus 30 days. If the package
 * is delivered so late that less than a week of that remains, it gets a week from
 * delivery instead — a link that dies the day it arrives is not a delivery.
 */
export function linkExpiry(endsOn: string, now = new Date()): Date {
  const fromEvent = new Date(`${endsOn}T23:59:59Z`);
  fromEvent.setUTCDate(fromEvent.getUTCDate() + RETENTION_DAYS);
  const floor = new Date(now.getTime() + MINIMUM_DAYS * 86_400_000);
  return fromEvent > floor ? fromEvent : floor;
}

export async function deliverPackage(
  tx: pg.PoolClient,
  actor: Actor,
  packageId: string,
): Promise<Result<{ link_expires_at: string; token: string }, DomainError>> {
  const { rows } = await tx.query<{ archive_state: string; event_id: string; client_id: string; ends_on: string }>(
    `SELECT p.archive_state, p.event_id, p.client_id, e.ends_on::text AS ends_on
       FROM pmp.archive_packages p JOIN pmp.events e ON e.id = p.event_id
      WHERE p.id = $1 FOR UPDATE OF p`,
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
  const expires = linkExpiry(rows[0].ends_on).toISOString();
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
    detail: { link_expires_at: expires, retention: `${RETENTION_DAYS} days from event end (${rows[0].ends_on})` },
  });
  return ok({ link_expires_at: expires, token });
}

export type DownloadResult = { body: Buffer; filename: string };

export async function downloadPackage(
  tx: pg.PoolClient,
  actor: Actor,
  packageId: string,
  format: "pptx" | "pdf" = "pptx",
): Promise<Result<DownloadResult, DomainError>> {
  const { rows } = await tx.query<{
    archive_state: string;
    s3_key: string | null;
    pdf_s3_key: string | null;
    link_expires_at: string | null;
    event_id: string;
    client_id: string;
  }>(
    `SELECT archive_state, s3_key, pdf_s3_key, link_expires_at, event_id, client_id
       FROM pmp.archive_packages WHERE id = $1`,
    [packageId],
  );
  const row = rows[0];
  if (!row || !row.s3_key) return err({ code: "archive.not_found", message: "No such package." });
  const objectKey = format === "pdf" ? row.pdf_s3_key : row.s3_key;
  if (!objectKey) {
    return err({
      code: "archive.not_found",
      message: "This package was built before PDF packages existed. Rebuild it to get a PDF package.",
    });
  }

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

  const body = await readFile(path.join(ARCHIVE_ROOT, objectKey));

  // Every download is logged, with who and when (FR-ARCH-002).
  await tx.query(
    `INSERT INTO pmp.archive_downloads (package_id, event_id, client_id, downloaded_by, format)
     VALUES ($1,$2,$3,$4,$5)`,
    [packageId, row.event_id, row.client_id, actor.id, format],
  );
  await appendAudit(tx, {
    partitionId: row.event_id,
    clientId: row.client_id,
    actorUserId: actor.id,
    action: "archive.downloaded",
    subjectType: "archive_package",
    subjectId: packageId,
    detail: { format, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") },
  });

  return ok({ body, filename: format === "pdf" ? `${packageId}-pdf.zip` : `${packageId}.zip` });
}

export async function latestPackage(tx: pg.PoolClient, eventId: string) {
  const { rows } = await tx.query<{
    id: string;
    archive_state: string;
    manifest: { file_count?: number } | null;
    link_expires_at: string | null;
    created_at: string;
    downloads: string;
    has_pdf: boolean;
  }>(
    `SELECT p.id, p.archive_state, p.manifest, p.link_expires_at, p.created_at, (p.pdf_s3_key IS NOT NULL) AS has_pdf,
            (SELECT count(*)::text FROM pmp.archive_downloads d WHERE d.package_id = p.id) AS downloads
       FROM pmp.archive_packages p
      WHERE p.event_id = $1
      ORDER BY p.created_at DESC LIMIT 1`,
    [eventId],
  );
  return rows[0] ?? null;
}

export type DownloadRecord = { downloaded_at: string; downloaded_by: string | null; format: "pptx" | "pdf" };

/**
 * Who downloaded the event's latest package, and when, newest first. Every download
 * was already recorded (FR-ARCH-002); this makes the record visible where the package
 * is — the client portal and the archive builder both show it.
 */
export async function packageDownloads(tx: pg.PoolClient, eventId: string, limit = 100): Promise<DownloadRecord[]> {
  const { rows } = await tx.query<DownloadRecord>(
    `SELECT d.occurred_at AS downloaded_at, u.display_name AS downloaded_by, d.format
       FROM pmp.archive_downloads d
       LEFT JOIN pmp.users u ON u.id = d.downloaded_by
      WHERE d.package_id = (SELECT id FROM pmp.archive_packages WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1)
      ORDER BY d.occurred_at DESC
      LIMIT $2`,
    [eventId, limit],
  );
  return rows;
}
