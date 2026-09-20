"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmPasswordReset, ApiError } from "@/lib/api";

export function ResetPassword({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ mfa: boolean } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await confirmPasswordReset(token, password);
      setDone({ mfa: result.mfa_still_required });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not reset the password.");
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="login">
        <div className="box">
          <b>DXG·PM</b>
          <div className="err" style={{ margin: "12px 0" }}>
            That link is missing its token. Request a new one.
          </div>
          <Link className="btn" style={{ width: "100%", display: "block", textAlign: "center" }} href="/forgot-password">
            Request a reset link
          </Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="login">
        <div className="box">
          <b>DXG·PM</b>
          <div style={{ fontSize: 13, margin: "4px 0 14px" }}>Password changed</div>
          <div className="note" style={{ color: "var(--blue)", marginBottom: 12 }}>
            Every session on your account has been signed out.
            {done.mfa
              ? " You will still need your authenticator to sign in — resetting a password does not replace your second factor."
              : ""}
          </div>
          <button
            className="btn pri"
            style={{ width: "100%", padding: 9 }}
            onClick={() => {
              router.replace("/login");
              router.refresh();
            }}
          >
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <form className="box" onSubmit={submit}>
        <b>DXG·PM</b>
        <div style={{ fontSize: 13, margin: "4px 0 18px" }}>Choose a new password</div>

        {error && (
          <div className="err" style={{ marginBottom: 12 }} role="alert">
            {error}
          </div>
        )}

        <div className="field">
          <label htmlFor="password">New password</label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            autoFocus
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <div className="note" style={{ marginTop: 4, color: "var(--dim)" }}>
            At least 6 characters. A short phrase beats a clever substitution.
          </div>
        </div>
        <div className="field">
          <label htmlFor="confirm">Confirm new password</label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </div>

        <button className="btn pri" style={{ width: "100%", padding: 9 }} disabled={busy} type="submit">
          {busy ? "Saving…" : "Set new password"}
        </button>

        {/*
          Reached from an emailed link with no session, so sign-in is the only place
          to go back to. Worth offering: someone who has since remembered their
          password should not have to burn the reset token to get out of here.
        */}
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <a href="/login" style={{ color: "var(--blue)", fontSize: 13 }}>
            ← Back to sign in
          </a>
        </div>
      </form>
    </div>
  );
}
