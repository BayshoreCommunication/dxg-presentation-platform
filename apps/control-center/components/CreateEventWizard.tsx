"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EventDraft } from "@/lib/api";
import { createEvent, configureEvent, activateEvent, getDraft, ApiError } from "@/lib/api";
import { ImportView } from "@/components/ImportView";
import { DateField } from "@/components/DateTimeField";

/*
 * Step 2 is called "Agenda", not "Schedule import": inside the wizard it is the thing
 * being described, not the act of loading it — the other three steps are named for
 * what they set up, and this one was named for a mechanism. The standalone screen
 * keeps its own name, since there the import *is* what you came to do.
 */
const STEPS = ["Basics", "Agenda", "Deadlines & workflow", "Branding & template"] as const;

/**
 * Screen 2 — the four-step wizard. Step 1 commits a draft; a draft sends nothing.
 *
 * Step 2 used to be two text boxes for rooms and tracks. It is the schedule import
 * now (D-026): `commitImport` already creates rooms, tracks and event days from the
 * agenda, so typing them first did not save work — it created a second list the
 * spreadsheet then had to match, and a mismatch was a *blocking* import error on
 * data the project manager did not author.
 */
/** Settings and branding come back as `unknown`; a missing one must not become "undefined". */
const text = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length > 0 ? value : fallback;

export function CreateEventWizard({
  timezones,
  resume = null,
}: {
  timezones: string[];
  /**
   * An unfinished draft to carry on with. The portfolio sends one here rather than to
   * its command centre: a draft has no rooms, no sessions and no talks, so that screen
   * could only ever answer an event's questions with zeroes, and the one thing the
   * event actually needs — the rest of its setup — was not reachable from anywhere.
   */
  resume?: EventDraft | null;
}) {
  const router = useRouter();
  // Back to where the work stopped: step 2 wants the agenda, and once that is in, the
  // first step that still has something to say.
  const [step, setStep] = useState(resume ? (resume.sessions > 0 ? 3 : 2) : 1);
  const [draft, setDraft] = useState<EventDraft | null>(resume);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [basics, setBasics] = useState({
    name: resume?.name ?? "",
    venue: resume?.venue ?? "",
    timezone: resume?.timezone ?? timezones[0] ?? "UTC",
    starts_on: resume?.starts_on ?? "",
    ends_on: resume?.ends_on ?? "",
  });
  const [imported, setImported] = useState<{ created: number; updated: number; unchanged: number } | null>(
    null,
  );
  const [deadline, setDeadline] = useState(text(resume?.settings.upload_deadline, ""));
  const [reminders, setReminders] = useState(
    text(resume?.settings.reminders, "T-14 · T-7 · T-2 · missing-file only"),
  );
  const [accent, setAccent] = useState(text(resume?.branding.accent, "#44C7F4"));

  /*
   * Steps 3 and 4 are unreachable until an agenda is in (Travis's call, D-026 amended).
   * The chips are a navigation control, so the rule has to live here as well as on the
   * button — otherwise the button is a suggestion and the chip is the way round it.
   */
  /*
   * `imported` only knows about an import done in this browser session, so on a
   * resumed draft it is null however complete the agenda is. The durable answer is the
   * one the importer left behind: `commitImport` writes the sessions, so a draft that
   * has any has an agenda.
   */
  const hasAgenda = imported !== null || (draft?.sessions ?? 0) > 0;

  const reachable = (target: number): boolean => {
    if (target === 1) return true;
    if (!draft) return false;
    return target === 2 || hasAgenda;
  };

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
      {resume && (
        <p className="note" style={{ marginTop: -8, marginBottom: 12 }}>
          Carrying on with <strong>{resume.name}</strong>, an unfinished draft. Nothing has been sent
          to anyone from it.
        </p>
      )}
      {error && <div className="err">{error}</div>}

      <div className="card">
        <div className="cbd" style={{ display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid var(--line)" }}>
          {STEPS.map((label, index) => (
            <span
              key={label}
              className={`chip ${index + 1 === step ? "c-info" : index + 1 < step ? "c-ok" : "c-mut"}`}
              style={{ cursor: reachable(index + 1) ? "pointer" : "not-allowed" }}
              title={reachable(index + 1) ? undefined : "Import the schedule first"}
              onClick={() => reachable(index + 1) && setStep(index + 1)}
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
                  <label htmlFor="event-starts-on">Start date</label>
                  {/* The DXG dashboard's picker (D-044). The end cannot precede the
                      start, and neither is offered outside that relationship. */}
                  <DateField
                    id="event-starts-on"
                    value={basics.starts_on}
                    max={basics.ends_on || undefined}
                    onChange={(value) => setBasics({ ...basics, starts_on: value })}
                    ariaLabel="Start date"
                  />
                </div>
                <div className="field">
                  <label htmlFor="event-ends-on">End date</label>
                  <DateField
                    id="event-ends-on"
                    value={basics.ends_on}
                    min={basics.starts_on || undefined}
                    onChange={(value) => setBasics({ ...basics, ends_on: value })}
                    ariaLabel="End date"
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
                The event builds itself from the agenda — rooms, tracks and days are created from it,
                so there is nothing to type twice.
              </div>

              <ImportView eventId={draft.id} embedded onCommitted={setImported} />

              {!imported && (
                <div className="note">
                  ⚠ The event&rsquo;s rooms, days and sessions all come from the agenda, so the
                  remaining steps stay locked until it is imported. The draft is saved — you can
                  leave and come back to it.
                </div>
              )}
            </>
          )}

          {step === 3 && (
            <div className="grid2">
              <div className="field">
                <label htmlFor="upload-deadline">Speaker upload deadline</label>
                {/*
                  A free-text box until now, with `Feb 27, 2027 · 23:59` as its
                  placeholder — so this screen and Event details, which reads the same
                  `upload_deadline` setting through a date field, disagreed about what
                  shape the value has. Whatever was typed here was stored verbatim and
                  then did not display there at all. One control, one format (D-044).

                  Bounded by the event's own start: a deadline after the event has begun
                  is not a deadline.
                */}
                <DateField
                  id="upload-deadline"
                  value={deadline}
                  max={basics.starts_on || undefined}
                  onChange={setDeadline}
                  ariaLabel="Speaker upload deadline"
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
                      // Editable boxes that quietly discard what you type are the trap
                      // D-033 took out of the row editor. Sent only when something
                      // actually changed, so returning to a draft and pressing on does
                      // not rewrite its dates or add an audit record saying it did.
                      const edited =
                        draft.name !== basics.name ||
                        (draft.venue ?? "") !== basics.venue ||
                        draft.timezone !== basics.timezone ||
                        draft.starts_on !== basics.starts_on ||
                        draft.ends_on !== basics.ends_on;
                      if (edited) setDraft(await configureEvent(draft.id, { basics }));
                      setStep(2);
                      return edited ? "Basics saved" : null;
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
                disabled={busy || !draft || (step === 2 && !hasAgenda)}
                title={
                  step === 2 && !hasAgenda
                    ? "Import the schedule to continue — rooms, days and sessions all come from it"
                    : undefined
                }
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
