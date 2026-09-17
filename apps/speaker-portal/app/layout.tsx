import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Speaker Upload — MedTech Forward 2026",
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
