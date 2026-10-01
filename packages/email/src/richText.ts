import sanitizeHtml from "sanitize-html";
import { escapeHtml } from "./look.ts";

/**
 * Formatted email messages (D-139), written in the Communications editor (Quill, the
 * editor Preseria uses) and sent as HTML.
 *
 * Whatever the editor produces is cleaned here, on the server, before it is stored or sent:
 * an allowlist of formatting tags, inline styles limited to the ones the toolbar sets, and
 * links and images only over http(s) (links may also be mailto:). Scripts, event handlers,
 * forms, iframes and anything else are dropped, so a template is safe to show to other
 * staff in the preview and safe in every speaker's mail client.
 *
 * Every formatted message also has a plain-text twin (`htmlToText`): it is the email's
 * text part, the copy the delivery log and the client archive keep, and what the length
 * limit and the "keep the Upload link" rule are checked against.
 */

/** The longest message, counted as the reader sees it (Preseria's counter: n / 10000). */
export const MESSAGE_MAX_CHARS = 10_000;

const STYLE_VALUE = {
  color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i],
  "background-color": [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i],
  "font-family": [/^[\w\s,'"-]{1,80}$/],
  "font-size": [/^\d{1,2}(\.\d+)?(px|pt|em|rem)$/],
  "text-align": [/^(left|right|center|justify)$/],
  "font-weight": [/^(bold|normal|[1-9]00)$/],
  "font-style": [/^(italic|normal)$/],
  "text-decoration": [/^(underline|line-through|none)(\s+(underline|line-through))?$/],
  "vertical-align": [/^(super|sub|baseline)$/],
  // Only the reset this module adds itself (see transformTags), and image sizing.
  margin: [/^0$/],
  "max-width": [/^100%$/],
  height: [/^auto$/],
};

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "span", "strong", "b", "em", "i", "u", "s", "strike", "sub", "sup",
    "a", "ul", "ol", "li", "h1", "h2", "h3", "blockquote", "img",
  ],
  allowedAttributes: {
    a: ["href", "title", "style"],
    img: ["src", "alt", "width", "height", "style"],
    "*": ["style"],
  },
  allowedStyles: { "*": STYLE_VALUE },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowProtocolRelative: false,
  // Mail clients give <p> a margin of their own; the editor's lines have none, so the
  // email would come out double-spaced. Images are kept within the 600 px email.
  transformTags: {
    p: (tagName, attribs) => ({ tagName, attribs: { ...attribs, style: `margin:0;${attribs.style ?? ""}` } }),
    img: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, style: `max-width:100%;height:auto;${attribs.style ?? ""}` },
    }),
    b: "strong",
    i: "em",
    strike: "s",
  },
};

export function sanitizeEmailHtml(html: string): string {
  // The editor writes every space as &nbsp;, which would stop the email's lines wrapping.
  return (
    sanitizeHtml(html.replace(/&nbsp;/g, " "), OPTIONS)
      // An empty line is an empty paragraph, which mail clients collapse to nothing.
      .replace(/<p([^>]*)><\/p>/g, "<p$1><br /></p>")
      .trim()
  );
}

/** Plain text as the editor writes it: one paragraph per line, a blank line as `<p><br></p>`. */
export function textToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : "<p><br></p>"))
    .join("");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " ", apos: "'" };
const decode = (text: string) =>
  text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (ENTITIES[code.toLowerCase()] !== undefined) return ENTITIES[code.toLowerCase()]!;
    if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
    return match;
  });

/** The formatted message read as plain text: lines kept, bullets drawn, links' addresses shown. */
export function htmlToText(html: string): string {
  let numbered = 0;
  const text = html
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_match, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, "").trim();
      const url = decode(href);
      return !label || decode(label) === url ? url : `${label} (${url})`;
    })
    // One pass, in document order, so each item knows which kind of list it is in.
    .replace(/<(ol|ul|li)\b[^>]*>/gi, (_match, tag: string) => {
      const name = tag.toLowerCase();
      if (name === "ol") numbered = 1;
      if (name === "ul") numbered = 0;
      if (name !== "li") return "";
      return numbered > 0 ? `${numbered++}. ` : "• ";
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<img\b[^>]*alt="([^"]*)"[^>]*>/gi, (_match, alt: string) => (alt ? `[${alt}]` : ""))
    .replace(/<[^>]+>/g, "");
  return decode(text)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Fills `{{field}}` in a formatted message: every value is escaped (a speaker's name is
 * text, never markup), its line breaks kept, and the upload link made a link.
 */
export function fillHtml(html: string, values: Record<string, string>): string {
  return html.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, key: string) => {
    const value = values[key.toLowerCase()];
    if (value === undefined) return match;
    const escaped = escapeHtml(value).replace(/\n/g, "<br>");
    return key.toLowerCase() === "upload_link" && /^https?:\/\//i.test(value)
      ? `<a href="${escapeHtml(value)}">${escaped}</a>`
      : escaped;
  });
}
