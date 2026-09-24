"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The event accent picker (D-092): a round palette — a ring of strong colours, an inner
 * ring of soft tints, white at the centre — with a rainbow rim that opens the system
 * picker for anything else, and a hex field for an exact brand colour.
 *
 * It replaced a free text box (wizard) and a bare `<input type="color">` (event
 * settings). The text box took anything, and the API stored it. The value is always
 * `#RRGGBB`, which the API now requires.
 */

/** Twelve strong colours, clockwise from the top. `#44C7F4` is the platform default. */
const OUTER = [
  "#E8364F",
  "#F2703A",
  "#F6B73C",
  "#A9D04A",
  "#34C471",
  "#1FB5A5",
  "#44C7F4",
  "#2F6FDB",
  "#5B4FD6",
  "#9B4FD1",
  "#D44BB8",
  "#EF5D8B",
];
/** Eight soft tints, for events that want a quiet accent. */
const INNER = ["#F7C6D0", "#FBDCC2", "#F6EDBE", "#CDEBC8", "#C4E9E6", "#C6DDF7", "#D6D0F4", "#EBCDEF"];
const CENTRE = "#FFFFFF";

const HEX = /^#[0-9a-f]{6}$/i;

const SIZE = 220;
const MID = SIZE / 2;

/** Where the n-th of `count` swatches sits on a ring of `radius`, starting at the top. */
const onRing = (index: number, count: number, radius: number) => {
  const angle = (index / count) * 2 * Math.PI - Math.PI / 2;
  return { x: MID + radius * Math.cos(angle), y: MID + radius * Math.sin(angle) };
};

export function ColorPicker({
  id,
  value,
  onChange,
  disabled = false,
  label = "Accent colour",
}: {
  id?: string;
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const system = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(value), [value]);

  const choose = (hex: string) => {
    const upper = hex.toUpperCase();
    setDraft(upper);
    onChange(upper);
  };

  // Below the trigger, kept on screen; above it when there is no room below.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const box = panel.current;
      if (!anchor || !box) return;
      const margin = 8;
      const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - box.offsetWidth - margin));
      const below = anchor.bottom + 6;
      const top =
        below + box.offsetHeight > window.innerHeight - margin && anchor.top - box.offsetHeight - 6 >= margin
          ? anchor.top - box.offsetHeight - 6
          : below;
      setPos({ top, left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const selected = value.toUpperCase();

  const swatch = (hex: string, x: number, y: number, diameter: number) => {
    const isSelected = hex === selected;
    return (
      <button
        key={hex}
        type="button"
        aria-label={hex}
        aria-pressed={isSelected}
        title={hex}
        onClick={() => choose(hex)}
        className="cp-swatch"
        style={{
          position: "absolute",
          left: x - diameter / 2,
          top: y - diameter / 2,
          width: diameter,
          height: diameter,
          borderRadius: "50%",
          background: hex,
          border: "none",
          padding: 0,
          cursor: "pointer",
          boxShadow: isSelected
            ? "0 0 0 3px var(--card, #fff), 0 0 0 5px var(--foreground, #111)"
            : "0 2px 6px rgba(0, 0, 0, .28), inset 0 0 0 1px rgba(255, 255, 255, .18)",
        }}
      />
    );
  };

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        className="btn"
        disabled={disabled}
        aria-label={`${label}: ${selected}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
        style={{ display: "inline-flex", alignItems: "center", gap: 10, paddingLeft: 8 }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: selected,
            boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, .18)",
          }}
        />
        <span className="mono">{selected}</span>
      </button>

      {open &&
        createPortal(
          <div
            ref={panel}
            role="dialog"
            aria-label={label}
            style={{
              position: "fixed",
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              visibility: pos ? "visible" : "hidden",
              zIndex: 1000,
              background: "var(--card, #1b1b1b)",
              border: "1px solid var(--border, rgba(255,255,255,.1))",
              borderRadius: 18,
              padding: 14,
              boxShadow: "0 18px 48px rgba(0, 0, 0, .35)",
            }}
          >
            <div style={{ position: "relative", width: SIZE, height: SIZE }}>
              {/* The rim: any colour at all, through the system picker. */}
              <button
                type="button"
                aria-label="Custom colour"
                title="Custom colour"
                onClick={() => system.current?.click()}
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  background:
                    "conic-gradient(from 0deg, #ff3b3b, #ff9f1a, #ffe23b, #5fd35f, #29c7c7, #3b7bff, #9b4dff, #ff3bc4, #ff3b3b)",
                  WebkitMask: "radial-gradient(circle, transparent 101px, #000 102px)",
                  mask: "radial-gradient(circle, transparent 101px, #000 102px)",
                }}
              />
              <input
                ref={system}
                type="color"
                tabIndex={-1}
                aria-hidden="true"
                value={HEX.test(selected) ? selected.toLowerCase() : "#44c7f4"}
                onChange={(event) => choose(event.target.value)}
                style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none", left: MID, top: MID }}
              />
              {OUTER.map((hex, index) => {
                const { x, y } = onRing(index, OUTER.length, 76);
                return swatch(hex, x, y, 40);
              })}
              {INNER.map((hex, index) => {
                const { x, y } = onRing(index + 0.5, INNER.length, 41);
                return swatch(hex, x, y, 32);
              })}
              {swatch(CENTRE, MID, MID, 40)}
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
              <span
                aria-hidden="true"
                style={{ width: 22, height: 22, borderRadius: "50%", background: HEX.test(draft) ? draft : "transparent", flexShrink: 0, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.2)" }}
              />
              <input
                className="mono"
                aria-label="Hex colour"
                value={draft}
                maxLength={7}
                spellCheck={false}
                onChange={(event) => {
                  const typed = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`;
                  setDraft(typed.toUpperCase());
                  if (HEX.test(typed)) onChange(typed.toUpperCase());
                }}
                style={{ width: 96, minWidth: 0 }}
              />
              <span style={{ flex: 1 }} />
              <button type="button" className="btn pri" onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
            {!HEX.test(draft) && (
              <div className="note" style={{ marginTop: 6 }}>
                Use six hex digits, e.g. #44C7F4.
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
