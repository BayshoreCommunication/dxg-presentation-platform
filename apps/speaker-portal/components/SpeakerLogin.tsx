"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { login, PortalError } from "@/lib/api";
import { PasswordField } from "@/components/PasswordField";

const REASONS: Record<string, string> = {
  required: "Please sign in to see your presentations.",
  signed_out: "You have been signed out.",
  password_changed: "Password changed — sign in with your new password.",
};

/**
 * Speakers sign in with the email address DXG holds for them and the password from their
 * invitation (D-147, D-148). There is no signup: the DXG team sends the sign-in.
 */
export function SpeakerLogin({ reason }: { reason: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await login(email, password);
      // A staff member's password is not a speaker's sign-in: the session it opens lives on
      // the staff site, and this one has nothing to show them.
      if (result.step !== "signed_in" || result.principal?.account_kind !== "speaker") {
        setError("This sign-in is for speakers. DXG staff sign in on the staff site.");
        setBusy(false);
        return;
      }
      router.replace(result.principal.must_change_password ? "/account/password?first=1" : "/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof PortalError ? caught.message : "Could not sign in. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="box" onSubmit={submit}>
        <b>DXG·PM</b>
        <div style={{ fontSize: 13, margin: "4px 0 18px" }}>Manage your presentations</div>

        {reason && REASONS[reason] && (
          <div className="note" style={{ marginBottom: 12 }}>
            {REASONS[reason]}
          </div>
        )}
        {error && (
          <div className="err" style={{ marginBottom: 12 }} role="alert">
            {error}
          </div>
        )}

        <div className="field">
          <label htmlFor="email">Your email address</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            autoFocus
            required
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <PasswordField id="password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />

        <button className="btn pri" style={{ width: "100%", padding: 9 }} disabled={busy} type="submit">
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <div style={{ textAlign: "center", fontSize: 12.5, marginTop: 12 }}>
          <Link href="/forgot-password">Forgotten your password?</Link>
        </div>
        <div style={{ textAlign: "center", fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 8 }}>
          Your sign-in was emailed to you by the DXG team. Not received it? Ask the team who invited you.
        </div>
      </form>
    </div>
  );
}
