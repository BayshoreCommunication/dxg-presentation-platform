import { formatSessionTime } from "@pmp/format";

/**
 * The three confirmations a talk needs, side by side (D-113, UX_REVIEW root cause 5):
 * a reviewer approves the file, the speaker signs it off in the Speaker Ready Room, and
 * staff load it onto the room PC and tick it (D-125). They are separate steps, done by different people in
 * any order, and nothing on screen used to connect them. Each step is done, waiting or
 * not needed, with who/when when the page knows it, and one line says what comes next.
 *
 * Every fact comes from data the page already loads; nothing here asks the server.
 */
export type ConfirmationFacts = {
  /** The talk status code (derived by @pmp/domain). */
  status: string;
  room: string | null;
  hasSpeaker: boolean;
  /** The newest version's number, when known — "v3 is waiting for a reviewer". */
  latestVersion?: number | null;
  approved: { version: number; by?: string | null; at?: string | null } | null;
  /** Distinct room-copy states of the approved version; undefined when the page doesn't know them. */
  roomStates?: string[];
  signOff: { version: number; by?: string | null; at?: string | null } | null;
  timezone: string;
};

type StepState = "done" | "waiting" | "not_needed";
type Step = { title: string; short: string; state: StepState; detail: string; next?: string };

const WAITING_FOR_FILE: Record<string, { detail: string; next: string }> = {
  missing: {
    detail: "No file yet",
    next: "Waiting for the speaker to upload — or take the file by USB when they check in.",
  },
  processing: { detail: "File checks running", next: "Nothing to do — the checks take about a minute." },
  submitted: { detail: "Waiting for a reviewer", next: "A reviewer approves it in Review presentations." },
  needs_revision: { detail: "Sent back for changes", next: "Waiting for the speaker's new version." },
  attention: { detail: "Failed the virus check", next: "Ask the speaker for a clean copy." },
};

export function confirmationSteps(facts: ConfirmationFacts): Step[] {
  const at = (iso?: string | null) => (iso ? ` · ${formatSessionTime(iso, facts.timezone)}` : "");
  const by = (name?: string | null) => (name ? ` by ${name}` : "");
  const canceled = facts.status === "canceled";
  const { approved, signOff } = facts;

  // 1 — the reviewer.
  const waitingFor = WAITING_FOR_FILE[facts.status] ?? WAITING_FOR_FILE.submitted!;
  const newer = approved && facts.latestVersion && facts.latestVersion > approved.version ? facts.latestVersion : null;
  const review: Step = canceled
    ? { title: "Approved by a reviewer", short: "Approved", state: "not_needed", detail: "Session cancelled" }
    : approved
      ? {
          title: "Approved by a reviewer",
          short: "Approved",
          state: "done",
          detail: `v${approved.version}${by(approved.by)}${at(approved.at)}${newer ? ` · v${newer} not approved yet` : ""}`,
          ...(newer && facts.status === "submitted" ? { next: `v${newer} is waiting for a reviewer in Review presentations.` } : {}),
        }
      : {
          title: "Approved by a reviewer",
          short: "Approved",
          state: "waiting",
          detail: facts.latestVersion ? `v${facts.latestVersion}: ${waitingFor.detail.toLowerCase()}` : waitingFor.detail,
          next: waitingFor.next,
        };

  // 2 — the speaker, at the Speaker Ready Room desk. Not a gate: each approved version
  // is loaded onto the room PC whether or not the speaker has signed off.
  const signoff: Step = canceled
    ? { title: "Signed off by the speaker in the Speaker Ready Room", short: "Signed off", state: "not_needed", detail: "Session cancelled" }
    : !facts.hasSpeaker
      ? {
          title: "Signed off by the speaker in the Speaker Ready Room",
          short: "Signed off",
          state: "not_needed",
          detail: "No speaker on this talk",
        }
      : signOff && approved && signOff.version < approved.version
        ? {
            title: "Signed off by the speaker in the Speaker Ready Room",
            short: "Signed off",
            state: "waiting",
            detail: `Signed off v${signOff.version}, but v${approved.version} was approved since`,
            next: `Check the speaker in again and confirm v${approved.version} as their final version.`,
          }
        : signOff
          ? {
              title: "Signed off by the speaker in the Speaker Ready Room",
              short: "Signed off",
              state: "done",
              detail: `v${signOff.version}${by(signOff.by)}${at(signOff.at)}`,
            }
          : {
              title: "Signed off by the speaker in the Speaker Ready Room",
              short: "Signed off",
              state: "waiting",
              detail: "Not yet",
              next: "When the speaker arrives, check them in at the Speaker Ready Room and confirm their final version.",
            };

  // 3 — the approved version is loaded on the room PC. D-125: DXG staff copy it there by
  // hand and tick it on Room sync; nothing is checked automatically.
  const states = facts.roomStates;
  const room = facts.room ?? "the room";
  const inRoom: Step = canceled
    ? { title: "Loaded on the room PC", short: "Loaded", state: "not_needed", detail: "Session cancelled" }
    : !approved
      ? {
          title: "Loaded on the room PC",
          short: "Loaded",
          state: "waiting",
          detail: "After approval",
          next: `Once approved, copy it to ${room}'s PC and tick it on Room sync.`,
        }
      : !facts.room
        ? {
            title: "Loaded on the room PC",
            short: "Loaded",
            state: "waiting",
            detail: "No room assigned",
            next: "Give the session a room so the approved file has a room PC to go to.",
          }
        : roomStep(states, facts.status, approved.version, facts.room);

  return [review, signoff, inRoom];
}

