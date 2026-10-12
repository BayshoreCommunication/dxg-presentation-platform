"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { TalkRow } from "@/lib/api";
import { ingestForSlot } from "@/lib/api";
import { Icon } from "@/components/Icon";
import { LocalIntake } from "@/components/LocalIntake";
import { Toast } from "@/components/Toast";

/**
 * Upload a new version from Manage presentations (client review, D-154): a presenter who
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
  const when = (iso: string) =>
    new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone });

  /*
   * One entry per presentation, grouped under its session. A session's presentations all carry
   * the session's name ("Demo Talk" six times read as one talk listed six times), so each is
   * told apart by its speaker and its status; one with no speaker is numbered in its session.
   * The talks list has a row per speaker, so co-presented talks are folded into one entry.
   */
  const live = (() => {
    const bySlot = new Map<string, TalkRow & { speakers: string[] }>();
    for (const talk of talks) {
      if (talk.status === "canceled") continue;
      const seen = bySlot.get(talk.slot_id);
      if (seen) {
        if (talk.speaker) seen.speakers.push(talk.speaker);
      } else {
        bySlot.set(talk.slot_id, { ...talk, speakers: talk.speaker ? [talk.speaker] : [] });
      }
    }
    return [...bySlot.values()];
  })();
  const groups = (() => {
    const out = new Map<string, { label: string; items: { slot_id: string; label: string }[] }>();
    for (const talk of live) {
      const key = `${talk.title}|${talk.starts_at}|${talk.room ?? ""}`;
      const group = out.get(key) ?? { label: `${talk.title} · ${when(talk.starts_at)} · ${talk.room ?? "No room"}`, items: [] };
      const who = talk.speakers.length > 0 ? talk.speakers.join(" & ") : "No speaker yet";
      const same = group.items.filter((item) => item.label.startsWith(who)).length;
      group.items.push({ slot_id: talk.slot_id, label: `${who}${same > 0 || who === "No speaker yet" ? ` (${same + 1})` : ""} · ${talk.status_label}` });
      out.set(key, group);
    }
    return [...out.values()];
  })();
  const chosen = live.find((talk) => talk.slot_id === slotId) ?? null;

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
              <label htmlFor="upload-talk">Presentation</label>
              <select id="upload-talk" style={{ width: "100%" }} value={slotId} onChange={(event) => setSlotId(event.target.value)}>
                <option value="">Choose the presentation…</option>
                {groups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.items.map((item) => (
                      <option key={item.slot_id} value={item.slot_id}>
                        {item.label}
                      </option>
                    ))}
                  </optgroup>
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
              <div className="note">Choose the presentation first.</div>
            )}
          </div>
        </div>
      )}
      <Toast message={toast} onClose={closeToast} />
    </>
  );
}
