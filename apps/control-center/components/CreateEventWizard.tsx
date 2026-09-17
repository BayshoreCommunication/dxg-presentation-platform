"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EventDraft } from "@/lib/api";
import { createEvent, configureEvent, activateEvent, ApiError } from "@/lib/api";

const STEPS = ["Basics", "Rooms & tracks", "Deadlines & workflow", "Branding & template"] as const;

/** Screen 2 — the four-step wizard. Step 1 commits a draft; a draft sends nothing. */
export function CreateEventWizard({ timezones }: { timezones: string[] }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [basics, setBasics] = useState({
    name: "",
    venue: "",
    timezone: timezones[0] ?? "UTC",
    starts_on: "",
    ends_on: "",
  });
  const [rooms, setRooms] = useState("");
  const [tracks, setTracks] = useState("");
  const [deadline, setDeadline] = useState("");
  const [reminders, setReminders] = useState("T-14 · T-7 · T-2 · missing-file only");
  const [accent, setAccent] = useState("#44C7F4");

  async function run(work: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    try {
      const message = await work();
      if (message) setToast(message);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 4000);
    }
  }

  const split = (value: string) =>
    value
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);

  return (
    <>
      <h1 className="htitle">Create event</h1>
      {error && <div className="err">{error}</div>}

      <div className="card">
        <div className="cbd" style={{ display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid var(--line)" }}>
          {STEPS.map((label, index) => (
            <span
              key={label}
              className={`chip ${index + 1 === step ? "c-info" : index + 1 < step ? "c-ok" : "c-mut"}`}
              style={{ cursor: draft || index === 0 ? "pointer" : "default" }}
              onClick={() => (draft || index === 0) && setStep(index + 1)}
            >
              {index + 1}. {label}
            </span>
          ))}
        </div>

        <div className="cbd">
          {step === 1 && (
            <>
              <div className="grid2">
                <div className="field">
                  <label>Event name</label>
                  <input
                    style={{ width: "100%" }}
                    value={basics.name}
                    onChange={(event) => setBasics({ ...basics, name: event.target.value })}
                    placeholder="MedTech Forward 2027"
                  />
                </div>
                <div className="field">
                  <label>Venue</label>
                  <input
                    style={{ width: "100%" }}
                    value={basics.venue}
                    onChange={(event) => setBasics({ ...basics, venue: event.target.value })}
                    placeholder="Tampa Convention Center"
                  />
                </div>
                <div className="field">
                  <label>Time zone</label>
                  <select
                    style={{ width: "100%" }}
                    value={basics.timezone}
                    onChange={(event) => setBasics({ ...basics, timezone: event.target.value })}
                  >
                    {timezones.map((zone) => (
                      <option key={zone}>{zone}</option>
                    ))}
                  </select>
                </div>
                <div />
                <div className="field">
                  <label>Start date</label>
                  <input
                    type="date"
                    style={{ width: "100%" }}
                    value={basics.starts_on}
                    onChange={(event) => setBasics({ ...basics, starts_on: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label>End date</label>
                  <input
                    type="date"
                    style={{ width: "100%" }}
                    value={basics.ends_on}
                    onChange={(event) => setBasics({ ...basics, ends_on: event.target.value })}
                  />
                </div>
              </div>
              <div className="note">
                Every time in this event — deadlines, session times, reminders — is interpreted in the
                time zone chosen here.
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="grid2">
                <div className="field">
                  <label>Rooms (one per line, or comma-separated)</label>
                  <textarea
                    style={{ width: "100%", minHeight: 90, font: "inherit", padding: 8, borderRadius: 6, border: "1px solid var(--line)" }}
                    value={rooms}
                    onChange={(event) => setRooms(event.target.value)}
                    placeholder={"Ballroom A\nBallroom B\nRoom 210"}
                  />
                </div>
                <div className="field">
                  <label>Tracks</label>
                  <textarea
                    style={{ width: "100%", minHeight: 90, font: "inherit", padding: 8, borderRadius: 6, border: "1px solid var(--line)" }}
                    value={tracks}
                    onChange={(event) => setTracks(event.target.value)}
                    placeholder={"Cardiology\nSurgical Innovation"}
                  />
                </div>
              </div>
              <div className="note">
                ⚠ Invitations can&rsquo;t be sent until the event has at least one day and one room —
                a speaker link would point at nothing.
              </div>
            </>
          )}

          {step === 3 && (
            <div className="grid2">
              <div className="field">
                <label>Speaker upload deadline</label>
                <input
                  style={{ width: "100%" }}
                  value={deadline}
                  onChange={(event) => setDeadline(event.target.value)}
                  placeholder="Feb 27, 2027 · 23:59"
                />
              </div>
              <div className="field">
                <label>Reminders</label>
                <input style={{ width: "100%" }} value={reminders} onChange={(event) => setReminders(event.target.value)} />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="grid2">
              <div className="field">
                <label>Accent colour</label>
                <input className="mono" style={{ width: "100%" }} value={accent} onChange={(event) => setAccent(event.target.value)} />
              </div>
              <div className="field">
                <label>Event header &amp; slide template</label>
                <button className="btn" style={{ width: "100%" }} disabled title="Asset upload — M1-4">
                  Upload…
                </button>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            {step > 1 && (
              <button className="btn" disabled={busy} onClick={() => setStep(step - 1)}>
                ‹ Back
              </button>
            )}

            {step === 1 && (
              <button
                className="btn pri"
                disabled={busy || !basics.name || !basics.starts_on || !basics.ends_on}
                onClick={() =>
                  void run(async () => {
                    if (draft) {
                      setStep(2);
                      return null;
                    }
                    const { event_id } = await createEvent(basics);
                    setDraft(await (await import("@/lib/api")).getDraft(event_id));
                    setStep(2);
                    return "Draft created — nothing is sent to anyone from a draft";
                  })
                }
              >
                {draft ? "Continue ›" : "Create draft ›"}
              </button>
            )}

            {step > 1 && step < 4 && (
              <button
                className="btn pri"
                disabled={busy || !draft}
                onClick={() =>
                  void run(async () => {
                    const updated = await configureEvent(draft!.id, {
                      ...(step === 2 ? { rooms: split(rooms), tracks: split(tracks) } : {}),
                      ...(step === 3
                        ? { settings: { upload_deadline: deadline, reminders } }
                        : {}),
                    });
                    setDraft(updated);
                    setStep(step + 1);
                    return null;
                  })
                }
              >
                Save &amp; continue ›
              </button>
            )}

            {step === 4 && (
              <button
                className="btn good"
                disabled={busy || !draft}
                onClick={() =>
                  void run(async () => {
                    await configureEvent(draft!.id, { branding: { accent } });
                    const activated = await activateEvent(draft!.id);
                    setDraft(activated);
                    router.push(`/events/${activated.id}`);
                    return "Event activated";
                  })
                }
              >
                Activate event
              </button>
            )}
          </div>
        </div>
      </div>

      {draft && (
        <div className="card">
          <div className="chd">
            <h3>Draft so far</h3>
            <span className="chip c-mut">{draft.status}</span>
          </div>
          <div className="cbd" style={{ padding: "0 0 4px" }}>
            <table>
              <tbody>
                <tr>
                  <td>Name</td>
                  <td>{draft.name}</td>
                </tr>
                <tr>
                  <td>Days</td>
                  <td className="num">{draft.days}</td>
                </tr>
                <tr>
                  <td>Rooms</td>
                  <td>{draft.rooms.length > 0 ? draft.rooms.join(", ") : <span className="chip c-warn">none yet</span>}</td>
                </tr>
                <tr>
                  <td>Tracks</td>
                  <td>{draft.tracks.length > 0 ? draft.tracks.join(", ") : "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </>
  );
}
