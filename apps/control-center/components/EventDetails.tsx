"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EventDraft } from "@/lib/api";
import { configureEvent, ApiError } from "@/lib/api";
import { Chip } from "@/components/Chip";
import { eventStatusChip } from "@/lib/eventStatus";
import { DateField } from "@/components/DateTimeField";

const TIMEZONE_NOTE =
  "Every time in this event — session times, deadlines, reminders — is read in this zone.";

const dateRange = (from: string, to: string) => {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  const start = new Date(`${from}T00:00:00Z`).toLocaleDateString("en-US", opts);
  const end = new Date(`${to}T00:00:00Z`).toLocaleDateString("en-US", { ...opts, year: "numeric" });
  return `${start} – ${end}`;
};

/**
 * An event's own setup, readable and correctable in one place.
 *
 * It was screen 18 and is now the top of screen 4 (D-058): opening an event shows what
 * it is and how it is going, rather than putting the two a click apart. `embedded`
 * drops this component's own page header, because the command centre already carries
 * the event's name, venue, day and live indicator — one heading, not two.
 *
 * Two kinds of field share this screen and the difference is stated rather than
 * implied. A **name** and a **venue** are labels: correcting either changes what
 * people read and nothing else, and both are commonly wrong, because an event is
 * created before its venue is confirmed. The **timezone** and the **dates** are
 * load-bearing — every session time, every deadline and every room file is set
 * against them — so once the event is live they are shown with the reason they
 * cannot be edited here, rather than being quietly absent or, worse, editable and
 * ignored.
 */
