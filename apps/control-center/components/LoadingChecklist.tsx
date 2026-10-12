"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { FleetRoom, FleetTalk } from "@/lib/api";
import { ApiError, downloadApproved, fileDownloadUrl, ingestForSlot, markLoaded, unmarkLoaded } from "@/lib/api";
import { LocalIntake } from "@/components/LocalIntake";
import { Toast } from "@/components/Toast";
import { ConfirmInline } from "@/components/ConfirmInline";
import { WhyNot } from "@/components/WhyNot";
import { ROOM_LABEL } from "@/lib/roomWords";
import { Icon } from "@/components/Icon";

/** Times on the event's clock (D-080). */
const time = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });

/**
 * Room sync's loading checklist (D-125): a card per room, one line per talk — its approved
 * version, whether a person has ticked it loaded on the room PC, a link to download it for
 * copying, and Mark loaded (or Undo). Rooms that still need something come first.
 * Since D-154 a room downloads all its approved files in one zip and takes a new version a
 * presenter brings to the room. DXG Technician staff on the event see every room (D-160):
 * Event assignments is the only place anyone is given work.
 */
export function LoadingChecklist({
  eventId,
  timezone,
  rooms,
  canLoad,
  canUpload = true,
}: {
  eventId: string;
  timezone: string;
  rooms: FleetRoom[];
  canLoad: boolean;
  /** Taking in a new version is the onsite team's (D-151): support staff don't see Upload. */
  canUpload?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [zipping, setZipping] = useState<string | null>(null);
  const [intakeFor, setIntakeFor] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const closeToast = useCallback(() => setToast(null), []);

  /** One zip of a room's approved files, or of every room on the page (D-154). */
  async function downloadAll(roomId?: string) {
    setZipping(roomId ?? "all");
    setError(null);
    try {
      const { blob, filename } = await downloadApproved(eventId, roomId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The download could not be built.");
    } finally {
      setZipping(null);
    }
  }

  const approvedCount = (room: FleetRoom) =>
    room.talks.filter((talk) => talk.session_state !== "canceled" && talk.approved).length;

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
        <div className="empty">
          This event has no rooms yet — rooms come from the sessions on the agenda.
        </div>
      </div>
    );
  }

  const totalApproved = rooms.reduce((sum, room) => sum + approvedCount(room), 0);

  return (
    <>
      {error && <div className="err">{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "0 0 10px" }}>
        <button
          type="button"
          className="btn pri"
          disabled={zipping !== null || totalApproved === 0}
          title={totalApproved === 0 ? "No approved presentations yet" : undefined}
          onClick={() => void downloadAll()}
        >
          <Icon name="download" />
          {zipping === "all"
            ? "Preparing zip…"
            : `Download all approved (${totalApproved})`}
        </button>
      </div>
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
            <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <span className={`chip ${room.readiness === "ready" ? "c-ok" : "c-warn"}`}>{ROOM_LABEL[room.readiness]}</span>
              <button
                type="button"
                className="btn"
                disabled={zipping !== null || approvedCount(room) === 0}
                title={approvedCount(room) === 0 ? "No approved presentations in this room yet" : undefined}
                onClick={() => void downloadAll(room.room_id)}
              >
                <Icon name="download" />
                {zipping === room.room_id ? "Preparing zip…" : `Download all (${approvedCount(room)})`}
              </button>
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
                              icon="undo"
                              busyLabel="Saving…"
                              onConfirm={async () => {
                                await unmarkLoaded(copy.room_file_id!, copy.lock_version!);
                                router.refresh();
                              }}
                              onClose={() => setUndoing(null)}
                            />
                          )}
                          {intakeFor === talk.slot_id && (
                            <div style={{ marginTop: 10 }}>
                              <p className="note" style={{ marginTop: 0 }}>
                                The presenter brought a new file to the room? Take it in here — from a USB drive or this
                                computer. It is virus-checked and goes back to review; until it is approved the room
                                keeps {copy ? `v${copy.version_number}` : "what it has"}.
                              </p>
                              <LocalIntake
                                submit={(body) => ingestForSlot(eventId, talk.slot_id, body)}
                                approvedNumber={copy?.version_number}
                                onDone={(message) => {
                                  setToast(message);
                                  router.refresh();
                                }}
                              />
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap", verticalAlign: "top" }}>
                          {!canceled && canUpload && (
                            <button
                              type="button"
                              className="btn"
                              style={{ padding: "4px 10px" }}
                              aria-expanded={intakeFor === talk.slot_id}
                              onClick={() => setIntakeFor(intakeFor === talk.slot_id ? null : talk.slot_id)}
                            >
                              <Icon name={intakeFor === talk.slot_id ? "close" : "intake"} />
                              {intakeFor === talk.slot_id ? "Close" : "Upload new version"}
                            </button>
                          )}{" "}
                          {copy && !canceled && (
                            <>
                              <a className="btn" style={{ padding: "4px 10px" }} href={fileDownloadUrl(copy.file_version_id)}>
                                <Icon name="download" />
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
                                    <Icon name="undo" />
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
                                    <Icon name="check" />
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
      <Toast message={toast} onClose={closeToast} />
    </>
  );
}
