"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Client access (D-194): the control centre with nothing to press.
 *
 * The API refuses every write for a client account, so this is presentation: it hides the
 * controls that would only refuse. Most are caught by the stylesheet (`.shell.read-only`:
 * primary, danger and amber buttons, inputs, selects, file pickers, forms). What is left is
 * the plain `.btn` that acts — Remove, Rename, Check in, Mark loaded… — which the stylesheet
 * cannot tell from a plain `.btn` that merely opens something, so those are hidden here by
 * their words. Links (`<a>`) are never touched: looking is the point.
 */
const ACTS = /^(remove|rename|retire|delete|add|create|new|send|resend|email|invite|approve|reject|ask|request|waive|roll back|check in|check out|depart|sign off|confirm|mark|unmark|launch|acknowledge|sync|import|upload|replace|save|archive|restore|activate|deliver|build|convert|start|assign|unassign|grant|revoke|reset|deactivate|reactivate|unlock|change|edit|merge|cancel|reinstate|set|open the|load|unload|scan|take|retry|dismiss|simulate|choose file|submit)\b/i;
const KEEP = /^(full screen|exit full screen|close|back|previous|next|show|hide|more|less|filter|sort|grid|list|open report|open →|collapse|expand|search)\b/i;
/** Settings drawn as buttons: reminder days, a colour swatch, a speaker's release permission. */
const SETTINGS = /^(✓\s*)?(\d+ days?|#[0-9a-f]{6}|full release|pdf only|no release|not set)$/i;

export function ReadOnlyGuard() {
  const pathname = usePathname();
  useEffect(() => {
    const root = document.querySelector("main .content");
    if (!root) return;
    const hide = () => {
      for (const button of root.querySelectorAll<HTMLButtonElement>("button")) {
        if (button.dataset.readonlyKeep !== undefined) continue;
        const words = button.textContent?.trim() ?? "";
        if (!words || KEEP.test(words)) continue;
        if (ACTS.test(words) || SETTINGS.test(words) || button.type === "submit" || button.getAttribute("aria-pressed") !== null) {
          button.style.display = "none";
        }
      }
    };
    hide();
    const observer = new MutationObserver(hide);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);
  return null;
}
