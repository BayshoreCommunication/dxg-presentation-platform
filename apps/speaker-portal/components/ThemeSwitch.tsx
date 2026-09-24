"use client";

import { useEffect, useRef, useState } from "react";
import { applyTheme, readThemeChoice, saveThemeChoice } from "@/lib/theme";
import type { ThemeChoice } from "@/lib/theme";

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match system" },
];

/**
 * The speaker portal's Light / Dark / Match system switch (D-084). The control center keeps
 * it in its settings menu; the portal has none, so it sits above every page, sign-in included.
 */
export function ThemeSwitch() {
  const [choice, setChoice] = useState<ThemeChoice>("light");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => setChoice(readThemeChoice()), []);

  useEffect(() => {
    if (choice !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => applyTheme("system");
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [choice]);

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

  const current = OPTIONS.find((option) => option.value === choice)?.label ?? "Light";

  return (
    <div className="theme-switch" ref={root}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Appearance: ${current}`}
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M8 14.667A6.667 6.667 0 1 0 8 1.333v13.334Z"
            fill="currentColor"
          />
          <path
            d="M8 14.667A6.667 6.667 0 1 0 8 1.333a6.667 6.667 0 0 0 0 13.334Z"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
        {current}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="label">Appearance</div>
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="item"
              role="menuitemradio"
              aria-checked={choice === option.value}
              onClick={() => {
                saveThemeChoice(option.value);
                setChoice(option.value);
                setOpen(false);
              }}
            >
              {option.label}
              {choice === option.value && <span className="tick">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
