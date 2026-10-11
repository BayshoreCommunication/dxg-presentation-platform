"use client";

import { useEffect } from "react";

/**
 * The one toast for the whole site (Travis, 2026-10-11): a message that closes itself after
 * six seconds and has a close button for anyone who has read it sooner. Every screen that
 * used to draw its own `.toast` renders this instead, so they cannot drift apart.
 */
const SHOWN_FOR_MS = 6000;

export function Toast({ message, onClose }: { message: string | null; onClose: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onClose, SHOWN_FOR_MS);
    return () => clearTimeout(timer);
  }, [message, onClose]);

  return (
    <div className={`toast ${message ? "show" : ""}`} role="status" aria-live="polite">
      {message && (
        <>
          <span className="toast-text">{message}</span>
          <button type="button" className="toast-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </>
      )}
    </div>
  );
}
