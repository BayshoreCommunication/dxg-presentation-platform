"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, setSrrOpen } from "@/lib/api";
import { ConfirmInline } from "@/components/ConfirmInline";

/**
 * The Speaker Ready Room's event-day switch (client review, D-157). Opening it lets
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

  // The switch is a DXG Admin's alone (D-193): pages don't render it for anyone else.
  if (!canSwitch) return null;

  return (
    <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      {/* A real on/off switch (D-157). */}
      <button
        type="button"
        role="switch"
        aria-checked={open}
        aria-label="Speaker Ready Room open"
        className={`srr-switch${open ? " on" : ""}`}
        disabled={busy || asking}
        onClick={() => (open ? setAsking(true) : void set(true))}
      >
        <span className="track" aria-hidden="true">
          <span className="knob" />
        </span>
        <span className="text">
          Speaker Ready Room: <b>{busy ? "…" : open ? "Open" : "Closed"}</b>
        </span>
      </button>
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
