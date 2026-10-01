import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { appendAudit } from "@pmp/db";
import type { Actor, DomainError, Result } from "@pmp/domain";
import { atLeast, err, hasAnyRole, ok } from "@pmp/domain";
import { checkAddress } from "@pmp/email";
import type { EmailLook } from "@pmp/email";
import { scanner, storage } from "./ingest.ts";
import { imageSize } from "./brandAssets.ts";

/**
 * How an event's speaker emails look (D-138), after Preseria's "Customize Email Template":
 * the event's banner on top, a button to the speaker's upload page, and the event's own
 * sender name and reply-to address. Staff set these on the Communications screen.
 *
 * The banner is a branding asset (`email_banner`, brandAssets.ts). It is served from a
 * public address — mail clients fetch images without anyone's sign-in — that names the
 * event and a fingerprint of the stored file, so a replaced banner is a new address and no
 * client shows a stale one.
 */
const PORTAL_BASE = process.env.PORTAL_BASE ?? "http://localhost:3001";
/** Where the API answers for mail clients: the speakers' site proxies /api (Caddyfile). */
const PUBLIC_API_BASE = process.env.PUBLIC_API_BASE ?? (PORTAL_BASE.includes("localhost") ? "http://localhost:4000" : PORTAL_BASE);

const EDITORS = atLeast("presentation_manager");

export type EmailSettings = {
  /** Shown as who the email is from, e.g. "MedTech Forward 2026 organisers". */
  sender_name: string | null;
  /** Where replies go; empty means the platform's own reply-to address. */
  reply_to: string | null;
};

export type EmailLookPayload = EmailLook & { from_name: string | null; reply_to: string | null };

type Row = { name: string; client_id: string; settings: Partial<EmailSettings> | null; banner_key: string | null };

async function rowOf(tx: pg.PoolClient, eventId: string): Promise<Row | undefined> {
  const { rows } = await tx.query<Row>(
    `SELECT name, client_id, branding -> 'email_settings' AS settings, branding -> 'email_banner' ->> 'key' AS banner_key
       FROM pmp.events WHERE id = $1`,
    [eventId],
  );
  return rows[0];
}

const settingsOf = (row: Row): EmailSettings => ({
  sender_name: typeof row.settings?.sender_name === "string" && row.settings.sender_name ? row.settings.sender_name : null,
  reply_to: typeof row.settings?.reply_to === "string" && row.settings.reply_to ? row.settings.reply_to : null,
});

