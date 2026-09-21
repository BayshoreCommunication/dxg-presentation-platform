"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EventDraft } from "@/lib/api";
import { createEvent, configureEvent, activateEvent, getDraft, ApiError } from "@/lib/api";
import { ImportView } from "@/components/ImportView";

const STEPS = ["Basics", "Schedule import", "Deadlines & workflow", "Branding & template"] as const;

/**
 * Screen 2 — the four-step wizard. Step 1 commits a draft; a draft sends nothing.
 *
 * Step 2 used to be two text boxes for rooms and tracks. It is the schedule import
 * now (D-026): `commitImport` already creates rooms, tracks and event days from the
 * agenda, so typing them first did not save work — it created a second list the
 * spreadsheet then had to match, and a mismatch was a *blocking* import error on
 * data the project manager did not author.
 */
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
  const [imported, setImported] = useState<{ created: number; updated: number; unchanged: number } | null>(
    null,
  );
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

          {step === 2 && draft && (
            <>
              <div className="note" style={{ marginBottom: 12 }}>
                Upload the agenda and the event builds itself from it — rooms, tracks and days are
                created from the file, so there is nothing to type twice.
              </div>

              <ImportView eventId={draft.id} embedded onCommitted={setImported} />

              {!imported && (
                <div className="note">
                  ⚠ Invitations can&rsquo;t be sent until the event has at least one day and one room —
                  a speaker link would point at nothing. You can skip this and import later from
                  <b> Import schedule</b>, but nothing goes out to speakers until you do.
                </div>
              )}
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
                    setDraft(await getDraft(event_id));
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
                    if (step === 2) {
                      // The import wrote the rooms, tracks and days itself. Re-read the
                      // draft so the summary below reflects what the file created
                      // rather than what this screen last knew.
                      setDraft(await getDraft(draft!.id));
                      setStep(3);
                      return null;
                    }
                    setDraft(
                      await configureEvent(draft!.id, {
                        settings: { upload_deadline: deadline, reminders },
                      }),
                    );
                    setStep(step + 1);
                    return null;
                  })
                }
              >
                {step === 2 && !imported ? "Skip for now ›" : "Save & continue ›"}
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
                    // The sidebar's event list is fetched by the server layout, which
                    // Next caches across a client navigation — so without this the
                    // event you just created is missing from the switcher you are
                    // standing in, until a full reload.
                    router.refresh();
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
                  <td>
                    {draft.rooms.length > 0 ? (
                      draft.rooms.join(", ")
                    ) : (
                      <span className="chip c-warn">none — import an agenda</span>
                    )}
                  </td>
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
