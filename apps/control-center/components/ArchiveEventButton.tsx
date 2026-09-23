"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { archiveEvent, restoreEvent, ApiError } from "@/lib/api";

/**
 * Archive or restore one event (D-061). Archiving is reversible and deletes nothing,
 * but it does take the event off everyone's portfolio, so it asks first. After
 * archiving from inside the event, `redirectTo` sends the operator back to the list.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!archived) {
      const ok = window.confirm(
        `Archive "${eventName}"?\n\nIt leaves the portfolio for everyone on it. Nothing is deleted — files, talks and history stay, and it can be restored at any time.`,
      );
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      if (archived) await restoreEvent(eventId);
      else await archiveEvent(eventId);
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
      <button type="button" className="btn" disabled={busy} onClick={() => void run()}>
        {busy ? (archived ? "Restoring…" : "Archiving…") : archived ? "Restore" : "Archive"}
      </button>
      {error && (
        <span className="note" role="alert" style={{ color: "var(--block)", marginTop: 4 }}>
          {error}
        </span>
      )}
    </span>
  );
}
