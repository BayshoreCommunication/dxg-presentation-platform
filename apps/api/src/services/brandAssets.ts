import { randomUUID } from "node:crypto";
import type pg from "pg";
import { appendAudit } from "@pmp/db";
import type { Actor, DomainError, Result } from "@pmp/domain";
import { atLeast, err, hasAnyRole, ok } from "@pmp/domain";
import { DevSignatureScanner, readZipEntries } from "@pmp/files";
import { storage } from "./ingest.ts";

/**
 * The event header image and the slide template (D-093).
 *
 * Step 4 of the wizard offered "Event header & slide template · Upload…" as a disabled
 * placeholder (M1-4): nothing stored them and nothing showed them. Now:
 *   - **header** — a PNG, JPEG or WebP banner, shown across the top of the speaker portal;
 *   - **template** — a PowerPoint template (.pptx / .potx) speakers download from the
 *     portal to build their deck on.
 *
 * Each is one file per event, replaced by uploading again. The bytes are checked for what
 * they claim to be (never trusting the extension), scanned for malware like every speaker
 * upload, and stored under the event; the event's `branding` records the file's name,
 * size, type and storage key. A macro-enabled deck is refused — macros are blocked for
 * speakers' files too.
 */
export type AssetKind = "header" | "template";
export const ASSET_KINDS: readonly AssetKind[] = ["header", "template"];

export type AssetRecord = {
  key: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_at: string;
};

const EDITORS = atLeast("presentation_manager");
const LIMITS: Record<AssetKind, number> = { header: 5 * 1024 * 1024, template: 50 * 1024 * 1024 };
const scanner = new DevSignatureScanner();

const bad = (message: string): DomainError => ({ code: "events.bad_asset", message });

/** What the bytes are, from their first bytes — the name and the browser's word are not trusted. */
function sniff(kind: AssetKind, body: Buffer, fileName: string): { contentType: string } | DomainError {
  if (kind === "header") {
    if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { contentType: "image/png" };
    }
    if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return { contentType: "image/jpeg" };
    if (body.subarray(0, 4).toString("latin1") === "RIFF" && body.subarray(8, 12).toString("latin1") === "WEBP") {
      return { contentType: "image/webp" };
    }
    return bad("The header must be a PNG, JPEG or WebP image.");
  }

  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pptm") || lower.endsWith(".potm")) {
    return bad("Macro-enabled templates are not accepted. Save it as .pptx or .potx.");
  }
  if (body.subarray(0, 2).toString("latin1") !== "PK") {
    return bad("The slide template must be a PowerPoint file (.pptx or .potx).");
  }
  let names: string[];
  try {
    names = readZipEntries(body).map((entry) => entry.name);
  } catch {
    return bad("The slide template could not be opened. Save it again from PowerPoint and retry.");
  }
  if (!names.includes("[Content_Types].xml") || !names.some((name) => name.startsWith("ppt/"))) {
    return bad("The slide template must be a PowerPoint file (.pptx or .potx).");
  }
  if (names.some((name) => name.toLowerCase().endsWith("vbaproject.bin"))) {
    return bad("This template contains macros, which are blocked. Save it without macros (.pptx or .potx).");
  }
  return {
    contentType: lower.endsWith(".potx")
      ? "application/vnd.openxmlformats-officedocument.presentationml.template"
      : "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
}

/** A name that is safe to echo into a header and a page: no path, no control characters. */
const cleanName = (raw: string, kind: AssetKind): string => {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = [...base]
    .filter((char) => char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) !== 0x7f && char !== '"')
    .join("")
    .trim()
    .slice(0, 200);
  return cleaned || (kind === "header" ? "header" : "template.pptx");
};

export async function putAsset(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  kind: AssetKind,
  input: { body: unknown; fileName: string },
): Promise<Result<AssetRecord, DomainError>> {
  if (!hasAnyRole(actor, EDITORS)) {
    return err({ code: "events.forbidden", message: "Changing the event's branding needs a presentation manager or above." });
  }
  const { rows } = await tx.query<{ client_id: string }>(`SELECT client_id FROM pmp.events WHERE id = $1`, [eventId]);
  const event = rows[0];
  if (!event) return err({ code: "events.not_found", message: "No such event." });

  const body = input.body;
  if (!Buffer.isBuffer(body) || body.length === 0) return err(bad("The file is empty."));
  if (body.length > LIMITS[kind]) {
    return err(bad(`That file is too large — the ${kind === "header" ? "header" : "template"} limit is ${LIMITS[kind] / 1024 / 1024} MB.`));
  }
  const fileName = cleanName(input.fileName, kind);
  const sniffed = sniff(kind, body, fileName);
  if ("code" in sniffed) return err(sniffed);

  const scan = await scanner.scan(body);
  if (scan.verdict !== "clean") {
    return err(bad(scan.verdict === "infected" ? "The file failed the security scan and was not stored." : "The security scan could not run; nothing was stored."));
  }

  const stored = await storage.put(`events/${eventId}/branding/${kind}-${randomUUID()}`, body);
  const record: AssetRecord = {
    key: stored.key,
    file_name: fileName,
    content_type: sniffed.contentType,
    size_bytes: stored.size,
    uploaded_at: new Date().toISOString(),
  };
  await tx.query(
    `UPDATE pmp.events SET branding = COALESCE(branding, '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb),
            lock_version = lock_version + 1
      WHERE id = $1`,
    [eventId, kind, JSON.stringify(record)],
  );
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: event.client_id,
    actorUserId: actor.id,
    action: "events.asset_uploaded",
    subjectType: "event",
    subjectId: eventId,
    detail: { kind, file_name: fileName, size_bytes: stored.size, sha256: stored.sha256 },
  });
  return ok(record);
}

export async function removeAsset(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  kind: AssetKind,
): Promise<Result<{ removed: true }, DomainError>> {
  if (!hasAnyRole(actor, EDITORS)) {
    return err({ code: "events.forbidden", message: "Changing the event's branding needs a presentation manager or above." });
  }
  const { rows } = await tx.query<{ client_id: string }>(
    `UPDATE pmp.events SET branding = branding - $2::text, lock_version = lock_version + 1
      WHERE id = $1 RETURNING client_id`,
    [eventId, kind],
  );
  if (!rows[0]) return err({ code: "events.not_found", message: "No such event." });
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: rows[0].client_id,
    actorUserId: actor.id,
    action: "events.asset_removed",
    subjectType: "event",
    subjectId: eventId,
    detail: { kind },
  });
  // The stored bytes are kept: the audit record names them, and storage is content we
  // never delete from a request path (the archive and S3 lifecycle own that).
  return ok({ removed: true });
}

/** The asset's record, or null — for streaming it to staff or to the event's speakers. */
export async function assetOf(tx: pg.PoolClient, eventId: string, kind: AssetKind): Promise<AssetRecord | null> {
  const { rows } = await tx.query<{ asset: AssetRecord | null }>(
    `SELECT branding -> $2::text AS asset FROM pmp.events WHERE id = $1`,
    [eventId, kind],
  );
  const asset = rows[0]?.asset;
  return asset && typeof asset === "object" && typeof asset.key === "string" ? asset : null;
}

export const readAsset = (asset: AssetRecord): Promise<Buffer> => storage.read(asset.key);
