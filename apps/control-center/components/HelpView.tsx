"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ARCHIVE_STATE,
  CHECK,
  EMAIL_STATUS,
  ROLE,
  ROOM_COPY,
  SEVERITY,
  TALK_STATUS,
  VERSION_STATE,
  type Words,
} from "@pmp/format";

/**
 * Help (D-115): short task guides and a glossary, so DXG staff can use the platform
 * without being taught it first. The glossary is built from the same words every chip
 * and message uses (@pmp/format vocabulary), so it can never disagree with the screens.
 * The guides are written here; keep each step to what a person does and sees.
 */

type Guide = { id: string; title: string; who: string; steps: string[]; tip?: string };
type Section = { title: string; guides: Guide[] };

export const GUIDES: Section[] = [
  {
    title: "Start here",
    guides: [
      {
        id: "practice",
        title: "Practise safely",
        who: "Any DXG staff member",
        steps: [
          "On the Portfolio, under Practice events, press Start a practice event. In a few seconds you have an event of your own: rooms, a two-day agenda and six made-up speakers.",
          "Its files are in every state you will meet: one approved and on its way to its room, one sent back for changes, one waiting for review, one waiting with a warning, and two not uploaded yet.",
          "You are its project manager, so you can do every job: review and approve, request a revision, set up the Speaker Ready Room, sync rooms, build the archive.",
          "To act as a speaker, open Speakers, press Copy link on a speaker's row, and open the link in a private browser window.",
          "Emails are written as usual and appear in Communications as \"Practice — not sent\". Nothing ever reaches a real speaker or client.",
          "When you are done, press Archive on the Portfolio. You can have up to three practice events open at once.",
        ],
        tip: "Every screen of a practice event shows a yellow line at the top, so you always know which kind you are in.",
      },
    ],
  },
  {
    title: "Before the event",
    guides: [
      {
        id: "create-event",
        title: "Create an event",
        who: "Project manager or DXG administrator",
        steps: [
          "Press Create event in the sidebar.",
          "Basics: enter the name, venue, time zone and dates. The event must start tomorrow or later. Press Create draft.",
          "Agenda: upload the schedule (a spreadsheet from the client), or enter sessions by hand. Nothing is saved until you press Import; each problem is listed under its row.",
          "Deadlines & reminders: set the upload deadline and the days before it that speakers still missing files are reminded.",
          "Branding & template: add the logo and colour the speaker and client pages use.",
          "Activate: the event goes live and its dates and time zone lock. Activating emails nobody — you invite speakers yourself.",
        ],
        tip: "Every time in the event — deadlines, sessions, reminders — is in the event's time zone, not yours.",
      },
      {
        id: "staff",
        title: "Give a colleague access",
        who: "DXG administrator",
        steps: [
          "Staff accounts → enter their work email and name → Create account. They get an email with a temporary password.",
          "Press Next: assign them to an event, choose the event and their role (each role's description is shown), then Assign.",
          "On first sign-in they choose their own password and set up the sign-in app on their phone.",
        ],
        tip: "Someone who can sign in but sees \"You haven't been added to an event yet\" needs a role in Event assignments.",
      },
      {
        id: "invite-speakers",
        title: "Invite speakers to upload",
        who: "Presentation manager or above",
        steps: [
          "Speakers come from the agenda. Check each has an email address (Edit email if not).",
          "Set each speaker's Archive permission — what the client's archive may include from them.",
          "Email link sends a speaker their personal upload link. It is sent once; after that use Copy link to share it again.",
          "To invite everyone at once, use Communications: choose the Upload invitation template, check the preview, then send.",
          "After that, speakers still missing files are reminded automatically on the days you chose. Remind speakers missing files sends one now.",
        ],
        tip: "A bounced email shows on the speaker's row. Correct the address with Edit email and send again.",
      },
      {
        id: "emails",
        title: "Change an email template",
        who: "Presentation manager or above",
        steps: [
          "Communications → How your emails look: upload the email banner (PNG or JPG, exactly 1200 px wide and 200–600 px high), and set the sender name and reply-to address. Every speaker email opens with the banner and an Upload your presentation button.",
          "Choose the template → Edit template.",
          "Write the message. The toolbar formats it like a word processor — font, size, bold, colour, lists, alignment, links and images. Use the Insert buttons (Speaker's first name, Session date, Venue, Upload link, Deadline…) for details that differ per speaker; they go where the cursor is.",
          "Read the preview underneath — it is the email exactly as a real speaker would get it.",
          "Keep the Upload link in invitations and reminders: it is each speaker's personal way to upload.",
          "Send a test email to yourself to see it in your own inbox. Save as new template keeps the original and adds a copy under a new name.",
        ],
      },
    ],
  },
  {
    title: "Reviewing presentations",
    guides: [
      {
        id: "review",
        title: "Review and approve a presentation",
        who: "Reviewer or above",
        steps: [
          "Review presentations lists every file waiting, oldest first.",
          "Pick one. Its slides, file checks and comments are on the right.",
          "Approve when it is right. Approve stays greyed while checks run or while a problem that must be fixed is open, and says why.",
          "Request revision sends the speaker your message and waits for a new version. Reject tells the speaker this file won't be used.",
          "Once approved, someone downloads it from Room sync, copies it onto its room's PC and ticks Mark loaded.",
        ],
        tip: "Keyboard: A asks to approve, R asks for a revision.",
      },
      {
        id: "file-problems",
        title: "When a file fails a check",
        who: "Presentation manager or above to waive",
        steps: [
          "Open the inspection report from the presentation. Each problem says what it is and how the speaker can fix it.",
          "\"Must fix\" blocks approval; \"Warning\" doesn't. Read warnings before approving.",
          "Best: ask the speaker for a new version (Ask the speaker to fix this — you can edit the message first).",
          "If the problem doesn't matter for this talk, waive it with a written reason. The waiver is recorded for good.",
          "A file that fails the virus check is held back: it can't be waived, opened or sent to a room. Ask for a clean copy.",
        ],
      },
      {
        id: "go-back",
        title: "Go back to an earlier version",
        who: "Presentation manager or above",
        steps: [
          "Presentation detail → Version history → Go back to vN, with a reason.",
          "The earlier approved version is used again. Check the room PC plays it — if it isn't there, load it and tick it on Room sync.",
        ],
      },
    ],
  },
  {
    title: "Onsite",
    guides: [
      {
        id: "srr",
        title: "Check a speaker in at the Speaker Ready Room",
        who: "Speaker Ready Room technician or above",
        steps: [
          "Speaker Ready Room lists who is expected, with their three confirmations.",
          "Check in → choose a free station. Every station in use? Check a speaker out to free one.",
          "Go through the slides with the speaker (Preview slides).",
          "Sign off: confirm the version the speaker wants to present. Print or email them the receipt.",
          "Check out when they leave. The station is free again.",
        ],
        tip: "Sign-off is the speaker's confirmation. It doesn't replace approval, and each approved version is loaded onto the room PC either way.",
      },
      {
        id: "usb",
        title: "Take a new version by USB",
        who: "Speaker Ready Room technician or above",
        steps: [
          "On the speaker's check-in, open USB intake.",
          "Write why there is a new version, choose the file from the USB drive, then Check & import file.",
          "Nothing is stored until the virus check passes. The changes against the approved version are listed.",
          "The new version goes for review like any upload; the room keeps the approved one until then.",
        ],
      },
      {
        id: "rooms",
        title: "Room PCs",
        who: "Room technician, Speaker Ready Room technician or above",
        steps: [
          "Room PCs are loaded by hand: after a talk is approved, download it from Room sync, copy it onto that room's PC, and tick Mark loaded.",
          "If a newer version is approved later, load it and tick it again — the old copy is replaced.",
          "A room is Ready when every talk in it is ticked loaded. Nothing on Room sync is checked automatically.",
          "Ticked one by mistake? Press Undo beside it; the talk shows as not loaded until it is ticked again.",
        ],
        tip: "Launch in Room Agent records that a talk was presented. Opening PowerPoint on the room PC isn't connected yet.",
      },
    ],
  },
  {
    title: "After the event",
    guides: [
      {
        id: "archive",
        title: "Build and deliver the client archive",
        who: "Project manager or above",
        steps: [
          "Archive builder lists what goes in: each talk's approved final version, and anything left out with why (each links to where it is fixed).",
          "Choose the options (PDF copies, earlier versions, emails), then Build package.",
          "Deliver to client portal. The client downloads it from their portal until the link expires, 30 days after the event ends.",
          "Rebuilding makes a new package — deliver it again to update the client's download.",
        ],
      },
    ],
  },
  {
    title: "Your account",
    guides: [
      {
        id: "sign-in",
        title: "Signing in, sign-in app and backup codes",
        who: "Everyone",
        steps: [
          "Sign in with your work email and password, then the 6-digit code from the sign-in app on your phone.",
          "When you set up the sign-in app you get backup codes. Copy, download or print them and keep them somewhere safe — each works once, in place of the code.",
          "Lost your phone? Use a backup code, or ask a DXG administrator to reset your sign-in app.",
          "Forgotten your password? Use the link on the sign-in page.",
        ],
      },
    ],
  },
];

