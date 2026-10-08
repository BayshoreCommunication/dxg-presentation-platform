"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { downloadUrl } from "@/lib/api";
import type { MyEvent, PortalTalk as MyTalk, PortalVersion as MyVersion, CompleteResult as UploadResult } from "@/lib/api";
import { UploadPanel } from "./UploadPanel";
import { formatBytes, formatDateRange, formatDeadline, humanize, SPEAKER_TALK_STATUS } from "@pmp/format";

/** How an event's stored status reads to a speaker; an active one follows its dates (D-108). */
function eventWords(event: { status: string; starts_on: string; ends_on: string; timezone: string }): { tone: string; label: string } {
  if (event.status === "active") {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: event.timezone });
    if (today < event.starts_on) return { tone: "c-info", label: "Upcoming" };
    if (today > event.ends_on) return { tone: "", label: "Event over" };
    return { tone: "c-ok", label: "Onsite now" };
  }
  if (event.status === "archived") return { tone: "", label: "Archived" };
  return { tone: "", label: humanize(event.status) };
}

/**
 * Manage presentations (D-146, D-148): every presentation the speaker gives, grouped by
 * event, newest event first — the presenter card with the four-step journey, the talk at a
 * glance, the approved file set apart with the only Download button, a newer upload under
 * it, older ones folded away, and the team's notes beside the upload they are about.
 */
