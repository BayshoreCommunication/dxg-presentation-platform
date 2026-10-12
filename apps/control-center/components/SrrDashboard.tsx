"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExpectedArrival, SrrDashboard, SrrStation } from "@/lib/api";
import { addStation, renameStation, retireStation, startCheckin, ingestForSlot, srrReportUrl, ApiError } from "@/lib/api";
import { LocalIntake } from "@/components/LocalIntake";
import { Toast } from "@/components/Toast";
import { SrrSwitch } from "@/components/SrrSwitch";
import { Icon } from "@/components/Icon";
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
  canSwitch,
}: {
  eventId: string;
  eventName: string;
  timezone: string;
  data: SrrDashboard;
  /** May open or close the room on the event day (D-157). */
  canSwitch: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Local intake without a check-in (D-153): staff upload or update a speaker's file here.
  const [intakeFor, setIntakeFor] = useState<ExpectedArrival | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  const uploadButton = (row: ExpectedArrival) => (
    <button
      type="button"
      className="btn"
      disabled={busy}
      title="Upload or update this speaker's presentation — from a USB drive or this computer"
      onClick={() => {
        setIntakeFor(row);
        if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
      }}
    >
      <Icon name="intake" />
      Upload
    </button>
  );
  // Why "Check in →" is greyed, once above the list rather than on every row (R33, D-111).
  const checkInBlocked = !data.open
    ? "The Speaker Ready Room is closed. It opens on the event day — a DXG Admin or support staff opens it."
    : data.stations.length === 0
      ? "Check in is off until this room has a desk. Add one under Desks above."
      : data.stations.every((station) => station.busy)
        ? "Every desk is in use. To free one, check a speaker out: open their check-in and press Check out."
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
  // By visit, not by name: two speakers can share a name, and a speaker taken off their
  // session is no longer in `expected` but may still be sitting at a desk.
  const atDesk = new Map(data.expected.filter((row) => row.checkin_id).map((row) => [row.checkin_id, row]));
  const toCome = data.expected.filter((row) => !row.checkin_id && !row.checked_out);
  const left = data.expected.filter((row) => !row.checkin_id && row.checked_out);
  const busyDesks = data.stations.filter((station) => station.busy).length;
  const signedOff = data.expected.filter((row) => row.signed_off_version).length;

  return (
    <>
      <h1 className="htitle">Speaker Ready Room · {eventName}</h1>
      {/* The day's line and the check-in / checkout report (D-153) share a row; on a narrow
          screen the button drops below the line with a gap rather than touching it. */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "8px 12px",
          flexWrap: "wrap",
          margin: "-8px 0 14px",
        }}
      >
        <div className="note" style={{ margin: 0 }}>
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: timezone })}
          {" · "}
          {data.stations.length === 0
            ? "no desks set up yet"
            : `${busyDesks} of ${data.stations.length} desk${data.stations.length === 1 ? "" : "s"} in use`}
          {" · "}
          {toCome.length} to check in · {signedOff} signed off
        </div>
        <a className="btn" href={srrReportUrl(eventId)} download style={{ whiteSpace: "nowrap" }}>
          <Icon name="download" /> Download check-in report (CSV)
        </a>
      </div>

      {error && <div className="err">{error}</div>}

      {/* The event-day switch (D-157). */}
      <div className={data.open ? undefined : "card next-step"} style={data.open ? { margin: "0 0 12px" } : undefined}>
        <div className={data.open ? undefined : "cbd"}>
          {!data.open && (
            <>
              <div className="next-step-label">Not open yet</div>
              <p className="next-step-body" style={{ marginTop: 0 }}>
                The Speaker Ready Room opens on the event day. Until then you can set up desks and upload speakers&rsquo;
                files, but no one can be checked in.
              </p>
            </>
          )}
          <SrrSwitch eventId={eventId} open={data.open} canSwitch={canSwitch} />
        </div>
      </div>

      {intakeFor && (
        <div className="card">
          <div className="chd">
            <h3>
              Local intake · {intakeFor.speaker} — {intakeFor.title}
            </h3>
            <button type="button" className="btn" onClick={() => setIntakeFor(null)}>
              <Icon name="close" />
              Close
            </button>
          </div>
          <div className="cbd">
            <p className="note" style={{ marginTop: 0 }}>
              Upload or update this speaker&rsquo;s presentation without checking them in — from a USB drive or a
              file saved on this computer. It goes through the same virus check and back to review.
            </p>
            <LocalIntake
              key={intakeFor.slot_id}
              submit={(body) => ingestForSlot(eventId, intakeFor.slot_id, body)}
              approvedNumber={intakeFor.approved_version ?? undefined}
              onDone={(message) => {
                setToast(message);
                router.refresh();
              }}
            />
          </div>
        </div>
      )}

      {data.stations.length === 0 && (
        <StationsCard eventId={eventId} stations={data.stations} onChanged={() => router.refresh()} />
      )}

      {/* ── At the desks now: one card per desk (D-121) ─────────────────────────── */}
      <div className="card">
        <div className="chd">
          <h3>At the desks now</h3>
          <span className="m">open a speaker to go through their slides</span>
        </div>
        <div className="cbd">
          {data.stations.length === 0 ? (
            <div className="empty">No desks yet. Add the room&rsquo;s desks above, then speakers can be checked in here.</div>
          ) : (
            <div className="desk-grid">
              {data.stations.map((station) => {
                const row = station.checkin_id ? atDesk.get(station.checkin_id) : undefined;
                return (
                  <div key={station.id} className={`desk${station.busy ? " busy" : ""}`}>
                    <div className="desk-name">{station.name}</div>
                    {station.busy ? (
                      <>
                        <div className="desk-who">{station.speaker ?? "A speaker"}</div>
                        <div className="note">{row ? deskLine(row) : "Not on a session any more — open to check them out"}</div>
                        {station.checkin_id && (
                          <a className="btn pri" style={{ marginTop: 8 }} href={`/events/${eventId}/srr/${station.checkin_id}`}>
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
                      <tr key={row.speaker_id} className="srr-row">
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
                        <td className="srr-actions">
                          <Chip status={row.status} label={row.status_label} />{" "}
                          {uploadButton(row)}{" "}
                          <CheckInButton
                            stations={data.stations}
                            disabled={busy || !data.open}
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
                  <tr key={row.speaker_id} className="srr-row">
                    <td>
                      <b>{row.speaker}</b>
                      <span className="note">
                        {" "}
                        · {row.signed_off_version ? `signed off v${row.signed_off_version}` : "left without signing off"}
                      </span>
                    </td>
                    <td className="srr-actions">
                      {uploadButton(row)}{" "}
                      <CheckInButton
                        stations={data.stations}
                        label="Check in again"
                        disabled={busy || !data.open}
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
                  <tr key={`${warning.slot_id}-${index}`} className="srr-row">
                    <td>
                      <b>{warning.speaker ?? "No speaker"}</b> · {warning.title}
                      <br />
                      <span className="note">
                        {warning.room ?? "No room"} · {when(warning.starts_at, timezone)} ·{" "}
                        {wordsFor(CHECK, warning.check_code).label}
                      </span>
                    </td>
                    <td className="srr-actions">
                      <SeverityChip severity={warning.severity} />{" "}
                      <a
                        className="btn"
                        href={`/events/${eventId}/talks/${warning.slot_id}/inspection?v=${warning.file_version_id}`}
                      >
                        <Icon name="eye" />
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

      {/*
        Setting up desks was folded away under a "Manage desks" toggle (D-121) because it
        is a once-per-event job — and so a room with no desks opened on two empty panels
        and a greyed Check in, with the one thing to do hidden behind a line of small
        text. The card is always open now, and until the room has a desk it sits at the
        top, because then it *is* the job.
      */}
      {data.stations.length > 0 && (
        <StationsCard eventId={eventId} stations={data.stations} onChanged={() => router.refresh()} />
      )}

      <Toast message={toast} onClose={closeToast} />
    </>
  );
}

/** What a speaker at a desk is up to, in one line (D-121). */
function deskLine(row: ExpectedArrival): string {
  if (row.signed_off_version) return `Signed off v${row.signed_off_version} — ready to check out`;
  if (row.status === "attention") return "File held back — needs a clean copy";
  if (row.status === "missing") return "No file yet — take it in with Local intake";
  if (row.status === "processing") return "File being checked";
  return "Going through the slides";
}

/** What to do when this speaker walks in, in one line (D-121). */
function arrivalLine(row: ExpectedArrival): string {
  switch (row.status) {
    case "missing":
      return "No file yet — upload it here, or take it in with Local intake when they arrive.";
    case "attention":
      return "Their file failed the virus check — ask for a clean copy (USB drive or saved file).";
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
  label = "Check in",
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
      <button className="btn pri" disabled title="Add a desk under Desks first">
        <Icon name="login" />
        Check in
      </button>
    );
  }
  return (
    <div className="rowmenu" style={{ verticalAlign: "middle" }}>
      <button
        ref={trigger}
        className="btn pri"
        disabled={disabled || free.length === 0}
        title={free.length === 0 ? "Every desk is in use. Check a speaker out to free one." : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="login" />
        {label}
      </button>
      <FloatingMenu open={open} trigger={trigger} menu={menu} width={220}>
          <div className="label">At which desk?</div>
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
        <h3>Desks · {stations.length}</h3>
        <span className="m">where speakers check in — rename or remove them here</span>
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
          <div className="empty">No desks yet. Add each desk this room has — speakers are checked in at one.</div>
        ) : (
          <table>
            <tbody>
              {stations.map((station) => (
                <tr key={station.id} className="srr-row">
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
                          <Icon name="save" />
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
                  <td className="srr-actions">
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
                            <Icon name="trash" />
                            Remove {station.name}
                          </button>{" "}
                          <button className="btn" onClick={() => setConfirming(null)}>
                            Keep
                          </button>
                        </>
                      ) : (
                        <>
                          <button className="btn" disabled={working} onClick={() => setEditing({ id: station.id, name: station.name })}>
                            <Icon name="edit" />
                            Rename
                          </button>{" "}
                          <button
                            className="btn"
                            disabled={working || station.busy}
                            title={station.busy ? "A speaker is checked in here" : undefined}
                            onClick={() => setConfirming(station.id)}
                          >
                            <Icon name="trash" />
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
            aria-label="New desk name"
            placeholder="Desk name, e.g. Desk 1"
            value={draft}
            maxLength={60}
            onChange={(event) => setDraft(event.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn pri" disabled={working || !draft.trim()}>
            <Icon name="add" />
            Add desk
          </button>
        </form>
      </div>
    </div>
  );
}
