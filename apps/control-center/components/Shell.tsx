"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";

/**
 * The client portal is a distinct user-facing surface (SPEC §2): same Next.js
 * app, role-gated, but no staff navigation or chrome ever renders for it.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isClientSurface = pathname?.startsWith("/client") ?? false;

  if (isClientSurface) {
    return <div style={{ maxWidth: 880, margin: "0 auto", padding: "24px 16px" }}>{children}</div>;
  }

  return (
    <div className="shell" style={{ display: "flex" }}>
      <Sidebar />
      <main style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: 24 }}>{children}</main>
    </div>
  );
}
