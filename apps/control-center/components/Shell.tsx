"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { guideForPath } from "@/components/HelpView";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { SignOutButton } from "@/components/SignOutButton";
import { Glyph } from "@/components/Icon";
import { applyTheme, readThemeChoice, saveThemeChoice } from "@/lib/theme";
import type { ThemeChoice } from "@/lib/theme";
import type { Principal, EventRow } from "@/lib/api";

/**
 * The client portal is a distinct user-facing surface (SPEC §2): same Next.js
 * app, role-gated, but no staff navigation or chrome ever renders for it.
 * Sign-in screens render bare, with no chrome at all.
 */
export function Shell({
  principal,
  events,
  children,
}: {
  principal: Principal | null;
  events: EventRow[];
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";

  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/account/password") ||
    pathname.startsWith("/account/mfa")
  ) {
    return <>{children}</>;
  }

  if (pathname.startsWith("/client")) {
    // Clients had no way to sign out or change their password anywhere (D-108).
    const staff = principal?.roles.some((role) => !["client_event_admin", "scoped_reviewer"].includes(role));
    return (
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "16px 16px 24px" }}>
        {principal && (
          <header
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}
          >
            <b>DXG·PM</b>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="note">{principal.display_name}</span>
              {staff && (
                <Link href="/" className="btn">
                  Back to control center
                </Link>
              )}
              <Link href="/account/password" className="btn">
                Change password
              </Link>
              <SignOutButton />
            </div>
          </header>
        )}
        {children}
      </div>
    );
  }

  const crumbs = breadcrumb(pathname, events);

  return (
    <StaffFrame crumbs={crumbs} principal={principal} events={events}>
      {children}
    </StaffFrame>
  );
}

const SIDEBAR_KEY = "dxg.sidebar";

/**
 * The staff frame: sidebar plus Kravio's top bar (D-078). Kept apart from `Shell` so the
 * early returns above stay free of hooks.
 *
 * The sidebar toggle remembers its choice per browser. It is read after mount rather than
 * during render, because the server has no localStorage and a first render that differed
 * from the server's would be a hydration mismatch.
 */
function StaffFrame({
  crumbs,
  principal,
  events,
  children,
}: {
  crumbs: { label: string; href?: string }[];
  principal: Principal | null;
  events: EventRow[];
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === "collapsed");
    } catch {
      // Storage can be unavailable (private mode); the sidebar simply starts open.
    }
  }, []);

  /*
   * Narrow screens (≤760px — phones, small tablets, a narrow window) get the sidebar as a
   * slide-out menu. It used to stack the whole sidebar above the page, so the screen
   * opened on 900px of navigation with the page itself below the fold. The menu starts
   * closed, opens from the top bar, and closes on a tap outside, Escape, or a page change.
   * The desktop "collapsed" preference is left untouched.
   */
  const pathname = usePathname();
  const [narrow, setNarrow] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => {
      setNarrow(query.matches);
      if (!query.matches) setMenuOpen(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const setAndRemember = (next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, next ? "collapsed" : "open");
    } catch {
      // Not remembered, still toggled.
    }
  };

  return (
    <div className={`shell${collapsed && !narrow ? " sidebar-collapsed" : ""}${menuOpen ? " menu-open" : ""}`}>
      <Sidebar
        principal={principal}
        events={events}
        collapseLabel={narrow ? "Close menu" : "Collapse sidebar"}
        onCollapse={() => (narrow ? setMenuOpen(false) : setAndRemember(true))}
      />
      {narrow && menuOpen && <div className="menu-scrim" aria-hidden="true" onClick={() => setMenuOpen(false)} />}
      <main>
        <header className="topbar">
          <div className="left">
            {/* As in Kravio, the top bar only offers a way back once the sidebar is shut;
                the glyph is mirrored to point the way the rail will open. */}
            {(collapsed || narrow) && (
              <button
                type="button"
                className="ibtn toggle open"
                aria-label={narrow ? "Open menu" : "Open sidebar"}
                aria-expanded={narrow ? menuOpen : undefined}
                onClick={() => (narrow ? setMenuOpen(true) : setAndRemember(false))}
              >
                <Glyph name="sidebar" />
              </button>
            )}
            <nav className="crumbs" aria-label="Breadcrumb">
              {crumbs.map((crumb, index) => {
                const last = index === crumbs.length - 1;
                const body = (
                  <>
                    {index === 0 && <Glyph name="grid" />}
                    <span>{crumb.label}</span>
                  </>
                );
                return (
                  <span key={`${index}-${crumb.label}`} className="crumb">
                    {index > 0 && (
                      <span className="sep" aria-hidden="true">
                        <Glyph name="slash" />
                      </span>
                    )}
                    {last || !crumb.href ? (
                      <span className="here" aria-current={last ? "page" : undefined}>
                        {body}
                      </span>
                    ) : (
                      <Link href={crumb.href}>{body}</Link>
                    )}
                  </span>
                );
              })}
            </nav>
          </div>
          <div className="right">
            {/* No notifications bell: nothing in the product raises notifications yet, so it would
                open onto an empty panel. Kravio's bell glyph is kept in Icon.tsx for when they exist. */}
            {/* Help for the screen you're on (D-115). */}
            <HelpLink />
            <HeaderMenu label="Settings" className="gear" icon={<Glyph name="settings" />} title="Account">
              <Link href="/account/password" className="item" role="menuitem">
                Change password
              </Link>
              <Link href="/account/mfa" className="item" role="menuitem">
                Sign-in app (security code)
              </Link>
              <div className="sep" />
              <div className="label">Appearance</div>
              <ThemeItems />
            </HeaderMenu>
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}

