"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, setSrrOpen } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { ConfirmInline } from "@/components/ConfirmInline";

/**
 * The Speaker Ready Room's event-day switch (client review, D-156). Opening it lets
 * technicians check speakers in, take files in at a desk and sign off; closing it stops
 * those (a speaker at a desk can still check out). Closing asks first.
 */
export function SrrSwitch({ eventId, open, canSwitch }: { eventId: string; open: boolean; canSwitch: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await setSrrOpen(eventId, next);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span className={`chip ${open ? "c-ok" : "c-warn"}`}>Speaker Ready Room {open ? "open" : "closed"}</span>
      {canSwitch &&
        (open ? (
          <button type="button" className="btn" disabled={busy || asking} onClick={() => setAsking(true)}>
            <Icon name="pause" />
            Close it
          </button>
        ) : (
          <button type="button" className="btn pri" disabled={busy} onClick={() => void set(true)}>
            <Icon name="play" />
            {busy ? "Opening…" : "Open the Speaker Ready Room"}
          </button>
        ))}
      {asking && (
        <ConfirmInline
          question="Close the Speaker Ready Room?"
          detail="Technicians can't check speakers in, take files in at a desk or sign off until it is opened again. A speaker at a desk can still check out."
          confirmLabel="Close it"
          icon="pause"
          busyLabel="Closing…"
          onConfirm={() => setSrrOpen(eventId, false).then(() => router.refresh())}
          onClose={() => setAsking(false)}
        />
      )}
      {error && <span className="err">{error}</span>}
    </span>
  );
}
