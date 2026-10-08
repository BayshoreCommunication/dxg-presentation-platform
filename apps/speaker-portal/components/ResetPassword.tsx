"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmPasswordReset, PortalError } from "@/lib/api";
import { PasswordField } from "@/components/PasswordField";

export function ResetPassword({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await confirmPasswordReset(token, password);
      setDone(true);
    } catch (caught) {
      setError(caught instanceof PortalError ? caught.message : "Could not reset the password.");
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="login">
        <div className="box">
          <b>DXG·PM</b>
          <div className="err" style={{ margin: "12px 0" }}>
            This reset link is incomplete. Request a new one.
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
          <div className="note" style={{ marginBottom: 12 }}>
            Every session on your account has been signed out. Sign in with your new password.
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
        <PasswordField id="password" label="New password" value={password} onChange={setPassword} autoComplete="new-password" meter />
        <PasswordField id="confirm" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" matches={password} />
        <button className="btn pri" style={{ width: "100%", padding: 9 }} disabled={busy} type="submit">
          {busy ? "Saving…" : "Set new password"}
        </button>
        <div style={{ marginTop: 12, textAlign: "center", fontSize: 13 }}>
          <Link href="/login">← Back to sign in</Link>
        </div>
      </form>
    </div>
  );
}
