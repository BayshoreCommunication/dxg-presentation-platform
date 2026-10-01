"use client";

import { formatDateRange } from "@pmp/format";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useParams, useRouter, useSearchParams } from "next/navigation";
import { Glyph, Icon } from "@/components/Icon";
import { WhyNot } from "@/components/WhyNot";
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
// Root admins only (D-100); `platform_admin` in the session roles is how a root admin shows.
const ADMIN_ROLES = ["platform_admin"];
export const GROUPS: {
  group: string;
  roles?: string[];
  /** Drawn above the event switcher: these screens belong to no one event (D-133). */
  top?: boolean;
  items: { label: string; href?: string; roles?: string[]; icon: string }[];
}[] = [
  {
    /*
     * Portfolio and Create event used to head CONTROL CENTER, sitting among screens that
     * are greyed until an event is chosen — though neither needs one. They are the way
     * *to* an event, so they come before the switcher, and everything after it is that
     * event's (D-133, Travis's call).
     */
    group: "EVENTS",
    roles: STAFF_ROLES,
    top: true,
    items: [
      { label: "Portfolio", href: "/", icon: "grid" },
      { label: "Create event", href: "/events/new", icon: "plus" },
    ],
  },
  {
    group: "CONTROL CENTER",
    roles: STAFF_ROLES,
    items: [
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
      /*
       * The agenda is a tab of the event's own page, which made it the one thing staff
       * edit daily that the sidebar could not reach (D-134, Travis: "for easy navigation").
       * First, because it is what everything below is built from.
       */
      { label: "Agenda", href: "/events/:id?tab=agenda", icon: "calendar" },
      { label: "Review presentations", href: "/events/:id/review", icon: "review" },
      // Every file of the event in one list (FR-FILE-005, D-079).
      { label: "Files", href: "/events/:id/files", icon: "folder" },
      { label: "Communications", href: "/events/:id/comms", icon: "mail" },
      { label: "Archive builder", href: "/events/:id/archive", icon: "archive" },
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
      { label: "Speaker Ready Room", href: "/events/:id/srr", icon: "users" },
      { label: "Room sync", href: "/events/:id/sync", icon: "sync" },
    ],
  },
  { group: "DEVICE", roles: STAFF_ROLES, items: [{ label: "Room Agent", href: "/events/:id/agent", icon: "monitor" }] },
  {
    group: "ADMIN",
    items: [
      { label: "Staff accounts", href: "/admin/users", roles: ADMIN_ROLES, icon: "shield" },
      { label: "Event assignments", href: "/admin/assignments", roles: ADMIN_ROLES, icon: "clipboard" },
    ],
  },
  {
    group: "EXTERNAL",
    items: [
      // No "Speaker portal": it is a separate site speakers reach from their emailed link.
      // Open to clients, and to staff as a preview of what their client sees — the
      // screen bands itself accordingly. No `roles`, because nobody signed in is refused.
      { label: "Client portal", href: "/client/:id", icon: "globe" },
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
    return formatDateRange(event.starts_on, event.ends_on);
  }
  return `Day ${Math.round((today - startsAt) / day) + 1}`;
}

export function Sidebar({
  principal,
  events,
  onCollapse,
  collapseLabel = "Collapse sidebar",
}: {
  principal: Principal | null;
  events: EventRow[];
  /** Kravio keeps the collapse control in the sidebar's own logo row (D-078). */
  onCollapse?: () => void;
  /** "Close menu" when the sidebar is the narrow-screen slide-out. */
  collapseLabel?: string;
}) {
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

  const renderGroup = ({ group, roles, items }: (typeof GROUPS)[number]) => {
            // Roles held anywhere, plus those on this event — a practice event's roles
            // count only inside it (D-116).
            const held = [
              ...(principal?.roles ?? []),
              ...(principal?.event_roles ?? []).filter((entry) => entry.event_id === eventId).map((entry) => entry.role),
            ];
            const allowed = (needed?: string[]) => !needed || needed.some((role) => held.includes(role));
            // A whole group can be out of reach, and an item within a reachable one.
            const visible = allowed(roles) ? items.filter((item) => allowed(item.roles)) : [];
            // A group whose every entry is hidden would otherwise leave a stray heading.
            if (visible.length === 0) return null;
            return (
            <div key={group} className="navgroup">
              <div className="grp">{group}</div>
              <div className="navitems">
                {visible.map((item) => {
                  // An ":id" link has nowhere to go until an event is chosen.
                  const needsEvent = item.href?.includes(":id") ?? false;
                  const href = needsEvent && !eventId ? undefined : item.href?.replace(":id", eventId ?? "");
                  if (!href) {
                    return (
                      <a key={item.label} aria-disabled="true" title="Choose an event first">
                        <span className="ico"><Icon name={item.icon} /></span>
                        {item.label}
                      </a>
                    );
                  }
                  if (href.includes("?")) {
                    // A tab of a page: whether it is "on" depends on the query too. Read in
                    // its own Suspense boundary so no statically rendered page needs one.
                    const plain = (
                      <Link href={href}>
                        <span className="ico"><Icon name={item.icon} /></span>
                        {item.label}
                      </Link>
                    );
                    return (
                      <Suspense key={item.label} fallback={plain}>
                        <TabLink href={href} pathname={pathname} icon={item.icon} label={item.label} />
                      </Suspense>
                    );
                  }
                  return (
                    <Link key={item.label} href={href} className={pathname === href ? "on" : ""}>
                      <span className="ico"><Icon name={item.icon} /></span>
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
            );
  };
  const topNav = (
    <nav className="topnav" aria-label="Events">
      {GROUPS.filter((entry) => entry.top).map(renderGroup)}
    </nav>
  );

  return (
    <aside>
      <div className="logo">
        <Link href="/" className="brand">
          <span className="mark" aria-hidden="true">D</span>
          <b>DXG·PM</b>
        </Link>
        {onCollapse && (
          <button type="button" className="ibtn toggle" aria-label={collapseLabel} onClick={onCollapse}>
            <Glyph name="sidebar" />
          </button>
        )}
      </div>
      <div className="sidebody">
        {/* Portfolio and Create event: no event needed, so above the switcher (D-133). */}
        {topNav}
        {/*
          The event context slot from the baseline (VISUAL_ACCEPTANCE §2.1), which used
          to be a hardcoded string naming the seeded event — correct exactly once, and a
          lie on every other event. It now names the event you are actually in and lets
          you change it, which is the only way five events are workable without going
          back to the portfolio each time.
        */}
        <div className="evtctx">
          {events.length === 0 ? (
            <>
              <span className="note">No events yet</span>
              {/* A21 (D-111): the greyed links below need an event; say how to get one. */}
              {principal?.is_root_admin ? (
                <div className="note">
                  <Link href="/events/new">Create your first event</Link>
                </div>
              ) : (
                <WhyNot reason="Ask a DXG administrator to add you to an event." />
              )}
            </>
          ) : (
            <>
              <select
                aria-label="Switch event"
                value={eventId ?? ""}
                onChange={(event) => {
                  const chosen = event.target.value;
                  if (chosen) router.push(`/events/${chosen}`);
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
              {/* A20 (D-111): the greyed links say why on the page, not only on hover. */}
              <WhyNot reason={!eventId ? "Choose an event above to open the greyed screens below." : null} />
              {current && (
                <div className="note">
                  {/* Every screen of an archived event is read-only (D-062); say so on all of them. */}
                  {current.status === "archived" ? "Archived · read-only" : dayLabel(current)}
                </div>
              )}
            </>
          )}
        </div>
        <nav aria-label="This event">{GROUPS.filter((entry) => !entry.top).map(renderGroup)}</nav>
        {principal && <AccountMenu principal={principal} />}
      </div>
    </aside>
  );
}

/** A sidebar link to one tab of a page (`/events/x?tab=agenda`): on when both match (D-134). */
function TabLink({ href, pathname, icon, label }: { href: string; pathname: string; icon: string; label: string }) {
  const params = useSearchParams();
  const [path, query] = href.split("?");
  const wanted = new URLSearchParams(query);
  const on = pathname === path && [...wanted].every(([key, value]) => params?.get(key) === value);
  return (
    <Link href={href} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
      <span className="ico"><Icon name={icon} /></span>
      {label}
    </Link>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/**
 * Kravio's account button: who is signed in, with password, 2FA and sign-out behind it
 * rather than three bare links. Closes on Escape and on any click outside it.
 */
function AccountMenu({ principal }: { principal: Principal }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="account" ref={root}>
      {open && (
        <div className="menu" role="menu">
          <div className="label">Account</div>
          <Link href="/account/password" className="item" role="menuitem" onClick={() => setOpen(false)}>
            <Icon name="lock" /> Password
          </Link>
          <Link href="/account/mfa" className="item" role="menuitem" onClick={() => setOpen(false)}>
            <Icon name="key" /> Sign-in app (security code)
          </Link>
          <div className="sep" />
          <button
            type="button"
            className="item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void logout()
                .catch(() => undefined)
                .then(() => {
                  router.replace("/login?reason=signed_out");
                  router.refresh();
                });
            }}
          >
            <Icon name="logout" /> Sign out
          </button>
        </div>
      )}
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="avatar">
          {initials(principal.display_name)}
          <span className="dot" />
        </span>
        <span className="who">
          <b>{principal.display_name}</b>
          {/* DXG administrator or staff (D-100, D-110); raw role codes read like a stack trace. */}
          <small>{principal.is_root_admin ? "DXG administrator" : "Staff"}</small>
        </span>
        <span style={{ color: "var(--subtle-foreground)", display: "flex" }}>
          <Icon name="chevrons" size={12} />
        </span>
      </button>
    </div>
  );
}