export function EventDetails({
  setup,
  talks,
  canEdit,
  embedded = false,
}: {
  setup: EventDraft;
  talks: { total: number; collected: number };
  canEdit: boolean;
  embedded?: boolean;
}) {
  const router = useRouter();
  const chip = eventStatusChip(setup.status);

  const [name, setName] = useState(setup.name);
  const [venue, setVenue] = useState(setup.venue ?? "");
  const [deadline, setDeadline] = useState(
    typeof setup.settings.upload_deadline === "string" ? setup.settings.upload_deadline : "",
  );
  const [reminders, setReminders] = useState(
    typeof setup.settings.reminders === "string" ? setup.settings.reminders : "",
  );
  const [accent, setAccent] = useState(
    typeof setup.branding.accent === "string" ? setup.branding.accent : "#44C7F4",
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const basicsChanged = name !== setup.name || venue !== (setup.venue ?? "");
  const settingsChanged =
    deadline !== (setup.settings.upload_deadline ?? "") ||
    reminders !== (setup.settings.reminders ?? "");
  const brandingChanged = accent !== (setup.branding.accent ?? "#44C7F4");
  const changed = basicsChanged || settingsChanged || brandingChanged;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // One request, and only the parts that actually changed — an untouched group
      // sent anyway would write a settings key the event never had and an audit
      // record claiming it was edited.
      await configureEvent(setup.id, {
        ...(basicsChanged
          ? {
              basics: {
                name,
                venue,
                // Unchanged by construction: these are not editable here while the
                // event is live, and the endpoint refuses them by name if they differ.
                timezone: setup.timezone,
                starts_on: setup.starts_on,
                ends_on: setup.ends_on,
              },
            }
          : {}),
        ...(settingsChanged ? { settings: { upload_deadline: deadline, reminders } } : {}),
        ...(brandingChanged ? { branding: { accent } } : {}),
      });
      setToast("Saved");
      // The name shows in the portfolio, the sidebar's switcher and this header, all
      // rendered by the server — so re-read rather than patch three copies by hand.
      router.refresh();
      setTimeout(() => setToast(null), 4000);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const readOnly = !canEdit;

  return (
    <>
      {!embedded && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <h1 className="htitle" style={{ marginBottom: 2 }}>
              {setup.name}
            </h1>
            <span className="note">
              {[setup.venue, dateRange(setup.starts_on, setup.ends_on), setup.timezone]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Chip status={chip.status} label={chip.label} />
            <Link href={`/events/${setup.id}`} className="btn pri">
              Open command center →
            </Link>
          </div>
        </div>
      )}

      {error && <div className="err">{error}</div>}
      {/* An archived event explains itself in the page's own banner (D-062). */}
      {readOnly && setup.status !== "archived" && (
        <div className="note" style={{ marginBottom: 12 }}>
          You can read this event&rsquo;s setup. Changing it needs a presentation manager, project
          manager or administrator.
        </div>
      )}

      <div className="card">
        <div className="chd">
          <h3>Basics</h3>
          <span className="m">what this event is called, and where</span>
        </div>
        <div className="cbd">
          <div className="grid2">
            <div className="field">
              <label htmlFor="event-name">Event name</label>
              <input
                id="event-name"
                style={{ width: "100%" }}
                value={name}
                disabled={readOnly}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="event-venue">Venue</label>
              <input
                id="event-venue"
                style={{ width: "100%" }}
                value={venue}
                disabled={readOnly}
                placeholder="Not recorded"
                onChange={(event) => setVenue(event.target.value)}
              />
            </div>
          </div>

          {/*
            Shown, locked, and told why. Leaving them off the screen would hide the
            timezone that every displayed time in the product depends on; rendering
            them as inputs that the endpoint then refuses would be the trap D-033 took
            out of the row editor.
          */}
          <table style={{ marginTop: 10 }}>
            <tbody>
              <tr>
                <td>Time zone</td>
                <td>
                  <span className="mono">{setup.timezone}</span>
                  <div className="note">{TIMEZONE_NOTE}</div>
                </td>
              </tr>
              <tr>
                <td>Dates</td>
                <td>
                  <span className="mono">
                    {setup.starts_on} → {setup.ends_on}
                  </span>
                  <div className="note">
                    Fixed once the event is live — its sessions, deadlines and room files are all set
                    against these. Moving an event is a re-import, not an edit here.
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>Agenda</h3>
          <span className="m">from the schedule import · edit it in the Agenda tab (D-064)</span>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          <table>
            <tbody>
              <tr>
                <td>Days</td>
                <td className="num">{setup.days}</td>
              </tr>
              <tr>
                <td>Sessions</td>
                <td className="num">{setup.sessions}</td>
              </tr>
              <tr>
                <td>Talks</td>
                <td>
                  <span className="num">
                    {talks.collected} / {talks.total}
                  </span>{" "}
                  <span className="note">collected</span>
                </td>
              </tr>
              <tr>
                <td>Rooms</td>
                <td>{setup.rooms.length > 0 ? setup.rooms.join(", ") : <span className="note">none</span>}</td>
              </tr>
              <tr>
                <td>Tracks</td>
                <td>{setup.tracks.length > 0 ? setup.tracks.join(", ") : <span className="note">none</span>}</td>
              </tr>
            </tbody>
          </table>
          {setup.status !== "archived" && (
            <div className="cbd">
              <Link href={`/events/${setup.id}/import`} className="btn">
                Re-import agenda
              </Link>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>Deadlines &amp; workflow</h3>
          <span className="m">when the speaker portal closes</span>
        </div>
        <div className="cbd">
          <div className="grid2">
            <div className="field">
              <label htmlFor="event-deadline">Upload deadline</label>
              {/*
                The DXG dashboard's picker (D-044), bounded by the event itself: a
                deadline after the event has started is not a deadline, and one before
                the agenda exists cannot be met. The event's own dates are the window.
              */}
              <DateField
                id="event-deadline"
                value={deadline}
                max={setup.starts_on}
                disabled={readOnly}
                onChange={setDeadline}
                ariaLabel="Upload deadline"
              />
              {deadline === "" && <div className="note">Not set — no deadline is enforced.</div>}
            </div>
            <div className="field">
              <label htmlFor="event-reminders">Reminder cadence</label>
              <input
                id="event-reminders"
                style={{ width: "100%" }}
                value={reminders}
                disabled={readOnly}
                placeholder="T-14 · T-7 · T-2 · missing-file only"
                onChange={(event) => setReminders(event.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>Branding</h3>
          <span className="m">what the speaker and client surfaces wear</span>
        </div>
        <div className="cbd">
          <div className="field">
            <label htmlFor="event-accent">Accent colour</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                id="event-accent"
                type="color"
                value={accent}
                disabled={readOnly}
                onChange={(event) => setAccent(event.target.value)}
              />
              <span className="mono">{accent}</span>
            </div>
          </div>
        </div>
      </div>

      {canEdit && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
          <button className="btn pri" disabled={busy || !changed} onClick={() => void save()}>
            Save changes
          </button>
          {!changed && <span className="note">Nothing changed yet.</span>}
        </div>
      )}

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </>
  );
}
