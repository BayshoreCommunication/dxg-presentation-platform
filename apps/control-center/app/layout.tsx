import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "DXG·PM — Presentation Management Platform",
  description: "Event presentation lifecycle management",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell" style={{ display: "flex" }}>
          <Sidebar />
          <main style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: 24 }}>{children}</main>
        </div>
      </body>
    </html>
  );
}
