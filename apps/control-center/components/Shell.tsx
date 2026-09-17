"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import type { Principal } from "@/lib/api";

/**
 * The client portal is a distinct user-facing surface (SPEC §2): same Next.js
 * app, role-gated, but no staff navigation or chrome ever renders for it.
 * Sign-in screens render bare, with no chrome at all.
 */
export function Shell({
  principal,
  children,
}: {
  principal: Principal | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";

  if (pathname.startsWith("/login") || pathname.startsWith("/account/password")) {
    return <>{children}</>;
  }

  if (pathname.startsWith("/client")) {
    return <div style={{ maxWidth: 880, margin: "0 auto", padding: "24px 16px" }}>{children}</div>;
  }

  return (
    <div className="shell" style={{ display: "flex" }}>
      <Sidebar principal={principal} />
      <main style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: 24 }}>{children}</main>
    </div>
  );
}
