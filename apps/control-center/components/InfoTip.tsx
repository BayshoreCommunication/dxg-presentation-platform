"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A small "ⓘ" that explains the thing beside it in plain language (D-065).
 *
 * Opened by click, not hover: hover does not exist on a tablet in the Speaker Ready
 * Room, and a hover-only explanation is one most people never find. Closes on a click
 * elsewhere or Escape, like the agenda's action menu.
 *
 * The bubble is portalled to <body> with fixed positioning. Rendered in place it was
 * trapped in its host's stacking context — each KPI tile animates in, so the next tile
 * and the tile's own panel painted over it and the text was cut off.
 */
export function InfoTip({
  label,
  children,
  align = "left",
  width = 260,
}: {
  label: string;
  children: React.ReactNode;
  align?: "left" | "right";
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const trigger = ref.current?.getBoundingClientRect();
      if (!trigger) return;
      const margin = 8;
      const tipHeight = tipRef.current?.offsetHeight ?? 0;
      const tipWidth = Math.min(width, window.innerWidth - margin * 2);
      let left =
        align === "right" ? trigger.right + 8 - tipWidth : trigger.left - 8;
      left = Math.max(
        margin,
        Math.min(left, window.innerWidth - tipWidth - margin),
      );
      let top = trigger.bottom + 6;
      // Flip above the trigger when it would run off the bottom of the viewport.
      if (
        tipHeight &&
        top + tipHeight > window.innerHeight - margin &&
        trigger.top - 6 - tipHeight >= margin
      ) {
        top = trigger.top - 6 - tipHeight;
      }
      setPos({ top, left });
    };
    place();
    // A second pass once the bubble has a measured height, for the flip.
    const frame = requestAnimationFrame(place);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !tipRef.current?.contains(target))
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      style={{
        position: "relative",
        display: "inline-block",
        verticalAlign: "middle",
      }}
    >
      <button
        type="button"
        aria-label={`What is ${label}?`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        style={{
          border: "1px solid var(--line)",
          background: "var(--white)",
          color: "var(--dim)",
          borderRadius: "50%",
          width: 16,
          height: 16,
          fontSize: 10,
          lineHeight: "14px",
          padding: 0,
          marginLeft: 5,
          cursor: "pointer",
          fontWeight: 700,
          textTransform: "none",
          letterSpacing: 0,
        }}
      >
        i
      </button>
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
              width,
              maxWidth: "calc(100vw - 16px)",
              background: "var(--ink)",
              color: "var(--white)",
              borderRadius: 6,
              padding: "10px 12px",
              fontSize: 12.5,
              lineHeight: 1.45,
              fontWeight: 400,
              letterSpacing: 0,
              textTransform: "none",
              boxShadow: "0 6px 20px rgba(20, 24, 27, .18)",
              textAlign: "left",
              // The trigger often sits in a `nowrap` line; the explanation must still wrap.
              whiteSpace: "normal",
            }}
          >
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}
