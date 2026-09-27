/**
 * Email address checks that need no network (D-097).
 *
 * Every hard bounce counts against the sending domain's reputation, and a bad address is
 * cheapest to stop where it is typed. These are the checks that can be made on the text
 * alone: the shape of the address (RFC 5321 lengths, a dotted domain with a real-looking
 * top-level label) and the misspellings of the mail providers people actually use. The
 * domain's own mail servers are checked separately, with DNS (`verify.ts`).
 */
export type AddressCheck =
  | { ok: true; address: string; domain: string }
  | { ok: false; reason: string; suggestion?: string };

/** Misspellings of common mail domains → what was meant. */
const TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.om": "gmail.com",
  "googlemail.co": "googlemail.com",
  "hotmial.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "hotmal.com": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "outlok.com": "outlook.com",
  "outloo.com": "outlook.com",
  "outlook.co": "outlook.com",
  "outlook.con": "outlook.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "yahoo.co": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "iclod.com": "icloud.com",
  "icloud.co": "icloud.com",
  "icoud.com": "icloud.com",
};

const LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/;

/** The address, trimmed, with its domain lower-cased — or why it cannot be one. */
export function checkAddress(raw: string): AddressCheck {
  const address = raw.trim();
  if (!address) return { ok: false, reason: "The email address is empty." };
  if (/\s/.test(address)) return { ok: false, reason: `“${address}” has a space in it.` };
  const at = address.lastIndexOf("@");
  if (at < 1 || address.indexOf("@") !== at) {
    return { ok: false, reason: `“${address}” is not an email address — it needs exactly one @.` };
  }
  const local = address.slice(0, at);
  const domain = address.slice(at + 1).toLowerCase().replace(/\.$/, "");
  if (address.length > 254 || local.length > 64) return { ok: false, reason: `“${address}” is too long to be an email address.` };
  if (!LOCAL.test(local)) return { ok: false, reason: `“${local}” is not a valid name before the @.` };
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => !LABEL.test(label))) {
    return { ok: false, reason: `“${domain}” is not a valid email domain.` };
  }
  const tld = labels.at(-1)!;
  if (!/^[a-z]{2,63}$/.test(tld) && !/^xn--[a-z0-9-]{2,59}$/.test(tld)) {
    return { ok: false, reason: `“${domain}” does not end in a real domain (like .com or .org).` };
  }
  const meant = TYPOS[domain];
  if (meant) {
    return {
      ok: false,
      reason: `“${domain}” looks like a typo for ${meant}.`,
      suggestion: `${local}@${meant}`,
    };
  }
  return { ok: true, address: `${local}@${domain}`, domain };
}