export const bannerUrl = (eventId: string, key: string): string =>
  `${PUBLIC_API_BASE}/api/v1/email-banner/${eventId}?v=${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;

export async function emailSettings(
  tx: pg.PoolClient,
  eventId: string,
): Promise<(EmailSettings & { banner_url: string | null }) | null> {
  const row = await rowOf(tx, eventId);
  if (!row) return null;
  return { ...settingsOf(row), banner_url: row.banner_key ? bannerUrl(eventId, row.banner_key) : null };
}

export async function updateEmailSettings(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  input: { sender_name?: unknown; reply_to?: unknown },
): Promise<Result<EmailSettings, DomainError>> {
  if (!hasAnyRole(actor, EDITORS)) {
    return err({ code: "comms.forbidden", message: "Changing how emails look needs a presentation manager or above." });
  }
  const row = await rowOf(tx, eventId);
  if (!row) return err({ code: "events.not_found", message: "This event no longer exists — it may have been removed. Refresh the page." });

  const name = typeof input.sender_name === "string" ? input.sender_name.replace(/\s+/g, " ").trim() : "";
  if (name.length > 70) {
    return err({ code: "comms.settings_invalid", message: "Keep the sender name to 70 characters or fewer." });
  }
  if (/[<>"\\@]/.test(name)) {
    return err({
      code: "comms.settings_invalid",
      message: "The sender name is a name, not an address — leave out @, quotes and angle brackets.",
    });
  }
  const typed = typeof input.reply_to === "string" ? input.reply_to.trim() : "";
  let replyTo: string | null = null;
  if (typed) {
    const checked = checkAddress(typed);
    if (!checked.ok) {
      return err({
        code: "comms.settings_invalid",
        message: `The reply-to address: ${checked.reason}${checked.suggestion ? ` Did you mean ${checked.suggestion}?` : ""}`,
      });
    }
    replyTo = checked.address;
  }

  const next: EmailSettings = { sender_name: name || null, reply_to: replyTo };
  await tx.query(
    `UPDATE pmp.events SET branding = COALESCE(branding, '{}'::jsonb) || jsonb_build_object('email_settings', $2::jsonb),
            lock_version = lock_version + 1
      WHERE id = $1`,
    [eventId, JSON.stringify(next)],
  );
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: row.client_id,
    actorUserId: actor.id,
    action: "comms.email_settings_updated",
    subjectType: "event",
    subjectId: eventId,
    detail: { before: settingsOf(row), after: next },
  });
  return ok(next);
}

/**
 * The look a speaker email is queued with. `button` is that email's one action — the
 * speaker's own upload link, usually; a receipt has none. The dispatcher renders it.
 */
export async function lookFor(
  tx: pg.PoolClient,
  eventId: string,
  button: { label: string; url: string } | null,
): Promise<EmailLookPayload> {
  const row = await rowOf(tx, eventId);
  const settings = row ? settingsOf(row) : { sender_name: null, reply_to: null };
  return {
    banner_url: row?.banner_key ? bannerUrl(eventId, row.banner_key) : null,
    button,
    event_name: row?.name ?? null,
    from_name: settings.sender_name,
    reply_to: settings.reply_to,
  };
}

/* ── images inside a formatted message (D-139) ───────────────────────────── */

export type EmailImage = { key: string; content_type: string; file_name: string; uploaded_at: string };

const IMAGE_LIMIT = 2 * 1024 * 1024;

export const emailImageUrl = (eventId: string, imageId: string): string =>
  `${PUBLIC_API_BASE}/api/v1/email-image/${eventId}/${imageId}`;

/**
 * An image put into a message with the editor's image button. Mail clients show images
 * from a web address — not ones pasted into the email itself — so it is stored with the
 * event and served publicly, like the banner. PNG, JPEG or GIF, at most 2 MB and 2400 px
 * wide, virus-scanned.
 */
export async function putEmailImage(
  tx: pg.PoolClient,
  actor: Actor,
  eventId: string,
  input: { body: unknown; fileName: string },
): Promise<Result<{ url: string }, DomainError>> {
  if (!hasAnyRole(actor, EDITORS)) {
    return err({ code: "comms.forbidden", message: "Adding images to emails needs a presentation manager or above." });
  }
  const row = await rowOf(tx, eventId);
  if (!row) return err({ code: "events.not_found", message: "This event no longer exists — it may have been removed. Refresh the page." });
  const body = input.body;
  const bad = (message: string) => err({ code: "comms.bad_image", message });
  if (!Buffer.isBuffer(body) || body.length === 0) return bad("The image is empty.");
  if (body.length > IMAGE_LIMIT) return bad("That image is too large — the limit is 2 MB. Make it smaller and try again.");
  const png = body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  const gif = body.subarray(0, 6).toString("latin1") === "GIF89a" || body.subarray(0, 6).toString("latin1") === "GIF87a";
  if (!png && !jpeg && !gif) return bad("Emails can show PNG, JPG or GIF images.");
  const size = gif ? { width: body.readUInt16LE(6), height: body.readUInt16LE(8) } : imageSize(body);
  if (!size) return bad("The image could not be read. Save it again as PNG or JPG and retry.");
  if (size.width > 2400) return bad(`That image is ${size.width} px wide — keep it to 2400 px or less.`);

  const scan = await scanner.scan(body);
  if (scan.verdict !== "clean") {
    return bad(scan.verdict === "infected" ? "The image failed the security scan and was not stored." : "The security scan could not run; nothing was stored.");
  }
  const id = randomUUID();
  const stored = await storage.put(`events/${eventId}/email-images/${id}`, body);
  const record: EmailImage = {
    key: stored.key,
    content_type: png ? "image/png" : jpeg ? "image/jpeg" : "image/gif",
    file_name: input.fileName.replace(/[^\w .()-]/g, "").slice(0, 120) || "image",
    uploaded_at: new Date().toISOString(),
  };
  await tx.query(
    `UPDATE pmp.events
        SET branding = jsonb_set(COALESCE(branding, '{}'::jsonb), '{email_images}',
                                 COALESCE(branding -> 'email_images', '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb)),
            lock_version = lock_version + 1
      WHERE id = $1`,
    [eventId, id, JSON.stringify(record)],
  );
  await appendAudit(tx, {
    partitionId: eventId,
    clientId: row.client_id,
    actorUserId: actor.id,
    action: "comms.email_image_uploaded",
    subjectType: "event",
    subjectId: eventId,
    detail: { image_id: id, file_name: record.file_name, size_bytes: stored.size, sha256: stored.sha256 },
  });
  return ok({ url: emailImageUrl(eventId, id) });
}

export async function emailImageOf(tx: pg.PoolClient, eventId: string, imageId: string): Promise<EmailImage | null> {
  const { rows } = await tx.query<{ image: EmailImage | null }>(
    `SELECT branding -> 'email_images' -> $2::text AS image FROM pmp.events WHERE id = $1`,
    [eventId, imageId],
  );
  const image = rows[0]?.image;
  return image && typeof image.key === "string" ? image : null;
}

export const readEmailImage = (image: EmailImage): Promise<Buffer> => storage.read(image.key);
