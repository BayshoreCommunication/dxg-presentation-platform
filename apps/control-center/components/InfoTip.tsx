"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A small "ⓘ" that explains the thing beside it in plain language (D-065).
 *
 * Opened by click, not hover: hover does not exist on a tablet in the Speaker Ready
 * Room, and a hover-only explanation is one most people never find. Closes on a click
 * elsewhere or Escape, like the agenda's action menu.
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

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
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
    <span ref={ref} style={{ position: "relative", display: "inline-block", verticalAlign: "middle" }}>
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
      {open && (
        <span
          role="tooltip"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            [align === "right" ? "right" : "left"]: -8,
            zIndex: 30,
            width,
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
        </span>
      )}
    </span>
  );
}
