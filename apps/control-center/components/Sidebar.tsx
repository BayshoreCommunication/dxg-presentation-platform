"use client";

import Link from "next/link";
import { usePathname, useParams, useRouter } from "next/navigation";
import { logout } from "@/lib/api";
import type { Principal, EventRow } from "@/lib/api";

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
      /*
       * Schedule import is step 2 of Create event (D-027), so listing it here offered
       * it as somewhere to go when it is really somewhere you are taken. The screen
       * still exists for re-importing a revised agenda, reached from the command
       * centre — the event it would import into is the one you are looking at.
       */
      // No "Command center": an event opens from the portfolio or the switcher above.
      // No "Speakers": they are a tab of the event details, which links to the full screen.
      /*
       * No "Presentation detail" or "Inspection": both are one talk's screens, opened
       * from that talk (agenda, risk list, review queue). As sidebar items they had no
       * talk to open and led nowhere.
       */
      { label: "Review presentations", href: "/events/:id/review" },
      { label: "Communications", href: "/events/:id/comms" },
      { label: "Archive builder", href: "/events/:id/archive" },
    ],
  },
  {
    group: "ONSITE",
    roles: STAFF_ROLES,
    items: [
      /*
       * Check-in and USB intake are not separate destinations: check-in opens from a
       * speaker in the Speaker Ready Room, and USB intake from a button on check-in.
       * Listing them here offered two greyed-out items that led nowhere.
       */
      { label: "Speaker Ready Room", href: "/events/:id/srr" },
      { label: "Room sync", href: "/events/:id/sync" },
    ],
  },
  { group: "DEVICE", roles: STAFF_ROLES, items: [{ label: "Room Agent", href: "/events/:id/agent" }] },
  {
    group: "ADMIN",
    items: [
      { label: "Staff accounts", href: "/admin/users", roles: ADMIN_ROLES },
      { label: "Event assignments", href: "/admin/assignments", roles: ADMIN_ROLES },
    ],
  },
  {
    group: "EXTERNAL",
    items: [
      // No "Speaker portal": it is a separate site speakers reach from their emailed link.
      // Open to clients, and to staff as a preview of what their client sees — the
      // screen bands itself accordingly. No `roles`, because nobody signed in is refused.
      { label: "Client portal", href: "/client/:id" },
    ],
  },
];

/**
 * Which day of the event today is — the baseline's "Day 2".
 *
 * Only meaningful while the event is running. Outside it, counting days produces a
 * confident lie ("Day -14"), so the dates are shown instead.
 */
function dayLabel(event: EventRow | undefined): string {
  if (!event) return "";
  const day = 86_400_000;
  const startsAt = new Date(`${event.starts_on}T00:00:00`).getTime();
  const endsAt = new Date(`${event.ends_on}T00:00:00`).getTime();
  const today = new Date(new Date().toDateString()).getTime();
  if (today < startsAt || today > endsAt) {
    const fmt = (iso: string) =>
      new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return `${fmt(event.starts_on)}–${fmt(event.ends_on)}`;
  }
  return `Day ${Math.round((today - startsAt) / day) + 1}`;
}

export function Sidebar({ principal, events }: { principal: Principal | null; events: EventRow[] }) {
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();
  const router = useRouter();

  /*
   * No fallback event. This used to default to the seeded event's id when the URL had
   * none, which was harmless while that was the only event — and became a trap once
   * roles were scoped per event (D-025), because a staff member who is not on it got
   * a sidebar of links that all refuse. When no event is chosen, the event-scoped
   * links are inert and say so.
   */
  const eventId = params?.id;
  const current = events.find((event) => event.id === eventId);

  return (
    <aside>
      <div className="logo">
        <b>DXG·PM</b>
      </div>
      {/*
        The event context slot from the baseline (VISUAL_ACCEPTANCE §2.1), which used
        to be a hardcoded string naming the seeded event — correct exactly once, and a
        lie on every other event. It now names the event you are actually in and lets
        you change it, which is the only way five events are workable without going
        back to the portfolio each time.
      */}
      <div className="evtctx">
        {events.length === 0 ? (
          <span className="note">No events yet</span>
        ) : (
          <>
            <select
              aria-label="Switch event"
              value={eventId ?? ""}
              onChange={(event) => {
                const chosen = event.target.value;
                if (chosen) router.push(`/events/${chosen}`);
              }}
              style={{
                width: "100%",
                background: "transparent",
                color: "var(--white)",
                border: "1px solid #22303A",
                borderRadius: 4,
                padding: "3px 6px",
                fontSize: 12,
              }}
            >
              <option value="" disabled>
                Choose an event…
              </option>
              {/* Archived events leave the switcher as they leave the portfolio (D-061),
                  except the one you are standing in, which the select must still name. */}
              {events
                .filter((event) => event.status !== "archived" || event.id === eventId)
                .map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
            {current && (
              <div className="note" style={{ marginTop: 3, fontSize: 11 }}>
                {/* Every screen of an archived event is read-only (D-062); say so on all of them. */}
                {current.status === "archived" ? "Archived · read-only" : dayLabel(current)}
              </div>
            )}
          </>
        )}
      </div>
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
              // An ":id" link has nowhere to go until an event is chosen.
              const needsEvent = item.href?.includes(":id") ?? false;
              const href = needsEvent && !eventId ? undefined : item.href?.replace(":id", eventId ?? "");
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
