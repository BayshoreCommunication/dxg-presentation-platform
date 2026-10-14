"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, getComms, NEW_VERSION_REMINDER_NAME, REMINDER_TEMPLATE_NAME, sendBatch } from "@/lib/api";
import { Icon } from "@/components/Icon";

/**
 * A speaker action on Action needed — "Get the file", "Get the new version", "Get a clean copy" —
 * that sends the reminder right there instead of leaving for Communications (D-180). One click
 * opens "Send <reminder> to <speaker>?"; the send names that speaker only, so every guard on
 * sending still applies (address, bounce, staff address, cooldown), and the result is said in
 * place. Communications stays one link away for a preview or an edit first.
 */
export function RemindSpeaker({
  eventId,
  speakerId,
  speakerName,
  label,
  todo,
  newVersion,
  practice,
}: {
  eventId: string;
  speakerId: string;
  speakerName: string;
  label: string;
  todo: string;
  /** The "new version needed" reminder (D-178) rather than the missing-file one. */
  newVersion: boolean;
  /** A practice event's mail is recorded, never sent (D-116). */
  practice: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const templateName = newVersion ? NEW_VERSION_REMINDER_NAME : REMINDER_TEMPLATE_NAME;
  const commsHref = `/events/${eventId}/comms?remind=${speakerId}${newVersion ? "&reminder=new_version" : ""}`;

  async function send() {
    setBusy(true);
    setResult(null);
    try {
      const { templates } = await getComms(eventId);
      const template = templates.find((row) => row.name === templateName);
      if (!template) {
        setResult({ ok: false, text: `This event has no “${templateName}” template — add it on Communications.` });
        return;
      }
      const sent = await sendBatch(eventId, template.id, newVersion ? "new_version" : false, [speakerId]);
      const skipped = sent.skipped.map((entry) => entry.reason).join(", ");
      setResult(
        sent.queued > 0
          ? { ok: true, text: practice ? `Recorded for ${speakerName} — a practice event never sends.` : `Reminder sent to ${speakerName}.` }
          : { ok: false, text: `Not sent — ${skipped || "this speaker can't be emailed"}.` },
      );
      if (sent.queued > 0) {
        setOpen(false);
        router.refresh();
      }
    } catch (caught) {
      setResult({ ok: false, text: caught instanceof ApiError ? caught.message : "The reminder could not be sent." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
        <button
          type="button"
          className="chip c-info"
          style={{ fontWeight: 600, cursor: "pointer" }}
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
            setResult(null);
          }}
        >
          → {label}
        </button>
        <span className="note">{todo}</span>
      </div>
      {open && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
            marginTop: 8,
            padding: "8px 10px",
            border: "1px solid var(--line)",
            borderRadius: 8,
          }}
        >
          <span>
            Send “{templateName}” to <b>{speakerName}</b>?
          </span>
          <button type="button" className="btn pri" disabled={busy} onClick={() => void send()}>
            <Icon name="send" />
            {busy ? "Sending…" : "Send reminder"}
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </button>
          <Link className="note" href={commsHref}>
            Preview or edit in Communications →
          </Link>
        </div>
      )}
      {result && (
        <div className={result.ok ? "note" : "err"} style={{ marginTop: 6, marginBottom: 0 }} role="status">
          {result.text}
        </div>
      )}
    </>
  );
}
