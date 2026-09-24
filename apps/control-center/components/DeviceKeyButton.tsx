"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { issueDeviceKey, ApiError } from "@/lib/api";

/**
 * Gives a room's presentation computer its own key (D-077). Check-ins without the key
 * are refused, so nobody who merely knows a room's id can report it online. The key is
 * shown once, here, to be entered on that computer; a new one cancels the old — which is
 * also what to do if a laptop goes missing.
 */
export function DeviceKeyButton({ roomId, room, issuedAt }: { roomId: string; room: string; issuedAt: string | null }) {
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
      setError(failure instanceof ApiError ? failure.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  if (key) {
    return (
      <div style={{ border: "1px solid var(--warn)", borderRadius: 6, padding: 10, marginTop: 8, textAlign: "left" }}>
        <b>Device key for {room}</b>
        <div className="note" style={{ margin: "2px 0 6px" }}>
          Enter this on the room&rsquo;s presentation computer now. It will not be shown again.
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
        <span className="note">{issuedAt ? "The current key stops working." : "Issue the first key?"}</span>
        <button type="button" className="btn pri" style={{ padding: "4px 10px" }} disabled={busy} onClick={() => void issue()}>
          {busy ? "Issuing…" : "Issue key"}
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
      title={issuedAt ? `Key issued ${new Date(issuedAt).toLocaleString()}` : "This room's computer has no key and cannot check in"}
      onClick={() => setConfirming(true)}
    >
      {issuedAt ? "New device key" : "Issue device key"}
    </button>
  );
}