export function Presentations({ speaker, events }: { speaker: { name: string; email: string }; events: MyEvent[] }) {
  const router = useRouter();
  const reload = useCallback(async () => {
    router.refresh();
  }, [router]);

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <h1 className="htitle" style={{ margin: 0 }}>
            Manage presentations
          </h1>
          <p className="note" style={{ margin: "4px 0 0", maxWidth: "62ch" }}>
            {speaker.name} · {speaker.email}. Upload a presentation, replace it with a new version until it is confirmed
            onsite, and download it once the DXG team has approved it.
          </p>
        </div>
      </div>

      {events.length === 0 && (
        <div className="card">
          <div className="empty">
            No presentations are assigned to this address yet. The organisers add you to an event&rsquo;s agenda with the
            email you sign in with — once they have, it appears here.
          </div>
        </div>
      )}

      {events.map((event) => {
        const words = eventWords(event);
        return (
          <section key={event.id} style={{ marginBottom: 22 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", margin: "0 0 10px" }}>
              <h2 className="htitle" style={{ margin: 0, fontSize: 18 }}>
                {event.name}
              </h2>
              <span className="note">{formatDateRange(event.starts_on, event.ends_on)}</span>
              <span className={`chip ${words.tone}`}>{words.label}</span>
            </div>
            {event.status === "archived" && (
              <p className="note" style={{ margin: "0 0 10px" }}>
                This event is archived, so its files are read-only.
              </p>
            )}
            {event.talks.length === 0 ? (
              <div className="card">
                <div className="empty">No talks are assigned to you on this event yet.</div>
              </div>
            ) : (
              event.talks.map((talk) => (
                <TalkCard
                  key={talk.slot_id}
                  talk={talk}
                  eventName={event.name}
                  timezone={event.timezone}
                  deadline={event.upload_deadline}
                  readOnly={event.status === "archived"}
                  onChange={reload}
                />
              ))
            )}
          </section>
        );
      })}
    </>
  );
}

/** The chip's colour for where a talk stands; the words come from the shared vocabulary (D-110). */
const STATUS_TONE: Record<string, string> = {
  missing: "c-bad",
  needs_revision: "c-warn",
  attention: "c-warn",
  approved: "c-ok",
  approved_delivering: "c-ok",
  update_pending_ack: "c-ok",
  synchronized_onsite: "c-ok",
};
const APPROVED = ["approved", "approved_delivering", "update_pending_ack", "synchronized_onsite"];

type StepState = "done" | "now" | "todo" | "warn";
type Step = { label: string; state: StepState; note?: string };

/** The road from "nothing yet" to "ready in your room", as four steps (D-140). */
function journeyFor(status: string, loaded: boolean): Step[] | null {
  const step = (label: string, state: StepState, note?: string): Step => ({ label, state, ...(note ? { note } : {}) });
  switch (status) {
    case "missing":
      return [step("Upload", "now", "Send your slides below"), step("Checks", "todo"), step("Review", "todo"), step("Ready in your room", "todo")];
    case "processing":
      return [step("Upload", "done"), step("Checks", "now", "Usually a minute"), step("Review", "todo"), step("Ready in your room", "todo")];
    case "attention":
      return [step("Upload", "done"), step("Checks", "warn", "Please upload again"), step("Review", "todo"), step("Ready in your room", "todo")];
    case "submitted":
      return [step("Upload", "done"), step("Checks", "done"), step("Review", "now", "The DXG team has it"), step("Ready in your room", "todo")];
    case "needs_revision":
      return [step("Upload", "done"), step("Checks", "done"), step("Review", "warn", "Changes needed — see below"), step("Ready in your room", "todo")];
    case "approved":
    case "approved_delivering":
    case "update_pending_ack":
      return loaded
        ? [step("Upload", "done"), step("Checks", "done"), step("Review", "done"), step("Ready in your room", "done", "Loaded on the room PC")]
        : [step("Upload", "done"), step("Checks", "done"), step("Review", "done"), step("Ready in your room", "now", "Being loaded before your session")];
    case "synchronized_onsite":
      return [step("Upload", "done"), step("Checks", "done"), step("Review", "done"), step("Ready in your room", "done", "Loaded on the room PC")];
    default:
      return null;
  }
}

function Journey({ status, loaded }: { status: string; loaded: boolean }) {
  const steps = journeyFor(status, loaded);
  if (!steps) return null;
  const at = steps.findIndex((item) => item.state !== "done");
  return (
    <ol className="journey" aria-label="Where your presentation is">
      {steps.map((item, index) => (
        <li key={item.label} className={`journey-step ${item.state}`} aria-current={index === at ? "step" : undefined}>
          <span className="journey-mark" aria-hidden="true">
            {item.state === "done" ? "✓" : item.state === "warn" ? "!" : index + 1}
          </span>
          <span className="journey-text">
            <span className="journey-label">{item.label}</span>
            {item.note && <span className="journey-note">{item.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function deadlineText(deadline: string, timeZone: string): { label: string; passed: boolean } {
  const todayThere = new Date().toLocaleDateString("en-CA", { timeZone });
  return { label: formatDeadline(deadline, timeZone), passed: todayThere > deadline };
}

function TalkCard({
  talk,
  eventName,
  timezone,
  deadline,
  readOnly,
  onChange,
}: {
  talk: MyTalk;
  eventName: string;
  timezone: string;
  deadline: string | null;
  readOnly: boolean;
  onChange: () => Promise<void>;
}) {
  const [result, setResult] = useState<UploadResult | null>(null);
  const [replacing, setReplacing] = useState(false);
  const latest = talk.versions[0];
  const words = SPEAKER_TALK_STATUS[talk.status];
  const status = {
    label: words?.label ?? talk.status_label,
    tone: STATUS_TONE[talk.status] ?? "c-info",
    next: words ? [words.meaning, words.next].filter(Boolean).join(" ") : "",
  };
  const approved = APPROVED.includes(talk.status);
  const needsUpload = !latest || latest.state === "quarantined" || talk.status === "needs_revision" || talk.status === "attention";
  const canUpload = !talk.final_locked && !readOnly;
  const showUpload = canUpload && (needsUpload || replacing);
  const start = new Date(talk.starts_at);
  const end = talk.ends_at ? new Date(talk.ends_at) : null;
  const dayText = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: timezone });
  const zoneText = zoneLabel(start, timezone);
  const minutes = end ? Math.round((end.getTime() - start.getTime()) / 60_000) : 0;
  const approvedVersion = talk.versions.find((version) => version.state === "stored" && version.review_state === "approved");
  const pending =
    latest && latest !== approvedVersion && (!approvedVersion || latest.version_number > approvedVersion.version_number) ? latest : undefined;
  const earlier = talk.versions.filter((version) => version !== approvedVersion && version !== pending);
  const uploadBlocked = latest?.state === "quarantined";
  const notesFor = (versionNumber: number) => talk.feedback.filter((note) => note.version_number === versionNumber);

  return (
    <div className="card">
      <div className="chd">
        <h3>{talk.title}</h3>
        <span className={`chip ${status.tone}`}>{status.label}</span>
      </div>
      <div className="cbd">
        {!talk.final_locked && <Journey status={talk.status} loaded={Boolean(talk.room_copy?.loaded)} />}
        {status.next && !talk.final_locked && <div style={{ marginBottom: 12, fontSize: 14 }}>{status.next}</div>}

        <ul className="talk-info">
          <li>
            <InfoIcon name="clock" />
            <span>
              When:{" "}
              <b>
                {dayText} · <span className="nowrap">{timeRange(start, end && minutes > 0 ? end : null, timezone)}</span>
              </b>{" "}
              <span className="tz">({zoneText})</span>
              {minutes > 0 && <span className="tz"> · {minutes} min</span>}
            </span>
          </li>
          <li>
            <InfoIcon name="pin" />
            <span>
              Where: <b>{talk.room ?? "Room to be confirmed"}</b>
            </span>
          </li>
          <li>
            <InfoIcon name="calendar" />
            <span>
              During:{" "}
              {talk.session_title && talk.session_title !== talk.title ? (
                <>
                  <b>{talk.session_title}</b> – {eventName}
                </>
              ) : (
                <b>{eventName}</b>
              )}
            </span>
          </li>
          {talk.final_locked ? (
            <li>
              <InfoIcon name="lock" />
              <span>
                <b>FINAL:</b> Your presentation was confirmed in the Speaker Ready Room.
                <br />
                It is now final — you can&rsquo;t upload new files or make changes here. Please speak to the team onsite.
              </span>
            </li>
          ) : (
            !approved && (
              <li>
                <InfoIcon name="deadline" />
                <span>
                  <b>DEADLINE:</b>{" "}
                  {deadline ? (
                    (() => {
                      const { label, passed } = deadlineText(deadline, timezone);
                      return passed ? (
                        <>
                          The deadline for uploading was {label}.
                          <br />
                          You can still upload — the team will review it.
                        </>
                      ) : (
                        <>Please upload by {label}.</>
                      );
                    })()
                  ) : (
                    <>None set — upload as soon as you can.</>
                  )}
                </span>
              </li>
            )
          )}
        </ul>

        {talk.versions.length > 0 && <h3 className="files-head">Your presentation</h3>}

        {approvedVersion && (
          <div className="file-block">
            <ApprovedFile version={approvedVersion} timezone={timezone} room={talk.room} loaded={Boolean(talk.room_copy?.loaded)} />
            <FileNotes notes={notesFor(approvedVersion.version_number)} timezone={timezone} />
          </div>
        )}

        {pending && (
          <div className="file-block">
            <FileRow version={pending} timezone={timezone} />
            <FileNotes notes={notesFor(pending.version_number)} timezone={timezone} urgent={pending.review_state === "changes_requested"} />
          </div>
        )}

        {talk.versions.length > 0 && !approvedVersion && !uploadBlocked && (
          <div className="note" style={{ marginTop: 6 }}>
            You&rsquo;ll be able to download your presentation here once the DXG team approves it.
          </div>
        )}

        {earlier.length > 0 && (
          <details className="earlier">
            <summary>Earlier uploads ({earlier.length})</summary>
            <div className="note" style={{ margin: "6px 0 8px" }}>
              Kept for the record. Only your approved presentation can be downloaded.
            </div>
            <ul className="my-files">
              {earlier.map((version) => (
                <li key={version.id} className="file-block">
                  <FileRow version={version} timezone={timezone} compact />
                  <FileNotes notes={notesFor(version.version_number)} timezone={timezone} />
                </li>
              ))}
            </ul>
          </details>
        )}

        {!canUpload ? null : showUpload ? (
          <div className="upload-area">
            {replacing && !needsUpload && (
              <div className="note" style={{ marginBottom: 8 }}>
                Your new version goes to the DXG team for review.
                {approved && " Your approved version stays in use until the new one is approved."}
              </div>
            )}
            <Requirements open />
            <UploadPanel
              slotId={talk.slot_id}
              onComplete={async (completed) => {
                setResult(completed);
                setReplacing(false);
                await onChange();
              }}
            />
            {replacing && !needsUpload && (
              <button className="btn" style={{ marginTop: 8 }} onClick={() => setReplacing(false)}>
                Keep my current version
              </button>
            )}
          </div>
        ) : (
          latest && (
            <div className="replace-line">
              <span className="note">Need to change your slides?</span>
              <button className="btn" onClick={() => setReplacing(true)}>
                Upload a new version
              </button>
              <Requirements />
            </div>
          )
        )}

        {result && (
          <div style={{ marginTop: 12 }}>
            {result.processing_state === "quarantined" ? (
              <div className="err">
                <b>This file couldn&rsquo;t be accepted.</b> Our security check stopped it, so it was not stored. Please check the
                file (for example, save a fresh copy) and upload it again. If it keeps happening, contact the DXG team.
              </div>
            ) : result.findings.some((finding) => finding.severity === "blocking") ? (
              <div className="err">
                <b>We received your file, but it has a problem that needs fixing.</b> See below, then upload a corrected version.
              </div>
            ) : (
              <div className="lane cli">
                <b>Thanks — we&rsquo;ve received your presentation.</b> The DXG team will review it. We&rsquo;ll email you if
                anything needs to change.
              </div>
            )}
            {result.findings
              .filter((finding) => finding.severity !== "info" && finding.check_code !== "malware")
              .map((finding, index) => (
                <div className="lane cli" key={index}>
                  <b>
                    {finding.severity === "blocking" ? "⛔" : "⚠"} {checkTitle(finding.check_code)}
                  </b>
                  <br />
                  {describe(finding)}
                </div>
              ))}
            {result.findings
              .filter((finding) => finding.check_code === "metadata")
              .map((finding, index) => (
                <div className="note" key={`meta-${index}`}>
                  ℹ {describe(finding)}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function versionWords(version: MyVersion): { label: string; tone: string } {
  if (version.state === "quarantined") return { label: "Not accepted — failed the security check", tone: "c-bad" };
  if (version.state !== "stored") return { label: "Being checked", tone: "c-info" };
  switch (version.review_state) {
    case "approved":
      return { label: "Approved — the room will show this", tone: "c-ok" };
    case "changes_requested":
      return { label: "Changes requested", tone: "c-warn" };
    case "rejected":
      return { label: "Not accepted", tone: "c-bad" };
    case "superseded":
      return { label: "Earlier version", tone: "" };
    default:
      return { label: "Waiting for review", tone: "c-info" };
  }
}

function timeRange(start: Date, end: Date | null, timeZone: string): string {
  const clock = (at: Date) => at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  const from = clock(start);
  if (!end) return from;
  const to = clock(end);
  const [fromTime, fromHalf] = from.split(" ");
  const [, toHalf] = to.split(" ");
  return fromHalf === toHalf ? `${fromTime}–${to}` : `${from}–${to}`;
}

function zoneLabel(at: Date, timeZone: string): string {
  const part = (style: "short" | "longOffset") =>
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: style }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
  const short = part("short");
  const offset = part("longOffset").replace(/^GMT/, "UTC").replace("-", "−") || "UTC";
  return short && !short.startsWith("GMT") ? `${short}, ${offset}` : offset;
}

function InfoIcon({ name }: { name: "clock" | "pin" | "calendar" | "deadline" | "lock" }) {
  const paths: Record<typeof name, React.ReactNode> = {
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    pin: <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />,
    calendar: (
      <>
        <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
      </>
    ),
    deadline: (
      <>
        <path d="M9 4.5h6M12 4.5V7" />
        <circle cx="12" cy="14" r="7" />
        <path d="M12 10.5V14l2.2 1.6" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10.5" width="14" height="10" rx="2" />
        <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      </>
    ),
  };
  return (
    <svg className="info-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

const uploadedAt = (at: string, timezone: string) =>
  new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone });

function FileRow({ version, timezone, compact = false }: { version: MyVersion; timezone: string; compact?: boolean }) {
  const words = versionWords(version);
  return (
    <div className={`my-file${compact ? " compact" : ""}`}>
      <div className="my-file-name">
        <b className="mono">{version.file_name}</b>
        <span className="note">
          Version {version.version_number} · {formatBytes(Number(version.size_bytes))} · uploaded {uploadedAt(version.created_at, timezone)}
        </span>
      </div>
      <span className={`chip ${words.tone}`}>{words.label}</span>
    </div>
  );
}

function ApprovedFile({ version, timezone, room, loaded }: { version: MyVersion; timezone: string; room: string | null; loaded: boolean }) {
  return (
    <div className="file-approved">
      <div className="file-approved-head">
        <span className="chip c-ok">{loaded ? "Ready in your room" : "Approved"}</span>
        <span className="note">
          {loaded
            ? `Loaded on the presentation PC in ${room ?? "your room"} — exactly what the room will show.`
            : `This is what ${room ?? "your room"} will show. The DXG team loads it before your session.`}
        </span>
      </div>
      <div className="file-approved-body">
        <div className="my-file-name">
          <b className="mono">{version.file_name}</b>
          <span className="note">
            Version {version.version_number} · {formatBytes(Number(version.size_bytes))} · uploaded {uploadedAt(version.created_at, timezone)}
          </span>
        </div>
        <a className="btn pri" href={downloadUrl(version.id)} download>
          Download
        </a>
      </div>
    </div>
  );
}

function FileNotes({ notes, timezone, urgent = false }: { notes: MyTalk["feedback"]; timezone: string; urgent?: boolean }) {
  if (notes.length === 0) return null;
  return (
    <div className={`file-notes${urgent ? " urgent" : ""}`}>
      <div className="file-notes-head">{urgent ? "What the DXG team asked you to change" : "Note from the DXG team"}</div>
      {notes.map((note, index) => (
        <div key={`${note.created_at}-${index}`} className="file-note">
          <span className="note">
            {new Date(note.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone })}
          </span>
          <div style={{ whiteSpace: "pre-wrap" }}>{note.body}</div>
        </div>
      ))}
    </div>
  );
}

function Requirements({ open = false }: { open?: boolean }) {
  const list = (
    <ul className="req-list">
      <li>16:9 widescreen</li>
      <li>PowerPoint (.pptx) preferred, PDF accepted</li>
      <li>Embed all fonts and videos (H.264 .mp4)</li>
      <li>Up to 10 GB — uploads resume if your connection drops</li>
    </ul>
  );
  return open ? (
    <div className="req">
      <div className="kl">File requirements</div>
      {list}
    </div>
  ) : (
    <details className="req">
      <summary>File requirements</summary>
      {list}
    </details>
  );
}

function checkTitle(code: string): string {
  const titles: Record<string, string> = {
    aspect: "Slide shape",
    codec: "Video format",
    linked_media: "Videos or files not included",
    macros: "Macros",
    corruption: "File can't be opened",
    size_type: "File too large",
    fonts: "Fonts",
  };
  return titles[code] ?? "Something to check";
}

function describe(finding: { check_code: string; detail: Record<string, unknown> }): string {
  const detail = finding.detail;
  switch (finding.check_code) {
    case "aspect":
      return `Your slides are ${String(detail.aspect)}, but the room screens are ${String(detail.room_profile)}. Please change the slide size (Design → Slide Size in PowerPoint) and upload again.`;
    case "codec":
      return `The video "${String(detail.file)}" may not play in the room. Please save it as an MP4 (H.264) and embed it again.`;
    case "linked_media":
      return `${String(detail.count)} video or media file(s) are linked rather than embedded, so they won't come with your presentation. Please insert them into the slides and upload again.`;
    case "macros":
      return "The file contains macros, which can't be used in the room. Please save it as a regular .pptx (without macros).";
    case "corruption":
      return "We couldn't open this file. Please save a fresh copy of your presentation and upload that.";
    case "size_type":
      return "The file is larger than 10 GB. Please compress the videos or images and try again.";
    case "metadata":
      if (detail.slides !== undefined) return `${String(detail.slides)} slides.`;
      if (detail.embedded_media !== undefined) return `${String(detail.embedded_media)} embedded media file(s).`;
      return `${formatBytes(detail.bytes as number)}.`;
    default:
      return "The DXG team will look at this and contact you if anything needs to change.";
  }
}
