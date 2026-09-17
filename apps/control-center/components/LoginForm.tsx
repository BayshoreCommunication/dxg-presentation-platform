"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, verifyMfa, ApiError } from "@/lib/api";

const REASONS: Record<string, string> = {
  expired: "Your session expired. Please sign in again.",
  signed_out: "You have been signed out.",
  password_changed: "Password changed — sign in with your new password.",
  required: "Please sign in to continue.",
};

/** Staff sign-in. There is no signup: DXG accounts are created by an admin. */
export function LoginForm({ next, reason }: { next: string; reason: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"password" | "code">("password");
  const [code, setCode] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === "password") {
        const result = await login(email, password);
        if (result.step === "mfa_required") {
          setStep("code");
          setBusy(false);
          return;
        }
        router.replace(result.principal.must_change_password ? "/account/password?first=1" : next);
      } else {
        const result = await verifyMfa(code);
        router.replace(result.principal.must_change_password ? "/account/password?first=1" : next);
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not sign in. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="box" onSubmit={submit}>
        <b>DXG·PM</b>
        <div style={{ fontSize: 13, margin: "4px 0 18px" }}>
          Presentation Management Platform · Staff access
        </div>

        {reason && REASONS[reason] && (
          <div className="note" style={{ color: "var(--blue)", marginBottom: 12 }}>
            {REASONS[reason]}
          </div>
        )}
        {error && (
          <div className="err" style={{ marginBottom: 12 }} role="alert">
            {error}
          </div>
        )}

        {step === "code" ? (
          <>
            <div className="note" style={{ marginBottom: 12 }}>
              Enter the six-digit code from your authenticator app. If you have lost your phone, use
              one of your recovery codes instead.
            </div>
            <div className="field">
              <label htmlFor="code">Authentication code</label>
              <input
                id="code"
                className="mono"
                inputMode="text"
                autoComplete="one-time-code"
                autoFocus
                required
                style={{ letterSpacing: "0.2em" }}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="000000"
              />
            </div>
            <button
              className="btn pri"
              style={{ width: "100%", padding: 9 }}
              disabled={busy}
              type="submit"
            >
              {busy ? "Checking…" : "Verify"}
            </button>
            <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--dim)", marginTop: 12 }}>
              <button
                type="button"
                style={{ background: "none", border: "none", color: "var(--blue)", fontSize: 12.5 }}
                onClick={() => {
                  setStep("password");
                  setCode("");
                  setError(null);
                }}
              >
                Start again
              </button>
            </div>
          </>
        ) : (
          <>
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
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <button className="btn pri" style={{ width: "100%", padding: 9 }} disabled={busy} type="submit">
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <div style={{ textAlign: "center", fontSize: 12.5, marginTop: 12 }}>
          <a href="/forgot-password" style={{ color: "var(--blue)" }}>
            Forgotten your password?
          </a>
        </div>
        <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--dim)", marginTop: 8 }}>
          Accounts are created by DXG — there is no signup.
        </div>
          </>
        )}
      </form>
    </div>
  );
}
