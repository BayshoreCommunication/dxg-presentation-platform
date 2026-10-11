"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { getNotifications, markNotificationsRead } from "@/lib/api";
import type { SpeakerNotification } from "@/lib/api";
import { Glyph } from "@/components/Icon";

/**
 * The bell (Travis, 2026-10-11): what the DXG team told the speaker — changes needed, not
 * accepted, approved — inside the site, not only by email. The unread count sits on the
 * bell; opening the list marks what is shown as read. Refreshed on every page change and
 * every minute while the tab is open.
 */
const REFRESH_MS = 60_000;

const KIND_WORDS: Record<SpeakerNotification["kind"], string> = {
  changes_requested: "Changes needed",
  rejected: "Not accepted",
  approved: "Approved",
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function NotificationBell() {
  const pathname = usePathname();
  const [items, setItems] = useState<SpeakerNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await getNotifications();
      setItems(result.items);
      setUnread(result.unread);
    } catch {
      // A refused or failed fetch leaves the last known list; the next refresh tries again.
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

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

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      // Seen is read: what the list shows is what the speaker has now been told.
      const shown = items.filter((item) => !item.read_at).map((item) => item.id);
      setItems((current) => current.map((item) => (item.read_at ? item : { ...item, read_at: new Date().toISOString() })));
      setUnread(0);
      await markNotificationsRead(shown).catch(() => undefined);
    }
  }

  return (
    <div className="hmenu" ref={root}>
      <button
        type="button"
        className="ibtn bell"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-haspopup="menu"
        aria-expanded={open}
        data-state={open ? "open" : "closed"}
        onClick={() => void toggle()}
        style={{ position: "relative" }}
      >
        <Glyph name="bell" />
        {unread > 0 && <span className="bell-count">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="menu notices" role="menu">
          <div className="label">From the DXG team</div>
          {items.length === 0 ? (
            <div className="note" style={{ padding: "8px 10px" }}>
              Nothing yet. You&rsquo;ll see it here when the team reviews your presentation.
            </div>
          ) : (
            items.slice(0, 20).map((item) => (
              <Link key={item.id} href="/" className="item notice" role="menuitem" onClick={() => setOpen(false)}>
                <span className="notice-head">
                  <span className={`chip ${item.kind === "approved" ? "c-ok" : item.kind === "rejected" ? "c-bad" : "c-warn"}`}>
                    {KIND_WORDS[item.kind]}
                  </span>
                  <span className="note">{when(item.created_at)}</span>
                </span>
                <b>{item.title}</b>
                {item.body && <span className="notice-body">{item.body}</span>}
                <span className="note">{item.event_name}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
