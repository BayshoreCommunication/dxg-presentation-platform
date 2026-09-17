"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordReset, ApiError } from "@/lib/api";

/** The confirmation is the same whether or not the address has an account. */
export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not send the reset email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="box">
        <b>DXG·PM</b>
        <div style={{ fontSize: 13, margin: "4px 0 18px" }}>Reset your password</div>

        {sent ? (
          <>
            <div className="note" style={{ color: "var(--blue)", marginBottom: 12 }}>
              If that address belongs to an account, a reset link is on its way. It works once and
              expires in 30 minutes.
            </div>
            <div className="note" style={{ color: "var(--dim)", marginBottom: 14 }}>
              Nothing arriving? Check the address, or ask a platform admin — they can reset it for
              you directly.
            </div>
            <Link className="btn" style={{ width: "100%", display: "block", textAlign: "center" }} href="/login">
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={submit}>
            {error && (
              <div className="err" style={{ marginBottom: 12 }} role="alert">
                {error}
              </div>
            )}
            <div className="field">
              <label htmlFor="email">Work email</label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                autoFocus
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <button className="btn pri" style={{ width: "100%", padding: 9 }} disabled={busy} type="submit">
              {busy ? "Sending…" : "Email me a reset link"}
            </button>
            <div style={{ textAlign: "center", fontSize: 12.5, marginTop: 12 }}>
              <Link href="/login" style={{ color: "var(--blue)" }}>
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
