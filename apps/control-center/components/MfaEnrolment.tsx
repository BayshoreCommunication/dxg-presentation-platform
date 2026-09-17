"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startMfaEnrolment, confirmMfaEnrolment, ApiError } from "@/lib/api";
import type { Enrolment } from "@/lib/api";

/**
 * Enrolment in three visible steps: take the secret, prove the app works, keep
 * the recovery codes. Nothing is switched on until the middle step succeeds, so
 * a mistyped secret cannot lock anyone out.
 */
export function MfaEnrolment() {
  const router = useRouter();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      setEnrolment(await startMfaEnrolment());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not start enrolment.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await confirmMfaEnrolment(code);
      setCodes(result.recovery_codes);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not confirm the code.");
    } finally {
      setBusy(false);
    }
  }

  if (codes) {
    return (
      <div className="login">
        <div className="box" style={{ width: 460 }}>
          <b>Save your recovery codes</b>
          <div style={{ fontSize: 13, margin: "4px 0 14px" }}>
            Each code works once. They are the only way back in if you lose your phone — this is the
            only time they are shown.
          </div>
          <div
            className="mono"
            style={{
              background: "var(--ink)",
              border: "1px solid #2A3B46",
              borderRadius: 6,
              padding: 14,
              lineHeight: 1.9,
              color: "var(--white)",
              columnCount: 2,
            }}
          >
            {codes.map((entry) => (
              <div key={entry}>{entry}</div>
            ))}
          </div>
          <button
            className="btn pri"
            style={{ width: "100%", padding: 9, marginTop: 14 }}
            onClick={() => {
              router.replace("/");
              router.refresh();
            }}
          >
            I have saved them — continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <div className="box" style={{ width: 460 }}>
        <b>Set up your authenticator</b>
        <div style={{ fontSize: 13, margin: "4px 0 14px" }}>
          DXG staff accounts need a second factor. Use any authenticator app — 1Password, Authy,
          Google Authenticator, Microsoft Authenticator.
        </div>

        {error && (
          <div className="err" style={{ marginBottom: 12 }} role="alert">
            {error}
          </div>
        )}

        {!enrolment ? (
          <button
            className="btn pri"
            style={{ width: "100%", padding: 9 }}
            disabled={busy}
            onClick={() => void begin()}
          >
            {busy ? "Preparing…" : "Start setup"}
          </button>
        ) : (
          <form onSubmit={confirm}>
            <div className="field">
              <label>1 · Add this secret to your app</label>
              <div
                className="mono"
                style={{
                  background: "var(--ink)",
                  border: "1px solid #2A3B46",
                  borderRadius: 6,
                  padding: "10px 12px",
                  color: "var(--white)",
                  wordBreak: "break-all",
                }}
              >
                {enrolment.secret_grouped}
              </div>
              <div className="note" style={{ marginTop: 6, color: "var(--dim)" }}>
                Account: {enrolment.account} · type SHA1, 6 digits, 30 seconds. Most apps offer
                &ldquo;enter a setup key&rdquo; for this.
              </div>
            </div>

            <div className="field">
              <label htmlFor="code">2 · Enter the code your app shows</label>
              <input
                id="code"
                className="mono"
                autoComplete="one-time-code"
                autoFocus
                required
                style={{ width: "100%", letterSpacing: "0.2em" }}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="000000"
              />
            </div>

            <button className="btn pri" style={{ width: "100%", padding: 9 }} disabled={busy} type="submit">
              {busy ? "Checking…" : "Turn on two-factor"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
