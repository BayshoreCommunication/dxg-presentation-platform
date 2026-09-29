"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startPracticeEvent, ApiError, PRACTICE_LIMIT } from "@/lib/api";
import { WhyNot } from "@/components/WhyNot";

/**
 * "Start a practice event" (D-116). Builds a realistic event of your own — made-up
 * speakers, real files in every state — and opens it. Greyed, with the reason, once the
 * person already has the most they may have open.
 */
export function StartPracticeButton({ open }: { open: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = open >= PRACTICE_LIMIT;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await startPracticeEvent();
      router.push(`/events/${created.event_id}`);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Could not connect. Check the internet connection and try again."); // D-112
      setBusy(false);
    }
  };

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end" }}>
      <button type="button" className="btn pri" disabled={busy || full} onClick={() => void start()}>
        {busy ? "Setting up your practice event…" : "Start a practice event"}
      </button>
      <WhyNot
        reason={
          full
            ? `You have ${PRACTICE_LIMIT} practice events open. Archive one you've finished with to start another.`
            : null
        }
      />
      {busy && <span className="note" style={{ marginTop: 4 }}>This takes a few seconds.</span>}
      {error && <span className="err" style={{ marginTop: 6, marginBottom: 0 }}>{error}</span>}
    </span>
  );
}
