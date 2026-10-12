"use client";

import { useCallback, useEffect, useState } from "react";
import type { SpeakerRow, SupportStaffRow } from "@/lib/api";
import { ApiError, addSpeakerSupportStaff, getSpeakerSupportStaff, removeSpeakerSupportStaff } from "@/lib/api";
import { Icon } from "@/components/Icon";

/**
 * A speaker's support staff (client review, D-155) — not DXG Support staff: assistants who
 * submit this speaker's presentations. DXG Admins and support staff add them here; each gets
 * a sign-in by email and sees only the speaker's Manage presentations on the speaker site.
 */
export function SpeakerSupportStaffDialog({
  eventId,
  speaker,
  onClose,
  onChanged,
}: {
  eventId: string;
  speaker: SpeakerRow;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const [rows, setRows] = useState<SupportStaffRow[] | null>(null);
  const [max, setMax] = useState(5);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getSpeakerSupportStaff(eventId, speaker.id);
      setRows(result.items);
      setMax(result.max);
    } catch (caught) {
      setRows([]);
      setError(caught instanceof ApiError ? caught.message : "The list could not be loaded.");
    }
  }, [eventId, speaker.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [busy, onClose]);

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      const message = await work();
      await load();
      onChanged(message);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const full = (rows?.length ?? 0) >= max;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Support staff for ${speaker.full_name}`}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8,12,20,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 50,
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="card" style={{ maxWidth: 560, width: "100%", maxHeight: "90vh", overflow: "auto" }}>
        <div className="chd">
          <h3>Speaker support staff · {speaker.full_name}</h3>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            <Icon name="close" />
            Close
          </button>
        </div>
        <div className="cbd">
          <p className="note" style={{ marginTop: 0 }}>
            Assistants who submit {speaker.full_name}&rsquo;s presentations for them. Each gets their own sign-in by email and
            sees only {speaker.full_name}&rsquo;s Manage presentations on the speaker site — upload, update, download. Their
            uploads are the speaker&rsquo;s. (Not DXG Support staff.)
          </p>
          {error && <div className="err">{error}</div>}

          {rows === null ? (
            <div className="note">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="empty" style={{ padding: "10px 0" }}>No support staff yet.</div>
          ) : (
            <table style={{ marginBottom: 12 }}>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.user_id}>
                    <td>
                      <b>{row.name}</b> <span className="note">· {row.email}</span>
                      <div className="note" style={{ marginTop: 2 }}>
                        {row.state === "invited" ? "Sign-in emailed — password not chosen yet" : "Active"}
                      </div>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {confirming === row.user_id ? (
                        <>
                          <button
                            type="button"
                            className="btn danger"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await removeSpeakerSupportStaff(eventId, speaker.id, row.user_id);
                                setConfirming(null);
                                return `${row.name} can no longer sign in`;
                              })
                            }
                          >
                            <Icon name="trash" />
                            Remove {row.name}
                          </button>{" "}
                          <button type="button" className="btn" onClick={() => setConfirming(null)}>
                            Keep
                          </button>
                        </>
                      ) : (
                        <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(row.user_id)}>
                          <Icon name="trash" />
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const added = await addSpeakerSupportStaff(eventId, speaker.id, name, email);
                setName("");
                setEmail("");
                return `Sign-in emailed to ${added.email}`;
              });
            }}
          >
            <div className="field">
              <label htmlFor="ss-name">Assistant&rsquo;s name</label>
              <input id="ss-name" style={{ width: "100%" }} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ss-email">Assistant&rsquo;s email address</label>
              <input
                id="ss-email"
                type="email"
                style={{ width: "100%" }}
                maxLength={120}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <button
              type="submit"
              className="btn pri"
              disabled={busy || full || !name.trim() || !email.trim()}
              title={full ? `Up to ${max} support staff per speaker` : undefined}
            >
              <Icon name="send" />
              {busy ? "Sending…" : "Add and email their sign-in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
