"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { changePassword, logout, PortalError } from "@/lib/api";
import { PasswordField } from "@/components/PasswordField";

/**
 * Choosing a password. A first-use change (the temporary one from the invitation) cannot be
 * abandoned — nothing else opens until it is done — so signing out is the only other way out.
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
      router.replace("/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof PortalError ? caught.message : "Could not change the password.");
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="box" onSubmit={submit}>
        <b>DXG·PM</b>
        <div style={{ fontSize: 13, margin: "4px 0 18px" }}>{firstUse ? "Choose your own password" : "Change your password"}</div>

        {firstUse && (
          <div className="note" style={{ marginBottom: 12 }}>
            You signed in with the temporary password DXG emailed you. Choose your own now.
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
        <PasswordField id="confirm" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" matches={next} />

        <button className="btn pri" style={{ width: "100%", padding: 9 }} disabled={busy} type="submit">
          {busy ? "Saving…" : "Set password"}
        </button>

        <div style={{ marginTop: 12, textAlign: "center", fontSize: 13 }}>
          {firstUse ? (
            <button
              type="button"
              style={{ background: "none", border: 0, color: "inherit", cursor: "pointer", fontSize: 13, textDecoration: "underline" }}
              onClick={() => void logout().catch(() => undefined).then(() => router.replace("/login"))}
            >
              Sign out instead
            </button>
          ) : (
            <Link href="/">← Back without changing it</Link>
          )}
        </div>
      </form>
    </div>
  );
}
