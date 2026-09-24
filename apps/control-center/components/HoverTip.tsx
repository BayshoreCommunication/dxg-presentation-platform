"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A short hover/focus label for an icon-only control — what the button does.
 *
 * Portalled to <body> with fixed positioning, like InfoTip, so a table's scroll box or a
 * tile's stacking context cannot clip it. The wrapper carries the listeners because a
 * disabled button fires no mouse events of its own.
 */
export function HoverTip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const trigger = ref.current?.getBoundingClientRect();
    const tip = tipRef.current;
    if (!trigger || !tip) return;
    const margin = 8;
    const left = Math.max(
      margin,
      Math.min(
        trigger.left + trigger.width / 2 - tip.offsetWidth / 2,
        window.innerWidth - tip.offsetWidth - margin,
      ),
    );
    // Above the control; below it when there is no room at the top.
    const above = trigger.top - tip.offsetHeight - 6;
    setPos({ top: above >= margin ? above : trigger.bottom + 6, left });
  }, [open, label]);

  return (
    <span
      ref={ref}
      style={{ display: "inline-flex" }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open &&
        createPortal(
          <span
            ref={tipRef}
            role="tooltip"
            style={{
              position: "fixed",
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              visibility: pos ? "visible" : "hidden",
              zIndex: 1000,
              maxWidth: 240,
              background: "var(--ink)",
              color: "var(--white)",
              borderRadius: 6,
              padding: "5px 8px",
              fontSize: 12,
              lineHeight: 1.35,
              fontWeight: 500,
              whiteSpace: "nowrap",
              pointerEvents: "none",
              boxShadow: "0 6px 20px rgba(20, 24, 27, .18)",
            }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
