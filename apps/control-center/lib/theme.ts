/**
 * Light / dark theme (D-082). The choice is per browser — "light", "dark" or "system" —
 * and resolves to `data-theme` on <html>. `THEME_BOOT` runs inline in <head> before the
 * first paint, so a dark-theme user never sees a flash of the light one.
 */
export type ThemeChoice = "light" | "dark" | "system";

export const THEME_KEY = "dxg.theme";

export const THEME_BOOT = `(function(){try{var c=localStorage.getItem("${THEME_KEY}")||"light";var d=c==="dark"||(c==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.setAttribute("data-theme",d?"dark":"light");}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

export function readThemeChoice(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === "dark" || stored === "system" ? stored : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const dark =
    choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

export function saveThemeChoice(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Not remembered; still applied for this page.
  }
  applyTheme(choice);
}
