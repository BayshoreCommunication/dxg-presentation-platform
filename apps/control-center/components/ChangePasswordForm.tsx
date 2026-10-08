"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PasswordField } from "@/components/PasswordField";
import Link from "next/link";
import { changePassword, getSession, logout, ApiError } from "@/lib/api";

/**
 * Changing a password ends every other session, so it returns you to sign-in.
 *
 * The way out differs by how you got here. A voluntary change can simply be
 * abandoned. A forced first-use change cannot — the account is refused everywhere
 * else until it is done — so offering "back" there would be a button that returns
 * you to this same screen. Signing out is the honest escape, and the one someone
 * handed the wrong temporary password actually needs.
 */
export function ChangePasswordForm({ firstUse, speaker = false }: { firstUse: boolean; speaker?: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (next !== confirm) {
      setError("The two new passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      // Still signed in (D-108): straight on to the sign-in app if it is not set up yet,
      // instead of back to the sign-in page for one more round trip.
      const session = await getSession().catch(() => null);
      if (!session) router.replace("/login?reason=password_changed");
      // A speaker (D-146) is not asked for a sign-in app; they go straight to their presentations.
      else if (session.principal.account_kind === "speaker") router.replace("/presentations");
      else router.replace(session.principal.mfa_enrolled ? "/" : "/account/mfa");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not change the password.");
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="box" onSubmit={submit}>
        <b>DXG·PM</b>
        <div style={{ fontSize: 13, margin: "4px 0 18px" }}>
          {firstUse ? (speaker ? "Choose your own password" : "Step 1 of 2 · Choose your own password") : "Change your password"}
        </div>

        {firstUse && (
          <div className="note" style={{ color: "var(--blue)", marginBottom: 12 }}>
            You signed in with the temporary password DXG emailed you. Choose your own now
            {speaker ? "." : "; next you’ll set up a sign-in app on your phone."}
          </div>
        )}
        {error && (
          <div className="err" style={{ marginBottom: 12 }} role="alert">
            {error}
          </div>
        )}

        <PasswordField
          id="current"
          label={firstUse ? "Temporary password" : "Current password"}
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
        />
        <PasswordField id="next" label="New password" value={next} onChange={setNext} autoComplete="new-password" meter />
        <PasswordField
          id="confirm"
          label="Confirm new password"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          matches={next}
        />

        <button className="btn pri" style={{ width: "100%", padding: 9 }} disabled={busy} type="submit">
          {busy ? "Saving…" : "Set password"}
        </button>

        <div style={{ marginTop: 12, textAlign: "center" }}>
          {firstUse ? (
            <button
              type="button"
              className="linkish"
              style={{ background: "none", border: 0, color: "var(--blue)", cursor: "pointer", fontSize: 13 }}
              onClick={() => void logout().then(() => router.replace("/login"))}
            >
              Sign out instead
            </button>
          ) : (
            <Link href="/" style={{ color: "var(--blue)", fontSize: 13 }}>
              ← Back without changing it
            </Link>
          )}
        </div>
      </form>
    </div>
  );
}
