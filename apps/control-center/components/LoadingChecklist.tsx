"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FleetRoom, FleetTalk } from "@/lib/api";
import { ApiError, fileDownloadUrl, markLoaded, unmarkLoaded } from "@/lib/api";
import { ConfirmInline } from "@/components/ConfirmInline";
import { WhyNot } from "@/components/WhyNot";
import { ROOM_LABEL } from "@/lib/roomWords";

/** Times on the event's clock (D-080). */
const time = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });

/**
 * Room sync's loading checklist (D-125): a card per room, one line per talk — its approved
 * version, whether a person has ticked it loaded on the room PC, a link to download it for
 * copying, and Mark loaded (or Undo). Rooms that still need something come first.
 */
export function LoadingChecklist({
  eventId,
  timezone,
  rooms,
  canLoad,
}: {
  eventId: string;
  timezone: string;
  rooms: FleetRoom[];
  canLoad: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);

  async function tick(talk: FleetTalk) {
    const copy = talk.approved;
    if (!copy?.room_file_id || copy.lock_version === null) return;
    setBusy(talk.slot_id);
    setError(null);
    try {
      await markLoaded(copy.room_file_id, copy.lock_version);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "That didn't save. Refresh the page and try again.");
    } finally {
      setBusy(null);
    }
  }

  const ordered = [...rooms].sort((a, b) => Number(a.readiness === "ready") - Number(b.readiness === "ready"));

  if (rooms.length === 0) {
    return (
      <div className="card">
        <div className="empty">This event has no rooms yet — rooms come from the sessions on the agenda.</div>
      </div>
    );
  }

  return (
    <>
      {error && <div className="err">{error}</div>}
      <WhyNot
        reason={
          canLoad
            ? null
            : "Only a room technician, a Speaker Ready Room technician or a presentation manager can tick files loaded. You can still download them."
        }
      />
      {ordered.map((room) => (
        <div className="card" key={room.room_id}>
          <div className="chd">
            <h3>{room.room}</h3>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className={`chip ${room.readiness === "ready" ? "c-ok" : "c-warn"}`}>{ROOM_LABEL[room.readiness]}</span>
              <Link className="m" href={`/events/${eventId}/agent/${room.room_id}`}>
                Room view →
              </Link>
            </span>
          </div>
          <div className="cbd" style={{ padding: "0 0 4px" }}>
            {room.talks.length === 0 ? (
              <div className="empty">No presentations in this room.</div>
            ) : (
              <table>
                <tbody>
                  {room.talks.map((talk) => {
                    const copy = talk.approved;
                    const canceled = talk.session_state === "canceled";
                    return (
                      <tr key={talk.slot_id}>
                        <td>
                          <span className="mono">{time(talk.starts_at, timezone)}</span> ·{" "}
                          <Link href={`/events/${eventId}/talks/${talk.slot_id}`}>{talk.title}</Link>
                          {talk.speaker ? ` · ${talk.speaker}` : ""}
                          {copy ? ` · approved v${copy.version_number}` : ""}
                          <div className="note" style={{ marginTop: 2 }}>
                            {canceled ? (
                              "Session cancelled — nothing to load."
                            ) : !copy ? (
                              "No approved file yet"
                            ) : copy.loaded ? (
                              <span style={{ color: "var(--success)" }}>Loaded ✓</span>
                            ) : talk.loaded_other_version !== null ? (
                              <span style={{ color: "var(--amber-text)" }}>
                                v{copy.version_number} approved — load it (the room has v{talk.loaded_other_version})
                              </span>
                            ) : (
                              "Not loaded yet"
                            )}
                          </div>
                          {undoing === talk.slot_id && copy?.room_file_id && copy.lock_version !== null && (
                            <ConfirmInline
                              question={`Mark v${copy.version_number} as not loaded?`}
                              detail="Use this only if the tick was a mistake. The talk shows as not loaded until someone ticks it again."
                              confirmLabel="Mark not loaded"
                              busyLabel="Saving…"
                              onConfirm={async () => {
                                await unmarkLoaded(copy.room_file_id!, copy.lock_version!);
                                router.refresh();
                              }}
                              onClose={() => setUndoing(null)}
                            />
                          )}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap", verticalAlign: "top" }}>
                          {copy && !canceled && (
                            <>
                              <a className="btn" style={{ padding: "4px 10px" }} href={fileDownloadUrl(copy.file_version_id)}>
                                Download v{copy.version_number}
                              </a>{" "}
                              {canLoad && copy.room_file_id && copy.lock_version !== null && (
                                copy.loaded ? (
                                  <button
                                    type="button"
                                    className="btn"
                                    style={{ padding: "4px 10px" }}
                                    disabled={busy !== null || undoing === talk.slot_id}
                                    onClick={() => setUndoing(talk.slot_id)}
                                  >
                                    Undo
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="btn pri"
                                    style={{ padding: "4px 10px" }}
                                    disabled={busy !== null}
                                    onClick={() => void tick(talk)}
                                  >
                                    {busy === talk.slot_id ? "Saving…" : "Mark loaded"}
                                  </button>
                                )
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
