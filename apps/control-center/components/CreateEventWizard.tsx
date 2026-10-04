"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EventDraft } from "@/lib/api";
import { createEvent, configureEvent, activateEvent, getDraft, ApiError } from "@/lib/api";
import { ColorPicker } from "@/components/ColorPicker";
import { ReminderDaysField, reminderDaysFrom } from "@/components/ReminderDaysField";
import { BrandAssetField, assetFrom } from "@/components/BrandAssetField";
import { ImportView } from "@/components/ImportView";
import { DateField, today } from "@/components/DateTimeField";
import { WhyNot } from "@/components/WhyNot";
import { timeZoneOptions } from "@pmp/format";

/** Tomorrow on this computer, `YYYY-MM-DD` — the earliest an event may start (D-101). */
const tomorrow = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/*
 * Step 2 is called "Agenda", not "Schedule import": inside the wizard it is the thing
 * being described, not the act of loading it — the other three steps are named for
 * what they set up, and this one was named for a mechanism. The standalone screen
 * keeps its own name, since there the import *is* what you came to do.
 */
// S17 (D-113): step 3 sets deadlines and reminders; there is no "workflow" in it.
const STEPS = ["Basics", "Agenda", "Deadlines & reminders", "Branding & template"] as const;

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
    timezone: resume?.timezone ?? timeZoneOptions(timezones)[0]?.zone ?? "UTC",
    starts_on: resume?.starts_on ?? "",
    ends_on: resume?.ends_on ?? "",
  });
  const [imported, setImported] = useState<{ created: number; updated: number; unchanged: number } | null>(
    null,
  );
  const [deadline, setDeadline] = useState(text(resume?.settings.upload_deadline, ""));
  const [reminderDays, setReminderDays] = useState<number[]>(reminderDaysFrom(resume?.settings));
  const [accent, setAccent] = useState(text(resume?.branding.accent, "#44C7F4"));

  /*
   * S16 (D-113): the accent is saved when picked, like the header and template beside it,
   * not only on Activate — leaving the wizard at step 4 used to lose it. Debounced, since
   * dragging across the colour wheel reports every colour it passes.
   */
  useEffect(() => {
    if (step !== 4 || !draft || draft.status !== "draft") return;
    if (accent.toUpperCase() === text(draft.branding.accent, "#44C7F4").toUpperCase()) return;
    const timer = setTimeout(() => {
      configureEvent(draft.id, { branding: { accent } })
        .then(setDraft)
        .catch(() => undefined); // Activate saves it again, and shows any error there.
    }, 600);
    return () => clearTimeout(timer);
  }, [accent, step, draft]);

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
              // Before a draft exists the blocker is Basics, not the agenda (D-111, S13).
              title={reachable(index + 1) ? undefined : !draft ? "Finish Basics first." : "Add the agenda first."}
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
                    placeholder="Event name"
                  />
                </div>
                <div className="field">
                  <label>Venue</label>
                  <input
                    style={{ width: "100%" }}
                    value={basics.venue}
                    onChange={(event) => setBasics({ ...basics, venue: event.target.value })}
                    placeholder="Venue name"
                  />
                </div>
                <div className="field">
                  <label>Time zone</label>
                  <select
                    style={{ width: "100%" }}
                    value={basics.timezone}
                    onChange={(event) => setBasics({ ...basics, timezone: event.target.value })}
                  >
                    {/* Named zones, US venues first; the stored value stays IANA (S14, D-110). */}
                    {timeZoneOptions(timezones).map(({ zone, label }) => (
                      <option key={zone} value={zone}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div />
                <div className="field">
                  <label htmlFor="event-starts-on">Start date</label>
                  {/* The DXG dashboard's picker (D-044). An event starts tomorrow at the
                      earliest (D-101). The start is never capped by the end: picking a start
                      after the current end moves the end with it, instead of greying out
                      every later day — which read as "these dates are unavailable". */}
                  <DateField
                    id="event-starts-on"
                    value={basics.starts_on}
                    min={tomorrow()}
                    onChange={(value) =>
                      setBasics({
                        ...basics,
                        starts_on: value,
                        ends_on: basics.ends_on && value && basics.ends_on < value ? value : basics.ends_on,
                      })
                    }
                    ariaLabel="Start date"
                  />
                </div>
                <div className="field">
                  <label htmlFor="event-ends-on">End date</label>
                  <DateField
                    id="event-ends-on"
                    value={basics.ends_on}
                    min={basics.starts_on || tomorrow()}
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
              <ImportView eventId={draft.id} embedded hasSessions={hasAgenda} onCommitted={setImported} />

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

                  Bounded at both ends: a deadline after the event has begun is not a
                  deadline, and one that has already passed cannot be met — the calendar
                  opened on last month with every day of it on offer.
                */}
                <DateField
                  id="upload-deadline"
                  value={deadline}
                  min={today()}
                  max={basics.starts_on || undefined}
                  onChange={setDeadline}
                  ariaLabel="Speaker upload deadline"
                />
              </div>
              <div className="field">
                <label>Automatic reminders</label>
                <ReminderDaysField value={reminderDays} onChange={setReminderDays} deadline={deadline} />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="grid2">
              <div className="field">
                <label htmlFor="wizard-accent">Accent colour</label>
                <ColorPicker id="wizard-accent" value={accent} onChange={setAccent} />
                <div className="note" style={{ marginTop: 6 }}>
                  Used on the speaker and client pages. Saved as soon as picked.
                </div>
              </div>
              <div>
                {/* Uploaded as soon as chosen (D-093); the draft exists by step 4. */}
                <div className="field">
                  <label>Event header</label>
                  {draft && <BrandAssetField eventId={draft.id} kind="header" initial={assetFrom(draft.branding, "header")} />}
                </div>
                <div className="field">
                  <label>Slide template</label>
                  {draft && (
                    <BrandAssetField eventId={draft.id} kind="template" initial={assetFrom(draft.branding, "template")} />
                  )}
                </div>
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

            {step === 1 && (
              // Said on the page, not only on hover (D-111, S12).
              <WhyNot
                reason={
                  !basics.name || !basics.starts_on || !basics.ends_on
                    ? "Enter a name, start date and end date to continue."
                    : null
                }
              />
            )}

            {step > 1 && step < 4 && (
              <button
                className="btn pri"
                disabled={busy || !draft || (step === 2 && !hasAgenda)}
                title={
                  step === 2 && !hasAgenda
                    ? "Add the agenda to continue — rooms, days and sessions all come from it."
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
                        settings: { upload_deadline: deadline, reminder_days: reminderDays },
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

            {step === 2 && (
              <WhyNot
                reason={
                  !hasAgenda
                    ? "Add the agenda to continue — import the schedule or enter it manually."
                    : null
                }
              />
            )}

            {step === 4 && (
              // S16 (D-113): what activating does, before it is pressed.
              <div className="note" style={{ flexBasis: "100%", order: -1, marginBottom: 4 }}>
                Activating makes the event live: it opens on the command center and its dates and time
                zone can no longer be changed. Nothing is emailed when you press it, but from then on the
                automatic reminders go to speakers still missing a file. Invite speakers from
                Communications when you&rsquo;re ready.
              </div>
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

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </>
  );
}
