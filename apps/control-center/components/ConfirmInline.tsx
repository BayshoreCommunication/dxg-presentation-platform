"use client";

import { useState } from "react";

/**
 * "Are you sure?" asked on the page (D-113, UX_REVIEW batch 5). `window.confirm` and
 * `window.prompt` are dismissed unseen by the desktop app's browser (D-073), and a blind
 * click must never email people, merge records or take someone's access away. Say what
 * will happen and to whom, then offer the action and a way out.
 *
 *   {asking && (
 *     <ConfirmInline
 *       question="Email Dana Lee a new temporary password?"
 *       detail="Their open sessions end and they choose a new password at next sign-in."
 *       confirmLabel="Send new password"
 *       busyLabel="Sending…"
 *       onConfirm={() => resetPassword(user.id)}
 *       onClose={() => setAsking(false)}
 *     />
 *   )}
 *
 * `onConfirm` may throw; its message is shown here and the box stays open.
 */
export function ConfirmInline({
  question,
  detail,
  confirmLabel,
  busyLabel = "Working…",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onClose,
}: {
  question: string;
  detail?: string;
  confirmLabel: string;
  busyLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`confirm-inline${danger ? " danger" : ""}`} role="alertdialog" aria-label={question}>
      <b>{question}</b>
      {detail && <div className="note">{detail}</div>}
      {error && (
        <div className="err" style={{ margin: "8px 0 0" }}>
          {error}
        </div>
      )}
      <div className="confirm-inline-actions">
        <button type="button" className={danger ? "btn danger" : "btn pri"} disabled={busy} onClick={() => void go()} autoFocus>
          {busy ? busyLabel : confirmLabel}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onClose}>
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
