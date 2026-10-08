"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Glyph, Icon } from "@/components/Icon";
import { logout } from "@/lib/api";
import type { Principal } from "@/lib/api";
import { applyTheme, readThemeChoice, saveThemeChoice } from "@/lib/theme";
import type { ThemeChoice } from "@/lib/theme";

/**
 * The speaker site's chrome (D-148, Travis: "sidebar topbar ager site er sathe thakbe"):
 * the control centre's sidebar and top bar, so a speaker sees the product their DXG
 * contact describes, with one door open — Manage presentations. The rest is drawn greyed
 * and says why. Sign-in and password pages render bare.
 *
 * Presentation only: the API serves a speaker nothing but their own routes whatever is
 * drawn here.
 */
/*
 * What a speaker's sidebar lists (Travis, 2026-10-08): Create event, Room sync and the DEVICE
 * group are gone — they are DXG's tools. Portfolio, Agenda and the Speaker Ready Room stay
 * and are to become the speaker's own views of them; until each is built it is drawn greyed.
 */
const GROUPS: { group: string; items: { label: string; href?: string; icon: string }[] }[] = [
  { group: "EVENTS", items: [{ label: "Portfolio", icon: "grid" }] },
  {
    group: "CONTROL CENTER",
    items: [
      { label: "Agenda", icon: "calendar" },
      { label: "Manage presentations", href: "/", icon: "review" },
    ],
  },
  { group: "ONSITE", items: [{ label: "Speaker Ready Room", icon: "users" }] },
];

const BARE = ["/login", "/forgot-password", "/reset-password", "/account/password", "/t/"];

export function Shell({ principal, children }: { principal: Principal | null; children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  if (BARE.some((path) => pathname.startsWith(path)) || !principal) return <>{children}</>;
  return <Frame principal={principal}>{children}</Frame>;
}

const SIDEBAR_KEY = "dxg.sidebar";

function Frame({ principal, children }: { principal: Principal; children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const [collapsed, setCollapsed] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_KEY) === "collapsed");
    } catch {
      // Storage can be unavailable (private mode); the sidebar simply starts open.
    }
  }, []);

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

  const setAndRemember = (next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, next ? "collapsed" : "open");
    } catch {
      // Not remembered, still toggled.
    }
  };

  const crumb = pathname.startsWith("/help") ? "Help" : "Manage presentations";

  return (
    <div className={`shell${collapsed && !narrow ? " sidebar-collapsed" : ""}${menuOpen ? " menu-open" : ""}`}>
      <aside>
        <div className="logo">
          <Link href="/" className="brand">
            <span className="mark" aria-hidden="true">D</span>
            <b>DXG·PM</b>
          </Link>
          <button
            type="button"
            className="ibtn toggle"
            aria-label={narrow ? "Close menu" : "Collapse sidebar"}
            onClick={() => (narrow ? setMenuOpen(false) : setAndRemember(true))}
          >
            <Glyph name="sidebar" />
          </button>
        </div>
        <div className="sidebody">
          <nav className="topnav" aria-label="Events">
            {GROUPS.filter((entry) => entry.group === "EVENTS").map(renderGroup)}
          </nav>
          <div className="evtctx">
            <span className="note">Your presentations, on every event you speak at.</span>
          </div>
          <nav aria-label="This site">{GROUPS.filter((entry) => entry.group !== "EVENTS").map(renderGroup)}</nav>
          <AccountMenu principal={principal} />
        </div>
      </aside>
      {narrow && menuOpen && <div className="menu-scrim" aria-hidden="true" onClick={() => setMenuOpen(false)} />}
      <main>
        <header className="topbar">
          <div className="left">
            {(collapsed || narrow) && (
              <button
                type="button"
                className="ibtn toggle open"
                aria-label={narrow ? "Open menu" : "Open sidebar"}
                onClick={() => (narrow ? setMenuOpen(true) : setAndRemember(false))}
              >
                <Glyph name="sidebar" />
              </button>
            )}
            <nav className="crumbs" aria-label="Breadcrumb">
              <span className="crumb">
                <span className="here" aria-current="page">
                  <Glyph name="grid" />
                  <span>{crumb}</span>
                </span>
              </span>
            </nav>
          </div>
          <div className="right">
            <Link href="/help" className="btn help-link" title="How this screen works">
              ? Help
            </Link>
            <HeaderMenu label="Settings" className="gear" icon={<Glyph name="settings" />} title="Account">
              <Link href="/account/password" className="item" role="menuitem">
                Change password
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

  function renderGroup({ group, items }: (typeof GROUPS)[number]) {
    return (
      <div key={group} className="navgroup">
        <div className="grp">{group}</div>
        <div className="navitems">
          {items.map((item) =>
            item.href ? (
              <Link key={item.label} href={item.href} className={pathname === item.href ? "on" : ""}>
                <span className="ico"><Icon name={item.icon} /></span>
                {item.label}
              </Link>
            ) : (
              <a key={item.label} aria-disabled="true" title="Coming soon">
                <span className="ico"><Icon name={item.icon} /></span>
                {item.label}
              </a>
            ),
          )}
        </div>
      </div>
    );
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** Who is signed in, with password and sign-out behind it; closes on Escape and on any click outside. */
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
          <small>Speaker</small>
        </span>
        <span style={{ color: "var(--subtle-foreground)", display: "flex" }}>
          <Icon name="chevrons" size={12} />
        </span>
      </button>
    </div>
  );
}

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

/** Light / Dark / Match system (D-082), remembered per browser. */
function ThemeItems() {
  const [choice, setChoice] = useState<ThemeChoice>("light");

  useEffect(() => {
    setChoice(readThemeChoice());
  }, []);

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
