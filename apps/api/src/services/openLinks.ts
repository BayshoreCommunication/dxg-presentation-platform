import type pg from "pg";
import { appendAudit } from "@pmp/db";
import { generateSessionToken, hashSecret } from "@pmp/auth";
import type { DomainError, Result } from "@pmp/domain";
import { err, ok } from "@pmp/domain";
import { storage } from "./ingest.ts";

/*
 * "Open in PowerPoint" (client review, D-158): the Speaker Ready Room's preview opens the deck in
 * the desk computer's own PowerPoint, where transitions, animations and video play as they will
 * in the room. PowerPoint fetches the file itself (`ms-powerpoint:ofv|u|<url>`) without the
 * staff sign-in, so it gets a link that opens one version for a few minutes. Several fetches are
 * allowed inside that time — PowerPoint asks more than once — and each is counted.
 */
export const OPEN_LINK_MINUTES = 5;

const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const TYPES: Record<string, string> = {
  pptx: PPTX,
  ppt: "application/vnd.ms-powerpoint",
  pdf: "application/pdf",
  key: "application/x-iwork-keynote-sffkey",
};
export const contentTypeOf = (filename: string): string =>
  TYPES[filename.toLowerCase().split(".").pop() ?? ""] ?? "application/octet-stream";

/** A file name PowerPoint shows in its title bar: speaker, talk and version, the original extension. */
function openName(speaker: string | null, talk: string, version: number, original: string): string {
  const dot = original.lastIndexOf(".");
  const ext = dot > 0 ? original.slice(dot).toLowerCase() : ".pptx";
  const base = [speaker, talk, `v${version}`].filter(Boolean).join(" - ");
  return `${base.replace(/[\\/:*?"<>|#%&{}~]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)}${ext}`;
}

export async function issueOpenLink(
  tx: pg.PoolClient,
  actorUserId: string,
  versionId: string,
): Promise<Result<{ path: string; filename: string; expires_at: string }, DomainError>> {
  const { rows } = await tx.query<{
    event_id: string;
    client_id: string;
    version_number: number;
    original_filename: string | null;
    processing_state: string;
    talk: string;
    speaker: string | null;
  }>(
    `SELECT fv.event_id, fv.client_id, fv.version_number, fv.original_filename, fv.processing_state, s.title AS talk,
            (SELECT sp.full_name FROM pmp.speaker_assignments sa JOIN pmp.speakers sp ON sp.id = sa.speaker_id
              WHERE sa.slot_id = s.id ORDER BY sa.created_at LIMIT 1) AS speaker
       FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id JOIN pmp.slots s ON s.id = f.slot_id
      WHERE fv.id = $1`,
    [versionId],
  );
  const version = rows[0];
  if (!version) return err({ code: "file_version.not_found", message: "This file no longer exists — it may have been removed. Refresh the page." });
  if (version.processing_state !== "stored") {
    return err({ code: "file.not_downloadable", message: "This file can't be opened — it failed the virus check or is still being checked." });
  }

  const token = generateSessionToken();
  const { rows: issued } = await tx.query<{ expires_at: string }>(
    `INSERT INTO pmp.open_links (token_hash, file_version_id, event_id, client_id, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6)) RETURNING expires_at`,
    [hashSecret(token), versionId, version.event_id, version.client_id, actorUserId, OPEN_LINK_MINUTES],
  );
  // Links that have run out are of no use to anyone; they go as new ones are made.
  await tx.query(`DELETE FROM pmp.open_links WHERE expires_at < now() - interval '1 day'`);
  const filename = openName(version.speaker, version.talk, version.version_number, version.original_filename ?? "presentation.pptx");
  await appendAudit(tx, {
    partitionId: version.event_id,
    clientId: version.client_id,
    actorUserId,
    action: "file.open_link_issued",
    subjectType: "file_version",
    subjectId: versionId,
    detail: { minutes: OPEN_LINK_MINUTES, filename },
  });
  return ok({ path: `/api/v1/open/${token}/${encodeURIComponent(filename)}`, filename, expires_at: issued[0]!.expires_at });
}

/** The file behind an open link, while it lasts. Every fetch is counted on the link. */
export async function readOpenLink(
  tx: pg.PoolClient,
  token: string,
): Promise<{ body: Buffer; contentType: string } | null> {
  const { rows } = await tx.query<{ s3_key: string; filename: string | null }>(
    `UPDATE pmp.open_links ol SET opened_count = opened_count + 1
       FROM pmp.file_versions fv
      WHERE ol.token_hash = $1 AND ol.expires_at > now() AND fv.id = ol.file_version_id
        AND fv.processing_state = 'stored'
      RETURNING fv.s3_key, fv.original_filename AS filename`,
    [hashSecret(token)],
  );
  const row = rows[0];
  if (!row) return null;
  return { body: await storage.read(row.s3_key), contentType: contentTypeOf(row.filename ?? "presentation.pptx") };
}