/** Which guide a screen's Help button opens. */
export function guideForPath(pathname: string): string | null {
  const map: [RegExp, string][] = [
    [/^\/events\/new/, "create-event"],
    [/^\/events\/[^/]+\/import/, "create-event"],
    [/^\/events\/[^/]+\/speakers/, "invite-speakers"],
    [/^\/events\/[^/]+\/comms/, "emails"],
    [/^\/events\/[^/]+\/review/, "review"],
    [/^\/events\/[^/]+\/talks\/[^/]+\/inspection/, "file-problems"],
    [/^\/events\/[^/]+\/talks\//, "go-back"],
    [/^\/events\/[^/]+\/srr\/[^/]+/, "usb"],
    [/^\/events\/[^/]+\/srr/, "srr"],
    [/^\/events\/[^/]+\/(sync|agent)/, "rooms"],
    [/^\/events\/[^/]+\/archive/, "archive"],
    [/^\/admin\//, "staff"],
    [/^\/account\//, "sign-in"],
  ];
  return map.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

type Term = { term: string; group: string; meaning: string; next?: string };

const fromWords = (group: string, map: Readonly<Record<string, Words>>): Term[] => {
  const seen = new Set<string>();
  return Object.values(map).flatMap((words) => {
    if (seen.has(words.label)) return [];
    seen.add(words.label);
    return [{ term: words.label, group, meaning: words.meaning, ...(words.next ? { next: words.next } : {}) }];
  });
};

const GLOSSARY: Term[] = [
  ...fromWords("Presentation status", TALK_STATUS),
  ...fromWords("File version", VERSION_STATE),
  ...fromWords("Check", CHECK),
  ...fromWords("Problem", SEVERITY),
  ...fromWords("Room PC copy", ROOM_COPY),
  ...fromWords("Email", EMAIL_STATUS),
  ...fromWords("Client archive", ARCHIVE_STATE),
  ...fromWords("Role", ROLE),
  { term: "Speaker Ready Room", group: "Place", meaning: "The room onsite where speakers check in, review their slides and sign off." },
  { term: "Room PC", group: "Place", meaning: "The presentation computer in each session room. DXG staff copy approved files onto it and tick them on Room sync." },
  { term: "Mark loaded", group: "Room PC copy", meaning: "The tick on Room sync that says an approved file has been copied onto its room's PC." },
  { term: "Sign-off", group: "Onsite", meaning: "The speaker confirming, in the Speaker Ready Room, which version they will present." },
  { term: "Waive", group: "Check", meaning: "Accept a check's problem for this talk, with a written reason. Recorded for good." },
  { term: "Release permission", group: "Client archive", meaning: "What the client's archive may include from a speaker: full, PDF only, or nothing." },
].sort((a, b) => a.term.localeCompare(b.term));

export function HelpView() {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const sections = useMemo(
    () =>
      GUIDES.map((section) => ({
        ...section,
        guides: section.guides.filter(
          (guide) =>
            !needle || [guide.title, guide.who, ...guide.steps, guide.tip ?? ""].join(" ").toLowerCase().includes(needle),
        ),
      })).filter((section) => section.guides.length > 0),
    [needle],
  );
  const terms = useMemo(
    () =>
      GLOSSARY.filter(
        (entry) => !needle || [entry.term, entry.group, entry.meaning, entry.next ?? ""].join(" ").toLowerCase().includes(needle),
      ),
    [needle],
  );

  return (
    <>
      <h1 className="htitle">Help</h1>
      <p className="note" style={{ marginTop: 0 }}>
        How to do each job, step by step, and what every word on the screens means. The Help button at the top of any
        screen opens the guide for that screen.
      </p>
      <input
        type="search"
        placeholder="Search help — e.g. bounced, USB, archive, sign-in app"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search help"
        style={{ width: "100%", maxWidth: 520, margin: "8px 0 16px" }}
      />

      <div className="card">
        <div className="chd">
          <h3>The three confirmations</h3>
        </div>
        <div className="cbd" style={{ padding: "10px 14px", fontSize: 13.5, lineHeight: 1.55 }}>
          A presentation is ready when three separate things have happened, and each screen shows them in this order:
          <ol style={{ margin: "6px 0 0", paddingLeft: 20 }}>
            <li>
              <b>Approved by a reviewer</b> — in Review presentations. This is what puts the file on its room&rsquo;s list.
            </li>
            <li>
              <b>Signed off by the speaker</b> — in the Speaker Ready Room, onsite. The speaker confirms the version they
              will present.
            </li>
            <li>
              <b>Loaded on the room PC</b> — someone copied the approved file onto the room&rsquo;s PC and ticked it on
              Room sync.
            </li>
          </ol>
          They don't depend on each other: every approved version is loaded onto the room PC whether or not the speaker
          has signed off, and a newer approval means the speaker should sign off again (and the new version must be
          loaded).
        </div>
      </div>

      {sections.map((section) => (
        <div key={section.title} className="card">
          <div className="chd">
            <h3>{section.title}</h3>
          </div>
          <div className="cbd" style={{ padding: "4px 14px 10px" }}>
            {section.guides.map((guide) => (
              <section key={guide.id} id={guide.id} className="help-guide">
                <h4 style={{ margin: "12px 0 2px" }}>{guide.title}</h4>
                <div className="note">{guide.who}</div>
                <ol style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 13.5, lineHeight: 1.55 }}>
                  {guide.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                {guide.tip && (
                  <p className="note" style={{ margin: "6px 0 0" }}>
                    Tip: {guide.tip}
                  </p>
                )}
              </section>
            ))}
          </div>
        </div>
      ))}

      <div className="card" id="glossary">
        <div className="chd">
          <h3>Glossary · {terms.length}</h3>
        </div>
        <div className="cbd" style={{ padding: 0 }}>
          {terms.length === 0 ? (
            <div className="empty">Nothing matches “{query}”.</div>
          ) : (
            <table>
              <tbody>
                {terms.map((entry) => (
                  <tr key={`${entry.group}:${entry.term}`}>
                    <td style={{ width: 220, verticalAlign: "top" }}>
                      <b>{entry.term}</b>
                      <div className="note">{entry.group}</div>
                    </td>
                    <td style={{ fontSize: 13.5 }}>
                      {entry.meaning}
                      {entry.next && <div className="note">What to do: {entry.next}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p className="note">
        Still stuck? Ask your DXG administrator. Back to the <Link href="/">portfolio</Link>.
      </p>
    </>
  );
}