/** The top bar's Help button: opens the guide for the current screen, or Help's start. */
function HelpLink() {
  const pathname = usePathname() ?? "";
  const guide = guideForPath(pathname);
  return (
    <Link href={guide ? `/help#${guide}` : "/help"} className="btn help-link" title="How this screen works">
      ? Help
    </Link>
  );
}

/** A top-bar icon button with Kravio's dropdown panel; closes on Escape, outside click or navigation. */
function HeaderMenu({
  label,
  className,
  icon,
  title,
  children,
}: {
  label: string;
  className: string;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

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
    <div className="hmenu" ref={root}>
      <button
        type="button"
        className={`ibtn ${className}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-state={open ? "open" : "closed"}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="label">{title}</div>
          {children}
        </div>
      )}
    </div>
  );
}

/*
 * Kravio's top bar names where you are. Screen names are the baseline's (D-010), so
 * this table only restates what the sidebar and the page titles already say — it
 * decides nothing. An unknown route falls back to the portfolio crumb alone rather
 * than guessing a name.
 */
const SCREENS: [RegExp, string][] = [
  [/^\/events\/new$/, "Create event"],
  [/^\/events\/[^/]+$/, "Command center"],
  [/^\/events\/[^/]+\/details$/, "Event details"],
  [/^\/events\/[^/]+\/import$/, "Schedule import"],
  [/^\/events\/[^/]+\/speakers$/, "Speakers"],
  [/^\/events\/[^/]+\/review$/, "Review presentations"],
  [/^\/events\/[^/]+\/files$/, "Files"],
  [/^\/events\/[^/]+\/comms$/, "Communications"],
  [/^\/events\/[^/]+\/archive$/, "Archive builder"],
  [/^\/events\/[^/]+\/srr$/, "Speaker Ready Room"],
  [/^\/events\/[^/]+\/srr\/[^/]+$/, "Check-in"],
  [/^\/events\/[^/]+\/sync$/, "Room sync"],
  [/^\/events\/[^/]+\/agent(\/[^/]+)?$/, "Room Agent"],
  [/^\/events\/[^/]+\/talks\/[^/]+$/, "Presentation detail"],
  [/^\/events\/[^/]+\/talks\/[^/]+\/inspection$/, "Inspection"],
  [/^\/admin\/users$/, "Staff accounts"],
  [/^\/admin\/assignments$/, "Event assignments"],
  [/^\/no-access$/, "No access"],
  [/^\/help$/, "Help"],
];

function breadcrumb(pathname: string, events: EventRow[]): { label: string; href?: string }[] {
  const crumbs: { label: string; href?: string }[] = [{ label: "Portfolio", href: "/" }];
  if (pathname === "/") return crumbs;
  const eventId = /^\/events\/([^/]+)/.exec(pathname)?.[1];
  const event = eventId && eventId !== "new" ? events.find((row) => row.id === eventId) : undefined;
  if (event) crumbs.push({ label: event.name, href: `/events/${event.id}` });
  const screen = SCREENS.find(([pattern]) => pattern.test(pathname))?.[1];
  // The command centre *is* the event, so its crumb is the event name, not a second one.
  if (screen && !(event && screen === "Command center")) crumbs.push({ label: screen });
  return crumbs;
}

/** Light / Dark / Match system (D-082), remembered per browser. */
function ThemeItems() {
  const [choice, setChoice] = useState<ThemeChoice>("light");

  useEffect(() => {
    setChoice(readThemeChoice());
  }, []);

  // "Match system" follows the operating system while the page is open.
  useEffect(() => {
    if (choice !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => applyTheme("system");
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [choice]);

  const options: { value: ThemeChoice; label: string }[] = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "Match system" },
  ];
  return (
    <>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="item"
          role="menuitemradio"
          aria-checked={choice === option.value}
          onClick={() => {
            saveThemeChoice(option.value);
            setChoice(option.value);
          }}
        >
          {option.label}
          {choice === option.value && <span className="tick">✓</span>}
        </button>
      ))}
    </>
  );
}
