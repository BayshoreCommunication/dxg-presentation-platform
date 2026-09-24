"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SrrDashboard, SrrStation } from "@/lib/api";
import { addStation, renameStation, retireStation, startCheckin, ApiError } from "@/lib/api";
import { Chip } from "@/components/Chip";

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
}: {
  eventId: string;
  eventName: string;
  timezone: string;
  data: SrrDashboard;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <table>
            <tbody>
              {data.expected.map((row) => (
                <tr key={row.speaker_id}>
                  <td>
                    <b>{row.speaker}</b>
                    <br />
                    <span className="note">
                      {row.room} · {when(row.starts_at, timezone)} · {row.title}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Chip status={row.status} label={row.status_label} />{" "}
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
              ))}
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
                {data.warnings.map((warning, index) => (
                  <tr key={`${warning.slot_id}-${index}`}>
                    <td>
                      {warning.speaker} · {warning.check_code.replace("_", " ")}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Chip
                        status={warning.severity === "blocking" ? "attention" : "needs_revision"}
                        label={warning.severity === "blocking" ? "Blocking" : "Tech review"}
                      />
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
function useDismiss(open: boolean, close: () => void) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return root;
}

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
  const [open, setOpen] = useState(false);
  const root = useDismiss(open, () => setOpen(false));
  const free = stations.filter((station) => !station.busy);
  if (stations.length === 0) {
    return (
      <button className="btn pri" disabled title="Add a station under Stations below first">
        Check in →
      </button>
    );
  }
  return (
    <div className="rowmenu" ref={root} style={{ verticalAlign: "middle" }}>
      <button
        className="btn pri"
        disabled={disabled || free.length === 0}
        title={free.length === 0 ? "Every station is in use" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Check in →
      </button>
      {open && (
        <div className="menu" role="menu" style={{ width: 220, textAlign: "left" }}>
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
        </div>
      )}
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
