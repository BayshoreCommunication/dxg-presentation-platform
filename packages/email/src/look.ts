/**
 * How a speaker email looks (D-138), after Preseria's: the event's banner across the top,
 * one button that takes the speaker straight to their upload page, then the message.
 *
 * The message itself stays the plain text staff write in the template — this only wraps
 * it. Every email is sent with that text as its plain-text part too, so a mail client that
 * shows no HTML (or a speaker who prefers text) loses nothing: the link is in the message.
 *
 * Email HTML is its own dialect: tables for layout, inline styles only, no web fonts, no
 * scripts. The banner is a 1200 px image drawn at 600 px so it is sharp on high-density
 * screens; with images blocked the layout still reads, with the event name as its alt text.
 */
export type EmailLook = {
  /** Public address of the event's email banner, or none for a plain header. */
  banner_url?: string | null | undefined;
  /** The one call to action, placed between the banner and the message. */
  button?: { label: string; url: string } | null | undefined;
  /** Shown as the banner's alt text and in the small footer. */
  event_name?: string | null | undefined;
};

const ACCENT = "#111827";

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Only web links become links: never `javascript:` or anything else a template could carry. */
const safeUrl = (url: string): string | null => (/^https?:\/\/[^\s<>"']+$/i.test(url) ? url : null);

/** Escaped text with its web addresses made clickable. */
function linkify(text: string): string {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/gi);
  return parts
    .map((part, index) => {
      if (index % 2 === 0) return escapeHtml(part);
      // A sentence's full stop or closing bracket is not part of the address.
      const trailing = /[.,;:!?)\]]+$/.exec(part)?.[0] ?? "";
      const url = safeUrl(part.slice(0, part.length - trailing.length));
      if (!url) return escapeHtml(part);
      return `<a href="${escapeHtml(url)}" style="color:${ACCENT};text-decoration:underline">${escapeHtml(url)}</a>${escapeHtml(trailing)}`;
    })
    .join("");
}

/** Blank lines separate paragraphs; single line breaks are kept within one. */
function paragraphs(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1f2937">${block
          .split("\n")
          .map(linkify)
          .join("<br>")}</p>`,
    )
    .join("\n");
}

export function renderEmailHtml(
  input: { subject: string; body: string; /** A formatted, already sanitised message (D-139). */ body_html?: string | null } & EmailLook,
): string {
  const banner = input.banner_url ? safeUrl(input.banner_url) : null;
  const button = input.button && safeUrl(input.button.url) ? input.button : null;
  const name = input.event_name?.trim() ?? "";

  const top = banner
    ? `<tr><td style="padding:0"><img src="${escapeHtml(banner)}" width="600" alt="${escapeHtml(name || input.subject)}" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>`
    : name
      ? `<tr><td style="padding:22px 32px;background:${ACCENT};color:#ffffff;font-size:18px;font-weight:600">${escapeHtml(name)}</td></tr>`
      : "";

  const cta = button
    ? `<tr><td style="padding:28px 32px 4px" align="center">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="border-radius:8px;background:${ACCENT}" bgcolor="${ACCENT}">
      <a href="${escapeHtml(button.url)}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(button.label)}</a>
    </td>
  </tr></table>
</td></tr>`
    : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden">
${top}
${cta}
<tr><td style="padding:24px 32px 12px;font-size:15px;line-height:1.6;color:#1f2937">
${input.body_html ? `${input.body_html}<div style="height:16px"></div>` : paragraphs(input.body)}
</td></tr>
${name ? `<tr><td style="padding:12px 32px 24px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">${escapeHtml(name)}</td></tr>` : ""}
</table>
</td></tr></table>
</body></html>`;
}

/**
 * A From header with a display name: `"DXG Events" <noreply@…>`. A name with anything
 * beyond plain ASCII is encoded (RFC 2047) so every mail client reads it the same way.
 */
export function fromHeader(address: string, name?: string | null): string {
  const clean = (name ?? "").replace(/[\r\n"<>\\]/g, "").trim();
  if (!clean) return address;
  const ascii = /^[\x20-\x7e]*$/.test(clean);
  const shown = ascii ? `"${clean}"` : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
  return `${shown} <${address}>`;
}
