import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // The event's name is added by the portal page once the speaker is known (D-080);
  // it used to name one seeded event on every speaker's tab.
  title: "Speaker Upload",
  description: "Upload your presentation",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 16px" }}>{children}</div>
      </body>
    </html>
  );
}
