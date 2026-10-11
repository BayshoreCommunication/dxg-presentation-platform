"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { TalkRow } from "@/lib/api";
import { ingestForSlot } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { LocalIntake } from "@/components/LocalIntake";
import { Toast } from "@/components/Toast";

/**
 * Upload a new version from Manage presentations (client review, D-153): a presenter who
 * brings a file straight to the room, or to a technician anywhere onsite. Pick the talk,
 * then the same local intake as the Speaker Ready Room — virus check, comparison, back to
 * review. The room keeps the approved copy until the new one is approved.
 */
export function UploadNewVersion({ eventId, talks, timezone }: { eventId: string; talks: TalkRow[]; timezone: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [slotId, setSlotId] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const live = talks.filter((talk) => talk.status !== "canceled");
  const chosen = live.find((talk) => talk.slot_id === slotId) ?? null;
  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone });

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "0 0 12px", flexWrap: "wrap" }}>
        <button
          type="button"
          className={open ? "btn" : "btn pri"}
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
            setSlotId("");
          }}
        >
          <Icon name={open ? "close" : "intake"} />
          {open ? "Close upload" : "Upload a new version"}
        </button>
        <span className="note">The presenter brought a new file? Take it in for any talk here.</span>
      </div>

      {open && (
        <div className="card">
          <div className="chd">
            <h3>Upload a new version</h3>
          </div>
          <div className="cbd">
            <div className="field">
              <label htmlFor="upload-talk">Talk</label>
              <select id="upload-talk" style={{ width: "100%" }} value={slotId} onChange={(event) => setSlotId(event.target.value)}>
                <option value="">Choose the talk…</option>
                {live.map((talk) => (
                  <option key={talk.slot_id} value={talk.slot_id}>
                    {when(talk.starts_at)} · {talk.room ?? "No room"} · {talk.title}
                    {talk.speaker ? ` — ${talk.speaker}` : ""}
                  </option>
                ))}
              </select>
            </div>
            {chosen ? (
              <LocalIntake
                key={chosen.slot_id}
                submit={(body) => ingestForSlot(eventId, chosen.slot_id, body)}
                onDone={(message) => {
                  setToast(message);
                  router.refresh();
                }}
              />
            ) : (
              <div className="note">Choose the talk first.</div>
            )}
          </div>
        </div>
      )}
      <Toast message={toast} onClose={closeToast} />
    </>
  );
}
