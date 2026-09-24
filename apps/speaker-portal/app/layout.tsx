import type { Metadata } from "next";
import "./globals.css";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { THEME_BOOT } from "@/lib/theme";

export const metadata: Metadata = {
  // The event's name is added by the portal page once the speaker is known (D-080);
  // it used to name one seeded event on every speaker's tab.
  title: "Speaker Upload",
  description: "Upload your presentation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `data-theme` is set by THEME_BOOT before React hydrates (D-084), so the server's
    // markup and the browser's differ here on purpose.
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        {/* Bottom padding leaves room for the pinned theme switch, so it never covers the last line. */}
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 16px 72px" }}>{children}</div>
        {/* Pinned to the window's bottom-left corner on every portal page (D-084). */}
        <div className="theme-bar">
          <ThemeSwitch />
        </div>
      </body>
    </html>
  );
}
