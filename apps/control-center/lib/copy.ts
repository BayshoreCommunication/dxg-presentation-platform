/**
 * Copy text to the clipboard, including text that is still being fetched (D-117).
 *
 * Browsers only let a page write the clipboard during the click that asked for it. Copy
 * link used to fetch the link first and write it afterwards — by then the click no longer
 * counted, the write was refused, and the link flashed in a toast and was gone. So:
 *
 *  1. Start the write *inside* the click with a ClipboardItem whose content is a promise
 *     (Safari and Chrome accept this); the browser waits for the text.
 *  2. Otherwise write once the text arrives, then the old `execCommand("copy")` route
 *     (older and embedded browsers).
 *
 * Call it synchronously from the click handler — before any `await`. It resolves to
 * whether the text reached the clipboard; on `false` the caller shows the text to copy by
 * hand (see `CopyFallback`).
 */
export async function copyText(source: string | Promise<string>): Promise<boolean> {
  const text = Promise.resolve(source);
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;

  if (clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      const blob = text.then((value) => new Blob([value], { type: "text/plain" }));
      await clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      return true;
    } catch {
      // Refused or unsupported with a promise — try the plainer routes.
    }
  }

  let value: string;
  try {
    value = await text;
  } catch {
    return false;
  }

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      // Fall through.
    }
  }

  return legacyCopy(value);
}

function legacyCopy(value: string): boolean {
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
