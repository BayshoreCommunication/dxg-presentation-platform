"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A row's action menu, drawn on <body> with fixed positioning (D-107).
 *
 * Rendered inside its table it was clipped by the card around it — the recurring bug class
 * this app keeps meeting (D-094): the Speaker Ready Room's "At which station?" menu showed
 * the first two stations and hid the rest, so the one free station could not be picked.
 * Here the menu is placed under its button (right edges aligned), flips above when there
 * is no room below, follows scrolling, and closes on a click outside or Escape.
 */
export function useFloatingMenu() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (trigger.current?.contains(target) || menu.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return { open, setOpen, close, trigger, menu };
}

export function FloatingMenu({
  open,
  trigger,
  menu,
  width = 190,
  children,
}: {
  open: boolean;
  trigger: React.RefObject<HTMLButtonElement | null>;
  menu: React.RefObject<HTMLDivElement | null>;
  width?: number;
  children: React.ReactNode;
}) {
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const position = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const height = menu.current?.offsetHeight ?? 0;
      const gap = 6;
      const below = anchor.bottom + gap;
      const fitsBelow = below + height <= window.innerHeight - 8;
      const top = fitsBelow || anchor.top - gap - height < 8 ? below : anchor.top - gap - height;
      const left = Math.min(Math.max(8, anchor.right - width), window.innerWidth - width - 8);
      setPlace({ top, left });
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [open, trigger, menu, width]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={menu}
      className="menu floating"
      role="menu"
      style={{
        position: "fixed",
        width,
        top: place?.top ?? 0,
        left: place?.left ?? 0,
        // Measured once before it is shown, so it never flashes in the wrong place.
        visibility: place ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
