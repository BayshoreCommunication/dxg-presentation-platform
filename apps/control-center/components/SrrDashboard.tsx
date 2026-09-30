"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ExpectedArrival, SrrDashboard, SrrStation } from "@/lib/api";
import { addStation, renameStation, retireStation, startCheckin, ApiError } from "@/lib/api";
import { FloatingMenu, useFloatingMenu } from "@/components/FloatingMenu";
import { CHECK, wordsFor } from "@pmp/format";
import { Chip, SeverityChip } from "@/components/Chip";
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
}: {
  eventId: string;
  eventName: string;
  timezone: string;
  data: SrrDashboard;
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

  // Grouped by what is happening now (D-121): at a desk, still to check in, been and gone.
  const atDesk = new Map(data.expected.filter((row) => row.checkin_id).map((row) => [row.speaker, row]));
  const toCome = data.expected.filter((row) => !row.checkin_id && !row.checked_out);
  const left = data.expected.filter((row) => !row.checkin_id && row.checked_out);
  const busyDesks = data.stations.filter((station) => station.busy).length;
  const signedOff = data.expected.filter((row) => row.signed_off_version).length;

  return (
    <>
      <h1 className="htitle">Speaker Ready Room · {eventName}</h1>
      <div className="note" style={{ margin: "-8px 0 14px" }}>
        {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: timezone })}
        {" · "}
        {data.stations.length === 0
          ? "no desks set up yet"
          : `${busyDesks} of ${data.stations.length} desk${data.stations.length === 1 ? "" : "s"} in use`}
        {" · "}
        {toCome.length} to check in · {signedOff} signed off
      </div>

      {error && <div className="err">{error}</div>}

      {/* ── At the desks now: one card per desk (D-121) ─────────────────────────── */}
      <div className="card">
        <div className="chd">
          <h3>At the desks now</h3>
          <span className="m">open a speaker to go through their slides</span>
        </div>
        <div className="cbd">
          {data.stations.length === 0 ? (
            <div className="empty">No desks yet. Add them under &ldquo;Manage desks&rdquo; below.</div>
          ) : (
            <div className="desk-grid">
              {data.stations.map((station) => {
                const row = station.speaker ? atDesk.get(station.speaker) : undefined;
                return (
                  <div key={station.id} className={`desk${station.busy ? " busy" : ""}`}>
                    <div className="desk-name">{station.name}</div>
                    {station.busy ? (
                      <>
                        <div className="desk-who">{station.speaker ?? "A speaker"}</div>
                        <div className="note">{row ? deskLine(row) : "In session"}</div>
                        {row?.checkin_id && (
                          <a className="btn pri" style={{ marginTop: 8 }} href={`/events/${eventId}/srr/${row.checkin_id}`}>
                            Open →
                          </a>
                        )}
                      </>
                    ) : (
                      <div className="note">Free</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Still to check in, by session time ─────────────────────────────────── */}
      <div className="card">
        <div className="chd">
          <h3>Still to check in · {toCome.length}</h3>
          <span className="m">in session order</span>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          {toCome.length === 0 ? (
            <div className="empty">Everyone expected has been checked in.</div>
          ) : (
            <>
              {checkInBlocked && (
                <div style={{ padding: "4px 18px 8px" }}>
                  <WhyNot reason={checkInBlocked} />
                </div>
              )}
              <table>
                <tbody>
                  {toCome.map((row) => {
                    return (
                      <tr key={row.speaker_id}>
                        <td>
                          <b>{row.speaker}</b>
                          <span className="note">
                            {" "}
                            · {row.room ?? "No room"} · {when(row.starts_at, timezone)}
                          </span>
                          <div className="note" style={{ marginTop: 2 }}>
                            {arrivalLine(row)}
                          </div>
                        </td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <Chip status={row.status} label={row.status_label} />{" "}
                          <CheckInButton
                            stations={data.stations}
                            disabled={busy}
                            onPick={(stationId) => void check(row.speaker_id, stationId)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      {/* ── Been and gone ──────────────────────────────────────────────────────── */}
      {left.length > 0 && (
        <div className="card">
          <div className="chd">
            <h3>Checked out · {left.length}</h3>
            <span className="m">check them in again if they come back</span>
          </div>
          <div className="cbd" style={{ padding: "0 0 4px" }}>
            <table>
              <tbody>
                {left.map((row) => (
                  <tr key={row.speaker_id}>
                    <td>
                      <b>{row.speaker}</b>
                      <span className="note">
                        {" "}
                        · {row.signed_off_version ? `signed off v${row.signed_off_version}` : "left without signing off"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <CheckInButton
                        stations={data.stations}
                        label="Check in again"
                        disabled={busy}
                        onPick={(stationId) => void check(row.speaker_id, stationId)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Only when there is something to look at (D-121): an empty card was noise. */}
      {data.warnings.length > 0 && (
        <div className="card">
          <div className="chd">
            <h3>Files with warnings · {data.warnings.length}</h3>
            <span className="m">not yet reviewed</span>
          </div>
          <div className="cbd" style={{ padding: "0 0 4px" }}>
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
          </div>
        </div>
      )}

      {/* Setting up desks is a once-per-event job, so it sits folded away (D-121). */}
      <details className="manage-desks">
        <summary>Manage desks ({data.stations.length})</summary>
        <StationsCard eventId={eventId} stations={data.stations} onChanged={() => router.refresh()} />
      </details>
    </>
  );
}

/** What a speaker at a desk is up to, in one line (D-121). */
function deskLine(row: ExpectedArrival): string {
  if (row.signed_off_version) return `Signed off v${row.signed_off_version} — ready to check out`;
  if (row.status === "attention") return "File held back — needs a clean copy";
  if (row.status === "missing") return "No file yet — take it by USB";
  if (row.status === "processing") return "File being checked";
  return "Going through the slides";
}

/** What to do when this speaker walks in, in one line (D-121). */
function arrivalLine(row: ExpectedArrival): string {
  switch (row.status) {
    case "missing":
      return "No file yet — take it by USB when they arrive.";
    case "attention":
      return "Their file failed the virus check — ask for a clean copy on USB.";
    case "needs_revision":
      return "Changes were asked for — they may bring a new version.";
    case "processing":
    case "submitted":
      return "File not approved yet — go through the slides and confirm their final version.";
    case "canceled":
      return "Session cancelled.";
    default:
      return "File approved — go through it with them and confirm.";
  }
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
  label = "Check in →",
}: {
  stations: SrrStation[];
  disabled: boolean;
  onPick: (stationId: string) => void;
  label?: string;
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
        {label}
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
        {/* R33's pair, said once (D-121): a desk with a speaker can't be removed. */}
        {stations.some((station) => station.busy) && (
          <div style={{ padding: "8px 14px 0" }}>
            <WhyNot reason="A desk with a speaker at it can't be removed until they check out." />
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
