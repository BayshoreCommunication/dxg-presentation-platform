"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { changePassword, logout, ApiError } from "@/lib/api";

/**
 * Changing a password ends every other session, so it returns you to sign-in.
 *
 * The way out differs by how you got here. A voluntary change can simply be
 * abandoned. A forced first-use change cannot — the account is refused everywhere
 * else until it is done — so offering "back" there would be a button that returns
 * you to this same screen. Signing out is the honest escape, and the one someone
 * handed the wrong temporary password actually needs.
 */
export function ChangePasswordForm({ firstUse }: { firstUse: boolean }) {
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
      router.replace("/login?reason=password_changed");
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
          {firstUse ? "Set your own password before continuing" : "Change your password"}
        </div>

        {firstUse && (
          <div className="note" style={{ color: "var(--blue)", marginBottom: 12 }}>
            You signed in with a temporary password issued by DXG.
          </div>
        )}
        {error && (
          <div className="err" style={{ marginBottom: 12 }} role="alert">
            {error}
          </div>
        )}

        <div className="field">
          <label htmlFor="current">{firstUse ? "Temporary password" : "Current password"}</label>
          <input
            id="current"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="next">New password</label>
          <input
            id="next"
            type="password"
            autoComplete="new-password"
            required
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
          <div className="note" style={{ marginTop: 4 }}>
            At least 6 characters. Length matters more than symbols — a short phrase works well.
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
