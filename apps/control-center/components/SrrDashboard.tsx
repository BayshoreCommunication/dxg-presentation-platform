"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SrrDashboard, SrrStation } from "@/lib/api";
import { addStation, renameStation, retireStation, startCheckin, ApiError } from "@/lib/api";
import { FloatingMenu, useFloatingMenu } from "@/components/FloatingMenu";
import { CHECK, wordsFor } from "@pmp/format";
import { Chip, SeverityChip, StatusMeaning } from "@/components/Chip";
import { ConfirmationStrip } from "@/components/ConfirmationStrip";
import { staleNoteFor } from "@/lib/roomWords";
import { WhyNot } from "@/components/WhyNot";

/**
 * A session's day and time, on the event's clock. The day is spelled out rather than
 * implied: on a three-day event "10:30" alone does not say which 10:30, and "today"
 * is only true on one of them.
 */
const when = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });

/** Screen 11 — the Speaker Ready Room's own view of who is coming and what is unresolved. */
export function SrrDashboardView({
  eventId,
  eventName,
  timezone,
  data,
  rooms = [],
}: {
  eventId: string;
  eventName: string;
  timezone: string;
  data: SrrDashboard;
  /** Room sync's room list, for R7's room-PC freshness (D-110). */
  rooms?: { room: string; heartbeat_age: number | null }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Why "Check in →" is greyed, once above the list rather than on every row (R33, D-111).
  const checkInBlocked =
    data.stations.length === 0
      ? "Check in is off until this room has a station. Add one under Stations below."
      : data.stations.every((station) => station.busy)
        ? "Every station is in use. To free one, check a speaker out: open their check-in and press Check out."
        : null;

  async function check(speakerId: string, stationId: string) {
    setBusy(true);
    setError(null);
    try {
      const { checkin_id } = await startCheckin(eventId, speakerId, stationId);
      router.push(`/events/${eventId}/srr/${checkin_id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Check-in failed.");
      setBusy(false);
    }
  }

  return (
    <>
      {/*
        This heading said "Speaker Ready Room · Room 118" and "Stations 1–3" on every
        event. It now names the event, the actual date at the venue, and the stations
        this room really has.
      */}
      <h1 className="htitle">Speaker Ready Room · {eventName}</h1>
      <div className="note" style={{ margin: "-8px 0 14px" }}>
        {new Date().toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: timezone,
        })}
        {data.stations.length > 0 && ` · ${data.stations.map((station) => station.station).join(", ")}`}
        {" · walk-ins and scheduled check-ins"}
      </div>

      {error && <div className="err">{error}</div>}

      <div className="card">
        <div className="chd">
          <h3>Expected · {data.expected.length}</h3>
          <span className="m">ordered by session time</span>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          {checkInBlocked && data.expected.some((row) => !row.checkin_id) && (
            <div style={{ padding: "4px 18px 8px" }}>
              <WhyNot reason={checkInBlocked} />
            </div>
          )}
          <table>
            <tbody>
              {data.expected.map((row) => {
                // R7: amber when the room PC has gone quiet; R47: the meaning, visibly (D-110).
                const stale = staleNoteFor(row.status, row.room, rooms);
                return (
                <tr key={row.speaker_id}>
                  <td>
                    <b>{row.speaker}</b>
                    <br />
                    <span className="note">
                      {row.room} · {when(row.starts_at, timezone)} · {row.title}
                    </span>
                    <StatusMeaning status={row.status} stale={stale} />
                    {/* Approval → sign-off → room at a glance, with "Signed off vN" (R32, D-113). */}
                    <ConfirmationStrip
                      compact
                      facts={{
                        status: row.status,
                        room: row.room,
                        hasSpeaker: true,
                        approved: row.approved_version ? { version: row.approved_version } : null,
                        roomStates: row.approved_room_states,
                        signOff: row.signed_off_version ? { version: row.signed_off_version } : null,
                        stale,
                        timezone,
                      }}
                    />
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Chip status={row.status} label={row.status_label} stale={stale} />{" "}
                    {/* R32 (D-113): a speaker who has been and gone says so. */}
                    {row.checked_out && (
                      <>
                        <span className="chip c-mut" title="Checked in earlier and checked out. Check in again if they bring a new file.">
                          Checked out
                        </span>{" "}
                      </>
                    )}
                    {row.checkin_id ? (
                      <a className="btn" href={`/events/${eventId}/srr/${row.checkin_id}`}>
                        Open check-in →
                      </a>
                    ) : (
                      <CheckInButton
                        stations={data.stations}
                        disabled={busy}
                        onPick={(stationId) => void check(row.speaker_id, stationId)}
                      />
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>Unresolved warnings · {data.warnings.length}</h3>
          <span className="m">on versions still awaiting review</span>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          {data.warnings.length === 0 ? (
            <div className="empty">No unresolved warnings.</div>
          ) : (
            <table>
              <tbody>
                {/* R31 (D-113): which talk, where and when, the problem in words, and the report. */}
                {data.warnings.map((warning, index) => (
                  <tr key={`${warning.slot_id}-${index}`}>
                    <td>
                      <b>{warning.speaker ?? "No speaker"}</b> · {warning.title}
                      <br />
                      <span className="note">
                        {warning.room ?? "No room"} · {when(warning.starts_at, timezone)} ·{" "}
                        {wordsFor(CHECK, warning.check_code).label}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <SeverityChip severity={warning.severity} />{" "}
                      <a
                        className="btn"
                        href={`/events/${eventId}/talks/${warning.slot_id}/inspection?v=${warning.file_version_id}`}
                      >
                        Open report
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <StationsCard eventId={eventId} stations={data.stations} onChanged={() => router.refresh()} />
    </>
  );
}

/** Closes on Escape and on a click anywhere else. */

/**
 * Check-in asks which desk (D-080). It was recorded at "Station 2" for every speaker;
 * now the menu lists this event's stations, with the ones already in use shown but not
 * offered.
 */
function CheckInButton({
  stations,
  disabled,
  onPick,
}: {
  stations: SrrStation[];
  disabled: boolean;
  onPick: (stationId: string) => void;
}) {
  const { open, setOpen, trigger, menu } = useFloatingMenu();
  const free = stations.filter((station) => !station.busy);
  if (stations.length === 0) {
    return (
      <button className="btn pri" disabled title="Add a station under Stations below first">
        Check in →
      </button>
    );
  }
  return (
    <div className="rowmenu" style={{ verticalAlign: "middle" }}>
      <button
        ref={trigger}
        className="btn pri"
        disabled={disabled || free.length === 0}
        title={free.length === 0 ? "Every station is in use. Check a speaker out to free one." : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Check in →
      </button>
      <FloatingMenu open={open} trigger={trigger} menu={menu} width={220}>
          <div className="label">At which station?</div>
          {stations.map((station) => (
            <button
              key={station.id}
              type="button"
              className="item"
              role="menuitem"
              disabled={station.busy}
              style={station.busy ? { opacity: 0.5, cursor: "default" } : undefined}
              onClick={() => {
                if (station.busy) return;
                setOpen(false);
                onPick(station.id);
              }}
            >
              {station.name}
              {station.busy && <span className="tick">in use</span>}
            </button>
          ))}
      </FloatingMenu>
    </div>
  );
}

/** The event's desks: who is at each, and add / rename / remove (D-080). */
function StationsCard({
  eventId,
  stations,
  onChanged,
}: {
  eventId: string;
  stations: SrrStation[];
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(work: () => Promise<unknown>) {
    setWorking(true);
    setError(null);
    try {
      await work();
      onChanged();
      return true;
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "That did not work.");
      return false;
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="card">
      <div className="chd">
        <h3>Stations · {stations.length}</h3>
        <span className="m">the desks speakers check in at</span>
      </div>
      <div className="cbd" style={{ padding: "0 0 4px" }}>
        {error && (
          <div className="err" role="alert" style={{ margin: "12px 14px" }}>
            {error}
          </div>
        )}
        {stations.length === 0 ? (
          <div className="empty">No stations yet. Add the desks this room has, then speakers can be checked in.</div>
        ) : (
          <table>
            <tbody>
              {stations.map((station) => (
                <tr key={station.id}>
                  <td>
                    {editing?.id === station.id ? (
                      <form
                        style={{ display: "flex", gap: 8, alignItems: "center" }}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void run(() => renameStation(eventId, station.id, editing.name)).then((ok) => {
                            if (ok) setEditing(null);
                          });
                        }}
                      >
                        <input
                          aria-label={`New name for ${station.name}`}
                          value={editing.name}
                          maxLength={60}
                          autoFocus
                          onChange={(event) => setEditing({ id: station.id, name: event.target.value })}
                        />
                        <button className="btn pri" disabled={working || !editing.name.trim()}>
                          Save
                        </button>
                        <button type="button" className="btn" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <>
                        <b>{station.name}</b>
                        {station.busy && (
                          <span className="note">
                            {" "}
                            · {station.speaker ?? "a speaker"}
                            {station.technician ? ` with ${station.technician}` : ""}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Chip status={station.busy ? "submitted" : "canceled"} label={station.busy ? "In session" : "Free"} />{" "}
                    {editing?.id !== station.id &&
                      (confirming === station.id ? (
                        <>
                          <button
                            className="btn danger"
                            disabled={working}
                            onClick={() =>
                              void run(() => retireStation(eventId, station.id)).then(() => setConfirming(null))
                            }
                          >
                            Remove {station.name}
                          </button>{" "}
                          <button className="btn" onClick={() => setConfirming(null)}>
                            Keep
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="btn" disabled={working} onClick={() => setEditing({ id: station.id, name: station.name })}>
                            Rename
                          </button>{" "}
                          <button
                            className="btn"
                            disabled={working || station.busy}
                            title={station.busy ? "A speaker is checked in here" : undefined}
                            onClick={() => setConfirming(station.id)}
                          >
                            Remove
                          </button>
                          {/* R33's pair: a busy desk can't be removed; say so, not only on hover (D-111). */}
                          <WhyNot reason={station.busy ? "Check the speaker out to remove this station." : null} />
                        </>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form
          style={{ display: "flex", gap: 8, padding: "12px 14px 10px", borderTop: "1px solid rgba(0,0,0,.06)" }}
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => addStation(eventId, draft)).then((ok) => {
              if (ok) setDraft("");
            });
          }}
        >
          <input
            aria-label="New station name"
            placeholder="Station name"
            value={draft}
            maxLength={60}
            onChange={(event) => setDraft(event.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn pri" disabled={working || !draft.trim()}>
            Add station
          </button>
        </form>
      </div>
    </div>
  );
}
