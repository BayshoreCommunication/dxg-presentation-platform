import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { THEME_BOOT } from "@/lib/theme";
import { getSession, listEvents } from "@/lib/api";
import type { Principal, EventRow } from "@/lib/api";

export const metadata: Metadata = {
  title: "DXG·PM — Presentation Management Platform",
  description: "Event presentation lifecycle management",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The layout renders for signed-out routes too, so a missing session is normal
  // here rather than an error.
  let principal: Principal | null = null;
  try {
    const resolved = (await getSession()).principal;
    // Belt and braces with the API's own check: never render the staff shell
    // around a principal that is not staff.
    principal = resolved?.kind === "staff" ? resolved : null;
  } catch {
    principal = null;
  }

  /*
   * The switcher needs the events this account may actually work on. `GET /events` is
   * already scoped to exactly that — every event for a platform admin, only their own
   * for anyone else — so asking it here reuses one rule rather than inventing a second
   * that could drift from it.
   */
  let events: EventRow[] = [];
  if (principal) {
    try {
      events = (await listEvents()).items;
    } catch {
      events = [];
    }
  }

  return (
    // The theme attribute is set by THEME_BOOT before React hydrates, so the server's
    // markup and the browser's differ on purpose here (D-082).
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <Shell principal={principal} events={events}>{children}</Shell>
      </body>
    </html>
  );
}
