"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { portalAssetUrl, portalDownloadUrl, presenterLogout } from "@/lib/api";
import type { CompleteResult, PortalSession, PortalTalk, PortalVersion } from "@/lib/api";
import { UploadPanel } from "./UploadPanel";
import { remember, REMEMBERED } from "./PresenterLogin";
import { formatBytes, formatDeadline, SPEAKER_TALK_STATUS } from "@pmp/format";


export function PortalView({
  session,
  talks,
}: {
  session: PortalSession;
  talks: PortalTalk[];
}) {
  const router = useRouter();
  const reload = useCallback(async () => {
    router.refresh();
  }, [router]);
  // A32 (D-113): lets the sign-in form name the event if this tab's sign-in ends.
  useEffect(() => remember(REMEMBERED.event, session.event.name), [session.event.name]);

  return (
    <>
      {/* The event's header banner, when the team has uploaded one (D-093). */}
      {session.event.header && (
        <img
          src={portalAssetUrl("header", session.event.header.uploaded_at)}
          alt={`${session.event.name} header`}
          style={{
            display: "block",
            width: "100%",
            aspectRatio: "4 / 1",
            objectFit: "cover",
            borderRadius: 14,
            marginBottom: 20,
            background: "var(--line)",
          }}
        />
      )}
      <div
        className="animate-rise"
        style={{
          marginBottom: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* The event's accent (D-092): a short bar above its name, as on the room screens. */}
          {session.event.accent && (
            <span
              aria-hidden="true"
              style={{ width: 44, height: 5, borderRadius: 3, background: session.event.accent }}
            />
          )}
          <h1 className="htitle" style={{ marginBottom: 0 }}>
            {session.event.name}
          </h1>
          <span className="note">
            Speaker Upload · {session.speaker.name}
          </span>
          {/* D-141: the same link keeps working through the event, so speakers can come back on the day. */}
          <span className="note" style={{ maxWidth: "60ch" }}>
            Come back with the same link any time, up to and on the day of your presentation, to see your files,
            replace one with a new version, or download your presentation once it&rsquo;s approved.
          </span>
        </div>
        <button
          className="btn"
          onClick={() => {
            void presenterLogout()
              .catch(() => undefined)
              .then(() => {
                // Signing out forgets what this tab remembered for the sign-in form (A32, D-113).
                for (const key of Object.values(REMEMBERED)) remember(key, null);
                router.replace("/login?reason=signed_out");
                router.refresh();
              });
          }}
        >
          Sign out
        </button>
      </div>

      {/* The event's slide template, to build the deck on (D-093). */}
      {session.event.template && (
        <div className="card">
          <div className="cbd" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <b>Slide template</b>
              <div className="note" style={{ overflowWrap: "anywhere" }}>
                Build your presentation on the event&rsquo;s template · {session.event.template.file_name} ·{" "}
                {formatBytes(session.event.template.size_bytes)}
              </div>
            </div>
            <a className="btn pri" href={portalAssetUrl("template", session.event.template.uploaded_at)}>
              Download template
            </a>
          </div>
        </div>
      )}

      {talks.length === 0 && (
        <div className="card">
          <div className="empty">
            No talks are assigned to you yet. The organisers will be in touch.
          </div>
        </div>
      )}

      {talks.map((talk) => (
        <TalkCard
          key={talk.slot_id}
          talk={talk}
          eventName={session.event.name}
          timezone={session.event.timezone}
          deadline={session.event.upload_deadline}
          onChange={reload}
        />
      ))}
    </>
  );
}

/**
 * What a speaker is told about their talk (D-108): the words come from the shared
 * vocabulary (D-110), so the portal, emails and staff screens cannot drift apart. The
 * staff labels ("Update pending ack", "Synchronized onsite") describe DXG's room
 * delivery, which is none of the speaker's concern. Only the chip colour is chosen here.
 */
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

/**
 * The road from "nothing yet" to "ready in your room", as four steps (Preseria's
 * presenter dashboard shows the same journey). The chip says where a talk is; the
 * steps say where that is *on the way*, which is what a speaker reading "Received — in
 * review" actually wants to know: what has happened, what is happening, what is left.
 *
 * Driven by the same `status` as the chip, so the two cannot disagree. A cancelled or
 * finished talk has no journey left and shows none.
 */
type StepState = "done" | "now" | "todo" | "warn";
type Step = { label: string; state: StepState; note?: string };

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
      // The talk's status says "approved"; the room copy (D-140) knows whether the room
      // PC already has it. Once it does, the last step is done whatever the status says.
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
        <li
          key={item.label}
          className={`journey-step ${item.state}`}
          aria-current={index === at ? "step" : undefined}
        >
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

/**
 * The event's upload deadline as a speaker should read it (D-071) — worded by the same
 * `formatDeadline` the emails use, so the portal and the reminder cannot disagree.
 */
function deadlineText(deadline: string, timeZone: string): { label: string; passed: boolean } {
  const todayThere = new Date().toLocaleDateString("en-CA", { timeZone });
  return { label: formatDeadline(deadline, timeZone), passed: todayThere > deadline };
}

function TalkCard({
  talk,
  eventName,
  timezone,
  deadline,
  onChange,
}: {
  talk: PortalTalk;
  eventName: string;
  timezone: string;
  deadline: string | null;
  onChange: () => Promise<void>;
}) {
  const [result, setResult] = useState<CompleteResult | null>(null);
  const [replacing, setReplacing] = useState(false);
  const latest = talk.versions[0];
  const words = SPEAKER_TALK_STATUS[talk.status];
  const status = {
    label: words?.label ?? talk.status_label,
    tone: STATUS_TONE[talk.status] ?? "c-info",
    next: words ? [words.meaning, words.next].filter(Boolean).join(" ") : "",
  };
  const approved = APPROVED.includes(talk.status);
  // The upload box opens by itself for a first file or one the team has asked for; otherwise a
  // speaker can still send an updated deck until the talk is signed off onsite (D-108).
  const needsUpload =
    !latest ||
    latest.state === "quarantined" ||
    talk.status === "needs_revision" ||
    talk.status === "attention";
  const showUpload = needsUpload || replacing;
  // Preseria's card (D-140): date and time with the zone, location, duration, files uploaded.
  const when = new Date(talk.starts_at).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  });
  const minutes = talk.ends_at ? Math.round((Date.parse(talk.ends_at) - Date.parse(talk.starts_at)) / 60_000) : 0;
  const uploaded = talk.versions.filter((version) => version.state !== "quarantined").length;
  // The approved version, the newest upload still with the team, and everything older (D-144).
  const approvedVersion = talk.versions.find((version) => version.state === "stored" && version.review_state === "approved");
  const pending =
    latest && latest !== approvedVersion && (!approvedVersion || latest.version_number > approvedVersion.version_number)
      ? latest
      : undefined;
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
        {status.next && !talk.final_locked && (
          <div style={{ marginBottom: 12, fontSize: 14 }}>{status.next}</div>
        )}

        <dl className="talk-facts">
          <div>
            <dt>Date &amp; time</dt>
            <dd>{when}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>
              {talk.room ?? "Room to be confirmed"} – {eventName}
            </dd>
          </div>
          {minutes > 0 && (
            <div>
              <dt>Duration</dt>
              <dd>{minutes} min</dd>
            </div>
          )}
          <div>
            <dt>Files uploaded</dt>
            <dd>{uploaded}</dd>
          </div>
        </dl>

        {/* A35 (D-113): once the talk is approved the deadline no longer applies, so it goes. */}
        {!approved && (
          <div className="deadline-line">
            <span className="kl" style={{ margin: 0 }}>Upload deadline</span>{" "}
            {deadline ? (
              (() => {
                const { label, passed } = deadlineText(deadline, timezone);
                return (
                  <>
                    <b>{label}</b>
                    {passed && (
                      <div className="note">The deadline has passed — you can still upload; the team will review it.</div>
                    )}
                  </>
                );
              })()
            ) : (
              <span className="note">None set — upload as soon as you can.</span>
            )}
          </div>
        )}

        {/*
          The files, in the order a speaker cares about them (D-144): the approved one —
          the only one that can be downloaded, and what the room will show — first and
          set apart; a newer upload still with the team under it; everything older folded
          away. The team's notes sit under the upload they are about, so a request that was
          dealt with two versions ago no longer reads like an open one.
        */}
        {talk.versions.length > 0 && <h3 className="files-head">Your presentation</h3>}

        {approvedVersion && (
          <div className="file-block">
            <ApprovedFile
              version={approvedVersion}
              timezone={timezone}
              room={talk.room}
              loaded={Boolean(talk.room_copy?.loaded)}
            />
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
            <summary>
              Earlier uploads ({earlier.length})
            </summary>
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

        {talk.final_locked ? (
          <div className="lane cli" style={{ marginTop: 12 }}>
            <b>Locked as the final onsite version.</b> Your presentation was confirmed in the Speaker
            Ready Room, so it can no longer be replaced here. Please speak to the team onsite.
          </div>
        ) : showUpload ? (
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
                <b>This file couldn't be accepted.</b> Our security check stopped it, so it was not
                stored. Please check the file (for example, save a fresh copy) and upload it again. If
                it keeps happening, contact the DXG team.
              </div>
            ) : result.findings.some((finding) => finding.severity === "blocking") ? (
              <div className="err">
                <b>We received your file, but it has a problem that needs fixing.</b> See below, then
                upload a corrected version.
              </div>
            ) : (
              <div className="lane cli">
                {/* A34 (D-113): a clean upload ends on a clear thank-you and what happens next. */}
                <b>Thanks — we&rsquo;ve received your presentation.</b> The DXG team will review it.
                We&rsquo;ll email you if anything needs to change.
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

/** A speaker's word for where one of their uploads stands (D-140). */
function versionWords(version: PortalVersion): { label: string; tone: string } {
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

function FileRow({ version, timezone, compact = false }: { version: PortalVersion; timezone: string; compact?: boolean }) {
  const words = versionWords(version);
  return (
    <div className={`my-file${compact ? " compact" : ""}`}>
      <div className="my-file-name">
        <b className="mono">{version.file_name}</b>
        <span className="note">
          Version {version.version_number} · {formatBytes(Number(version.size_bytes))} · uploaded{" "}
          {uploadedAt(version.created_at, timezone)}
        </span>
      </div>
      <span className={`chip ${words.tone}`}>{words.label}</span>
    </div>
  );
}

const uploadedAt = (at: string, timezone: string) =>
  new Date(at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone });

/**
 * The approved version, set apart (D-144): the one the room will show and the only one
 * a speaker can download. What the room box used to say on its own is said here, beside
 * the file it is about, so the card says it once.
 */
function ApprovedFile({
  version,
  timezone,
  room,
  loaded,
}: {
  version: PortalVersion;
  timezone: string;
  room: string | null;
  loaded: boolean;
}) {
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
            Version {version.version_number} · {formatBytes(Number(version.size_bytes))} · uploaded{" "}
            {uploadedAt(version.created_at, timezone)}
          </span>
        </div>
        <a className="btn pri" href={portalDownloadUrl(version.id)} download>
          Download
        </a>
      </div>
    </div>
  );
}

/** The team's notes on one upload, under it. `urgent` when they are what the speaker has to act on now. */
function FileNotes({
  notes,
  timezone,
  urgent = false,
}: {
  notes: PortalTalk["feedback"];
  timezone: string;
  urgent?: boolean;
}) {
  if (notes.length === 0) return null;
  return (
    <div className={`file-notes${urgent ? " urgent" : ""}`}>
      <div className="file-notes-head">{urgent ? "What the DXG team asked you to change" : "Note from the DXG team"}</div>
      {notes.map((note, index) => (
        <div key={`${note.created_at}-${index}`} className="file-note">
          <span className="note">
            {new Date(note.created_at).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZone: timezone,
            })}
          </span>
          <div style={{ whiteSpace: "pre-wrap" }}>{note.body}</div>
        </div>
      ))}
    </div>
  );
}

/** What a file has to be, open while uploading and a click away otherwise. */
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

/** A check's name as a speaker would say it (D-108). */
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
