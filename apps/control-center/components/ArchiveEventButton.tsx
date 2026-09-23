"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { archiveEvent, restoreEvent, ApiError } from "@/lib/api";

/**
 * Archive or restore one event (D-061). Archiving is reversible and deletes nothing,
 * but it takes the event off everyone's portfolio and makes it read-only (D-062), so
 * it asks first. After archiving from inside the event, `redirectTo` sends the
 * operator back to the list.
 *
 * The question is asked in the page, not with `window.confirm`: embedded browsers
 * (the desktop app's preview pane among them) answer a native dialog with an instant
 * "cancel" without ever showing it, which made the button look dead.
 */
export function ArchiveEventButton({
  eventId,
  eventName,
  archived,
  redirectTo,
}: {
  eventId: string;
  eventName: string;
  archived: boolean;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (archived) await restoreEvent(eventId);
      else await archiveEvent(eventId);
      setConfirming(false);
      if (!archived && redirectTo) router.push(redirectTo);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end" }}>
      {confirming ? (
        <span style={{ display: "inline-flex", gap: 6 }}>
          <button
            type="button"
            className="btn pri"
            disabled={busy}
            onClick={() => void run()}
            title={`Archive "${eventName}". Nothing is deleted; it can be restored at any time.`}
          >
            {busy ? "Archiving…" : "Confirm archive"}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => (archived ? void run() : setConfirming(true))}
        >
          {busy ? "Restoring…" : archived ? "Restore" : "Archive"}
        </button>
      )}
      {confirming && !error && (
        <span className="note" style={{ marginTop: 4, maxWidth: 260, textAlign: "right" }}>
          Hides it from the portfolio and makes it read-only. Nothing is deleted.
        </span>
      )}
      {error && (
        <span className="note" role="alert" style={{ color: "var(--block)", marginTop: 4 }}>
          {error}
        </span>
      )}
    </span>
  );
}
