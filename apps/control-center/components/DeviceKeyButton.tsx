"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatSessionTime } from "@pmp/format";
import { issueDeviceKey, ApiError } from "@/lib/api";

/**
 * Gives a room's presentation computer its own key (D-077). Check-ins without the key
 * are refused, so nobody who merely knows a room's id can report it online. The key is
 * shown once, here, to be entered on that computer; a new one cancels the old — which is
 * also what to do if a laptop goes missing.
 *
 * The issue time is on the event's clock with a fixed locale: the server and the
 * browser must render the same string, or React reports a hydration mismatch.
 */
export function DeviceKeyButton({
  roomId,
  room,
  issuedAt,
  timezone,
}: {
  roomId: string;
  room: string;
  issuedAt: string | null;
  timezone: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await issueDeviceKey(roomId);
      setKey(result.device_key);
      setConfirming(false);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Could not connect. Check the internet connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (key) {
    return (
      <div style={{ border: "1px solid var(--warn)", borderRadius: 6, padding: 10, marginTop: 8, textAlign: "left" }}>
        <b>Room PC connection code for {room}</b>
        <div className="note" style={{ margin: "2px 0 6px" }}>
          {/* Where it goes, in one line (R41, D-112). */}
          Enter it once on this room&rsquo;s PC, when it asks for its connection code during setup (or give it to
          whoever sets that PC up). Copy it now — it won&rsquo;t be shown again.
        </div>
        <code className="mono" style={{ display: "block", wordBreak: "break-all", background: "var(--mist)", padding: 8, borderRadius: 4 }}>
          {key}
        </code>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button
            type="button"
            className="btn"
            onClick={() => {
              void navigator.clipboard?.writeText(key).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" className="btn" onClick={() => setKey(null)}>
            Done
          </button>
        </div>
      </div>
    );
  }

  if (confirming) {
    return (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
        <span className="note">
          {issuedAt ? "The room PC disconnects until the new code is entered on it." : "Issue the first code?"}
        </span>
        <button type="button" className="btn pri" style={{ padding: "4px 10px" }} disabled={busy} onClick={() => void issue()}>
          {busy ? "Issuing…" : "Issue code"}
        </button>
        <button type="button" className="btn" style={{ padding: "4px 10px" }} disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </button>
        {error && (
          <span className="note" style={{ color: "var(--block)", width: "100%", textAlign: "right" }}>
            {error}
          </span>
        )}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="btn"
      style={{ padding: "4px 10px" }}
      title={
        issuedAt
          ? `Code issued ${formatSessionTime(issuedAt, timezone)}`
          : "This room PC isn't connected yet. Issue a code and enter it on the room PC."
      }
      onClick={() => setConfirming(true)}
    >
      {issuedAt ? "New connection code" : "Issue connection code"}
    </button>
  );
}