/** Step 3 from the approved version's room copies, or — when unknown — the talk status. */
function roomStep(states: string[] | undefined, status: string, version: number, room: string): Step {
  const base = { title: "Loaded on the room PC", short: "Loaded" };
  const done = states ? states.length > 0 && states.every((state) => state === "active") : status === "synchronized_onsite";
  if (done) return { ...base, state: "done", detail: `v${version} loaded in ${room}` };
  if (status === "update_pending_ack") {
    return {
      ...base,
      state: "waiting",
      detail: `v${version} not loaded yet — the room PC has an older version`,
      next: `Load v${version} onto the room PC and tick it on Room sync.`,
    };
  }
  return { ...base, state: "waiting", detail: "Not loaded yet", next: "Copy it to the room PC and tick it on Room sync." };
}

const MARK: Record<StepState, string> = { done: "✓", waiting: "○", not_needed: "–" };
const WORD: Record<StepState, string> = { done: "Done", waiting: "Waiting", not_needed: "Not needed" };
const COLOR = (step: Step) => (step.state === "done" ? "var(--success)" : "var(--muted-foreground)");

/**
 * The strip. `compact` is one line of marks per talk for lists (the Speaker Ready Room
 * dashboard): "✓ Approved · ○ Signed off · ○ Loaded" — the row's status line already
 * says what to do next, and hovering a mark gives its detail.
 */
export function ConfirmationStrip({ facts, compact = false }: { facts: ConfirmationFacts; compact?: boolean }) {
  if (facts.status === "archived") return null;
  const steps = confirmationSteps(facts);
  const next = steps.find((step) => step.state === "waiting" && step.next)?.next ?? steps.find((step) => step.next)?.next;
  const allDone = steps.every((step) => step.state !== "waiting");

  if (compact) {
    return (
      <div className="note" style={{ marginTop: 2 }}>
        {steps.map((step, index) => (
          <span key={step.short} title={`${step.title}: ${step.detail}`}>
            {index > 0 && " · "}
            <span style={{ color: COLOR(step) }}>{MARK[step.state]}</span> {step.short}
            {step.state === "done" && step.short === "Signed off" ? ` v${facts.signOff?.version ?? ""}` : ""}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div style={{ margin: "4px 0 12px" }} aria-label="Approval, sign-off and room">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {steps.map((step, index) => (
          <div
            key={step.short}
            style={{
              flex: "1 1 180px",
              minWidth: 0,
              border: "1px solid var(--border)",
              borderLeft: `3px solid ${step.state === "done" ? "var(--success)" : "var(--border)"}`,
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 13,
            }}
          >
            <div style={{ fontWeight: 500 }}>
              {index + 1} {step.title}
            </div>
            <div style={{ color: COLOR(step), fontSize: 12.5, marginTop: 2 }}>
              {MARK[step.state]} {WORD[step.state]}
            </div>
            <div className="note" style={{ fontSize: 12.5, marginTop: 2 }}>
              {step.detail}
            </div>
          </div>
        ))}
      </div>
      <div className="note" style={{ marginTop: 6 }}>
        {facts.status === "canceled"
          ? "The session was cancelled — nothing to do."
          : allDone
              ? "All three confirmations are in — nothing left to do."
            : next
              ? `Next: ${next}`
              : null}{" "}
        These are separate steps: each approved version is loaded onto the room PC whether or not the speaker has signed off.
      </div>
    </div>
  );
}
