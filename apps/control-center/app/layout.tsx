import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { getSession } from "@/lib/api";
import type { Principal } from "@/lib/api";

export const metadata: Metadata = {
  title: "DXG·PM — Presentation Management Platform",
  description: "Event presentation lifecycle management",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The layout renders for signed-out routes too, so a missing session is normal
  // here rather than an error.
  let principal: Principal | null = null;
  try {
    principal = (await getSession()).principal;
  } catch {
    principal = null;
  }

  return (
    <html lang="en">
      <body>
        <Shell principal={principal}>{children}</Shell>
      </body>
    </html>
  );
}
