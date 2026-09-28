"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { portalAssetUrl, presenterLogout } from "@/lib/api";
import type { CompleteResult, PortalSession, PortalTalk } from "@/lib/api";
import { UploadPanel } from "./UploadPanel";
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
        </div>
        <button
          className="btn"
          onClick={() => {
            void presenterLogout()
              .catch(() => undefined)
              .then(() => {
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
 * The event's upload deadline as a speaker should read it (D-071) — worded by the same
 * `formatDeadline` the emails use, so the portal and the reminder cannot disagree.
 */
function deadlineText(deadline: string, timeZone: string): { label: string; passed: boolean } {
  const todayThere = new Date().toLocaleDateString("en-CA", { timeZone });
  return { label: formatDeadline(deadline, timeZone), passed: todayThere > deadline };
}

function TalkCard({
  talk,
  timezone,
  deadline,
  onChange,
}: {
  talk: PortalTalk;
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
  const when = new Date(talk.starts_at).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  });

  return (
    <div className="card">
      <div className="chd">
        <h3>{talk.title}</h3>
        <span className={`chip ${status.tone}`}>{status.label}</span>
      </div>
      <div className="cbd">
        <div className="note" style={{ marginBottom: 4 }}>
          {talk.room} · {when}
        </div>
        {status.next && !talk.final_locked && (
          <div style={{ marginBottom: 12, fontSize: 14 }}>{status.next}</div>
        )}

        <div className="grid2" style={{ marginBottom: 12 }}>
          <div>
            <div className="kl">Upload deadline</div>
            {approved ? (
              <span className="note">Done — your presentation is approved.</span>
            ) : deadline ? (
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
              <span className="note">No deadline set — upload as soon as you can.</span>
            )}
          </div>
          <div>
            <div className="kl">Requirements</div>
            <div className="note">
              · 16:9 widescreen · PowerPoint (.pptx) preferred, PDF accepted
              <br />· Embed all fonts and videos (H.264 .mp4)
              <br />· Up to 10 GB — uploads resume if your connection drops
            </div>
          </div>
        </div>

        <h3 style={{ fontSize: 13, marginBottom: 8 }}>Your presentation</h3>

        {/*
          Once a file is in, the card shows that file — its name and size — and no upload
          box. A new file is taken only when the team asks for one (a requested revision or
          a problem found) or when the last one failed the virus check.
        */}
        {latest && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "center",
              border: "1px solid var(--line)",
              borderRadius: 10,
              padding: "12px 14px",
              marginBottom: showUpload ? 12 : 0,
            }}
          >
            <span className="mono" style={{ overflowWrap: "anywhere" }}>
              {latest.file_name}
            </span>
            <span className="mono num" style={{ whiteSpace: "nowrap" }}>
              {formatBytes(Number(latest.size_bytes))}
            </span>
          </div>
        )}

        {talk.final_locked ? (
          <div className="lane cli" style={{ marginTop: 10 }}>
            <b>Locked as the final onsite version.</b> Your presentation was confirmed in the Speaker
            Ready Room, so it can no longer be replaced here. Please speak to the team onsite.
          </div>
        ) : showUpload ? (
          <>
            {replacing && !needsUpload && (
              <div className="note" style={{ marginBottom: 8 }}>
                Your new version goes to the DXG team for review.
                {approved && " Your approved version stays in use until the new one is approved."}
              </div>
            )}
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
          </>
        ) : (
          latest && (
            <div style={{ marginTop: 10 }}>
              <span className="note">Need to change your slides? </span>
              <button className="btn" onClick={() => setReplacing(true)}>
                Upload a new version
              </button>
            </div>
          )
        )}

        {/* Notes the team wrote to the speaker (D-070) — only the speaker lane, never internal notes. */}
        {talk.feedback.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 13, marginBottom: 8 }}>Feedback from the DXG team</h3>
            {talk.feedback.map((note, index) => (
              <div className="lane cli" key={`${note.created_at}-${index}`} style={{ whiteSpace: "pre-wrap" }}>
                <span className="note">
                  About upload {note.version_number} ·{" "}
                  {new Date(note.created_at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: timezone,
                  })}
                </span>
                <br />
                {note.body}
              </div>
            ))}
          </div>
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
                <b>Thanks — we&rsquo;ve received your presentation.</b> The DXG team will review it and
                let you know if anything needs to change.
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
