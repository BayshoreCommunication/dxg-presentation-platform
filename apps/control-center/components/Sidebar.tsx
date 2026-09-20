"use client";

import Link from "next/link";
import { usePathname, useParams, useRouter } from "next/navigation";
import { logout } from "@/lib/api";
import type { Principal } from "@/lib/api";

/**
 * Navigation structure, grouping and screen names are fixed by the client
 * baseline (VISUAL_ACCEPTANCE §2.1/§2.2). Screens not yet built are shown but
 * marked, rather than hidden — the information architecture is the contract.
 *
 * `roles` is the exception, and a different thing entirely: a destination the
 * signed-in account is *refused* is not shown, because offering a door that only
 * produces "you are not allowed" wastes the click and reads as a fault in the
 * product. Items without `roles` are open to any staff role.
 *
 * **This is presentation, not protection.** The API refuses these routes on its own
 * and keeps doing so whatever the sidebar renders — typing the URL still gets a 403.
 * Hiding a link nobody can use is a courtesy; it is never the reason the thing is
 * safe. The lists below therefore mirror the server's own gates rather than
 * inventing a second, quietly divergent permission model:
 *   · Staff accounts → `ADMIN_ROLES` in services/admin.ts
 *   · Client portal  → `clientRoles` in index.ts, on /client/events/:eventId
 */
const GROUPS: { group: string; items: { label: string; href?: string; roles?: string[] }[] }[] = [
  {
    group: "CONTROL CENTER",
    items: [
      { label: "Portfolio", href: "/" },
      { label: "Create event", href: "/events/new" },
      { label: "Schedule import", href: "/events/:id/import" },
      { label: "Command center", href: "/events/:id" },
      { label: "Speakers", href: "/events/:id/speakers" },
      { label: "Presentation detail" },
      { label: "Inspection" },
      { label: "Review & approval", href: "/events/:id/review" },
      { label: "Communications", href: "/events/:id/comms" },
      { label: "Archive builder", href: "/events/:id/archive" },
    ],
  },
  {
    group: "ONSITE",
    items: [
      { label: "Speaker Ready Room", href: "/events/:id/srr" },
      { label: "Check-in" },
      { label: "USB intake" },
      { label: "Room sync", href: "/events/:id/sync" },
    ],
  },
  { group: "DEVICE", items: [{ label: "Room Agent", href: "/events/:id/agent" }] },
  {
    group: "ADMIN",
    items: [{ label: "Staff accounts", href: "/admin/users", roles: ["platform_admin", "project_manager"] }],
  },
  {
    group: "EXTERNAL",
    items: [
      { label: "Speaker portal" },
      // A client surface, not a staff view of one — staff are refused by design.
      { label: "Client portal", href: "/client/:id", roles: ["client_event_admin", "scoped_reviewer"] },
    ],
  },
];

export function Sidebar({ principal }: { principal: Principal | null }) {
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const eventId = params?.id ?? "22222222-2222-4222-8222-222222222222";

  return (
    <aside>
      <div className="logo">
        <b>DXG·PM</b>
      </div>
      <div className="evtctx">MedTech Fwd 26 · Day 2</div>
      <nav>
        {GROUPS.map(({ group, items }) => {
          const held = principal?.roles ?? [];
          const visible = items.filter((item) => !item.roles || item.roles.some((role) => held.includes(role)));
          // A group whose every entry is hidden would otherwise leave a stray heading.
          if (visible.length === 0) return null;
          return (
          <div key={group}>
            <div className="grp">{group}</div>
            {visible.map((item) => {
              const href = item.href?.replace(":id", eventId);
              if (!href) {
                return (
                  <a key={item.label} className="" style={{ opacity: 0.38, cursor: "default" }}>
                    {item.label}
                  </a>
                );
              }
              return (
                <Link key={item.label} href={href} className={pathname === href ? "on" : ""}>
                  {item.label}
                </Link>
              );
            })}
          </div>
          );
        })}
      </nav>
      {principal && (
        <div
          style={{
            marginTop: "auto",
            padding: "12px 16px",
            borderTop: "1px solid #22303A",
            fontSize: 12.5,
          }}
        >
          <div style={{ color: "var(--white)" }}>{principal.display_name}</div>
          <div className="mono" style={{ color: "var(--dim)", fontSize: 11 }}>
            {principal.roles.join(", ") || "no event role"}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <Link href="/account/password" style={{ color: "var(--blue)" }}>
              Password
            </Link>
            <Link href="/account/mfa" style={{ color: "var(--blue)" }}>
              2FA
            </Link>
            <button
              style={{
                background: "none",
                border: "none",
                color: "var(--blue)",
                padding: 0,
                fontSize: 12.5,
              }}
              onClick={() => {
                void logout()
                  .catch(() => undefined)
                  .then(() => {
                    router.replace("/login?reason=signed_out");
                    router.refresh();
                  });
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
