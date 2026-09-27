"use client";

import { useId, useState } from "react";

/**
 * A password input with a show/hide eye, and — for a new password — a three-part strength
 * bar (D-099). The bar mirrors the server's rules (`@pmp/auth` checkPassword: at least 6
 * characters, not a common password); the server still decides.
 */
const MINIMUM = 6;
/** The commonest passwords, as the server refuses them (a subset is enough for a hint). */
const COMMON = new Set([
  "password",
  "password1",
  "password123",
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "qwerty",
  "qwertyuiop",
  "abc123",
  "letmein",
  "letmein1",
  "welcome",
  "welcome1",
  "iloveyou",
  "admin",
  "changeme",
  "dxgpassword",
  "presentation",
]);

export type Strength = { score: 0 | 1 | 2 | 3; label: string };

export function passwordStrength(value: string): Strength {
  const password = value.normalize("NFKC");
  if (!password) return { score: 0, label: "" };
  if (password.length < MINIMUM) return { score: 1, label: `Too short — at least ${MINIMUM} characters` };
  if (COMMON.has(password.toLowerCase())) return { score: 1, label: "Too common — pick something unique to you" };
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  // Length carries most of the weight: a four-word phrase beats a short tangle of symbols.
  if (password.length >= 14 || (password.length >= 10 && kinds >= 3)) return { score: 3, label: "Strong" };
  return { score: 2, label: "Fair — longer is stronger (a short phrase works well)" };
}

const TONES = ["", "var(--red, #ef4444)", "var(--amber, #f59e0b)", "var(--green, #22c55e)"];

function Eye({ open }: { open: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      {open ? (
        <>
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : (
        // A closed eye, lashes down — as in the reference.
        <path d="M2 10c2.5 3.2 5.9 5 10 5s7.5-1.8 10-5M5.5 13.2 4 15.5M9.4 14.6 8.8 17.3M14.6 14.6l.6 2.7M18.5 13.2l1.5 2.3" />
      )}
    </svg>
  );
}

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  meter = false,
  matches,
  hint,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  /** Show the strength bar (new passwords). */
  meter?: boolean;
  /** For a confirm field: the password it must equal. */
  matches?: string;
  hint?: string;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  const [shown, setShown] = useState(false);
  const strength = meter ? passwordStrength(value) : null;
  const helpId = `${inputId}-help`;

  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <div style={{ position: "relative" }}>
        <input
          id={inputId}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={strength || matches !== undefined || hint ? helpId : undefined}
          spellCheck={false}
          autoCapitalize="none"
          style={{ width: "100%", paddingRight: 40 }}
        />
        <button
          type="button"
          onClick={() => setShown((now) => !now)}
          aria-label={shown ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={shown}
          title={shown ? "Hide" : "Show"}
          style={{
            position: "absolute",
            right: 6,
            top: "50%",
            transform: "translateY(-50%)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 30,
            height: 30,
            border: "none",
            background: "transparent",
            color: "var(--muted-foreground, #9ca3af)",
            cursor: "pointer",
            borderRadius: 6,
          }}
        >
          <Eye open={shown} />
        </button>
      </div>

      {strength && (
        <div id={helpId} style={{ marginTop: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }} aria-hidden="true">
            {[1, 2, 3].map((segment) => (
              <span
                key={segment}
                style={{
                  height: 4,
                  borderRadius: 2,
                  background: strength.score >= segment ? TONES[strength.score] : "var(--border, rgba(127,127,127,.3))",
                  transition: "background-color .2s",
                }}
              />
            ))}
          </div>
          <div className="note" style={{ marginTop: 6 }} aria-live="polite">
            {strength.label || hint}
          </div>
        </div>
      )}
      {!strength && matches !== undefined && value && (
        <div id={helpId} className="note" style={{ marginTop: 6, color: value === matches ? TONES[3] : undefined }} aria-live="polite">
          {value === matches ? "✓ Passwords match" : "Doesn’t match yet"}
        </div>
      )}
      {!strength && matches === undefined && hint && (
        <div id={helpId} className="note" style={{ marginTop: 6 }}>
          {hint}
        </div>
      )}
    </div>
  );
}
