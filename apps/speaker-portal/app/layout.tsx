import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { THEME_BOOT } from "@/lib/theme";
import { getSession } from "@/lib/api";
import type { Principal } from "@/lib/api";

export const metadata: Metadata = {
  title: "DXG·PM — Manage presentations",
  description: "Upload, update and download your presentations",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The layout renders for signed-out routes too, so a missing session is normal here.
  let principal: Principal | null = null;
  try {
    const resolved = (await getSession()).principal;
    principal = resolved?.account_kind === "speaker" ? resolved : null;
  } catch {
    principal = null;
  }
  return (
    // `data-theme` is set by THEME_BOOT before React hydrates (D-084), so the server's
    // markup and the browser's differ here on purpose.
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <Shell principal={principal}>{children}</Shell>
      </body>
    </html>
  );
}
