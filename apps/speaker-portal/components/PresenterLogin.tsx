"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { presenterLogin, PortalError } from "@/lib/api";

const REASONS: Record<string, string> = {
  required: "Please sign in to see your presentation.",
  signed_out: "You have been signed out.",
};

/**
 * Presenters sign in with the email DXG holds for them plus the access code DXG
 * issued. Following the emailed link pre-fills the code; the email address is
 * still needed, so a forwarded email doesn't hand over the presentation.
 */
export function PresenterLogin({
  prefilledCode,
  reason,
}: {
  prefilledCode: string;
  reason: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState(prefilledCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await presenterLogin(email, code);
      router.replace("/portal");
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof PortalError ? caught.message : "Could not sign in. Please try again.",
      );
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="cbd">
        <h1 className="htitle" style={{ marginBottom: 2 }}>
          Speaker upload
        </h1>
        <div className="note" style={{ marginBottom: 16 }}>
          Sign in with the email address the organisers hold for you and the access code they sent.
        </div>

        {reason && REASONS[reason] && (
          <div className="note" style={{ color: "var(--blueDark)", marginBottom: 12 }}>
            {REASONS[reason]}
          </div>
        )}
        {error && (
          <div className="err" style={{ marginBottom: 12 }} role="alert">
            {error}
          </div>
        )}

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Your email address</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus={prefilledCode !== ""}
              required
              style={{ width: "100%" }}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className="field">
            <label htmlFor="code">Access code</label>
            <input
              id="code"
              className="mono"
              required
              style={{ width: "100%", letterSpacing: "0.12em", textTransform: "uppercase" }}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="XXXX-XXXX-XXXX"
              inputMode="text"
              autoCapitalize="characters"
              spellCheck={false}
            />
            <div className="note" style={{ marginTop: 4 }}>
              {prefilledCode
                ? "Filled in from your link — just confirm your email address."
                : "From the email the organisers sent. Capitals, spaces and dashes don't matter."}
            </div>
          </div>

          <button className="btn pri" style={{ width: "100%", padding: 9 }} disabled={busy} type="submit">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div className="note" style={{ textAlign: "center", marginTop: 14 }}>
          No account needed — the organisers issue your access code. If it has expired, ask them for a
          new one.
        </div>
      </div>
    </div>
  );
}
