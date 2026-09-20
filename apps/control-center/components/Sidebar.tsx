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
 * product.
 *
 * Not everyone signed in here is staff. A `client_event_admin` uses the same login
 * and is refused by the deny-by-default staff gate on **every** control-centre,
 * onsite and device route — so those groups are staff-only, and such an account is
 * left with the one surface that is genuinely theirs. Getting this wrong is not a
 * small cosmetic miss: it hands a client a sidebar where all but one link fails.
 *
 * **This is presentation, not protection.** The API refuses these routes on its own
 * and keeps doing so whatever the sidebar renders — typing the URL still gets a 403.
 * Hiding a link nobody can use is a courtesy; it is never the reason the thing is
 * safe. The lists below therefore mirror the server's own gates rather than
 * inventing a second, quietly divergent permission model:
 *   · staff groups  → `STAFF_ROLES` in index.ts, via the deny-by-default gate
 *   · Staff accounts → `ADMIN_ROLES` in services/admin.ts
 *   · Client portal  → open: clients by right, staff as a preview
 */
const STAFF_ROLES = [
  "platform_admin",
  "project_manager",
  "presentation_manager",
  "srr_technician",
  "room_technician",
  "content_reviewer",
];
const ADMIN_ROLES = ["platform_admin", "project_manager"];
const GROUPS: { group: string; roles?: string[]; items: { label: string; href?: string; roles?: string[] }[] }[] = [
  {
    group: "CONTROL CENTER",
    roles: STAFF_ROLES,
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
    roles: STAFF_ROLES,
    items: [
      { label: "Speaker Ready Room", href: "/events/:id/srr" },
      { label: "Check-in" },
      { label: "USB intake" },
      { label: "Room sync", href: "/events/:id/sync" },
    ],
  },
  { group: "DEVICE", roles: STAFF_ROLES, items: [{ label: "Room Agent", href: "/events/:id/agent" }] },
  {
    group: "ADMIN",
    items: [{ label: "Staff accounts", href: "/admin/users", roles: ADMIN_ROLES }],
  },
  {
    group: "EXTERNAL",
    items: [
      { label: "Speaker portal" },
      // Open to clients, and to staff as a preview of what their client sees — the
      // screen bands itself accordingly. No `roles`, because nobody signed in is refused.
      { label: "Client portal", href: "/client/:id" },
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
        {GROUPS.map(({ group, roles, items }) => {
          const held = principal?.roles ?? [];
          const allowed = (needed?: string[]) => !needed || needed.some((role) => held.includes(role));
          // A whole group can be out of reach, and an item within a reachable one.
          const visible = allowed(roles) ? items.filter((item) => allowed(item.roles)) : [];
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
