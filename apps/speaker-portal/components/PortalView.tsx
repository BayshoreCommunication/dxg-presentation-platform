"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { portalAssetUrl, presenterLogout } from "@/lib/api";
import type { CompleteResult, PortalSession, PortalTalk } from "@/lib/api";
import { UploadPanel } from "./UploadPanel";
import { formatBytes, formatDeadline } from "@pmp/format";


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
  const latest = talk.versions[0];
  // The upload box is for a first file, or a new one the team has asked for.
  const needsUpload =
    !latest ||
    latest.state === "quarantined" ||
    talk.status === "needs_revision" ||
    talk.status === "attention";
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
        <span className={`chip ${talk.status === "approved" || talk.status === "synchronized_onsite" ? "c-ok" : talk.status === "needs_revision" || talk.status === "attention" ? "c-warn" : talk.status === "missing" ? "c-bad" : "c-info"}`}>
          {talk.status_label}
        </span>
      </div>
      <div className="cbd">
        <div className="note" style={{ marginBottom: 10 }}>
          {talk.room} · {when}
        </div>

        <div className="grid2" style={{ marginBottom: 12 }}>
          <div>
            <div className="kl">Upload deadline</div>
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
          a problem found) or when the last one was quarantined.
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
              marginBottom: needsUpload ? 12 : 0,
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
        ) : (
          needsUpload && (
            <UploadPanel
              slotId={talk.slot_id}
              onComplete={async (completed) => {
                setResult(completed);
                await onChange();
              }}
            />
          )
        )}

        {/* Notes the team wrote to the speaker (D-070) — only the speaker lane, never internal notes. */}
        {talk.feedback.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 13, marginBottom: 8 }}>Feedback from the DXG team</h3>
            {talk.feedback.map((note, index) => (
              <div className="lane cli" key={`${note.created_at}-${index}`} style={{ whiteSpace: "pre-wrap" }}>
                <span className="note">
                  On v{note.version_number} ·{" "}
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
            {result.processing_state === "quarantined" && (
              <div className="err">
                <b>This file could not be accepted.</b> Our security scan flagged it, so it has been
                quarantined and your previous version is untouched. Please check the file and upload
                again.
              </div>
            )}
            {result.findings
              .filter((finding) => finding.severity !== "info")
              .map((finding, index) => (
                <div className="lane cli" key={index}>
                  <b>
                    {finding.severity === "blocking" ? "⛔" : "⚠"} {finding.check_code.replace("_", " ")}
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

function describe(finding: { check_code: string; detail: Record<string, unknown> }): string {
  const detail = finding.detail;
  switch (finding.check_code) {
    case "aspect":
      return `Slide size is ${String(detail.aspect)} and the room is set up for ${String(detail.room_profile)}.`;
    case "codec":
      return `${String(detail.file)} is a QuickTime container — the room playback profile guarantees ${String(detail.expected)}. Re-export as H.264 .mp4 to be safe.`;
    case "linked_media":
      return `${String(detail.count)} linked (not embedded) media reference(s) — the files will not travel with your deck.`;
    case "macros":
      return "The file contains macros, which are blocked for security. Please save it without macros.";
    case "malware":
      return `Security signature: ${String(detail.signature)}.`;
    case "corruption":
      return String(detail.reason ?? "The file could not be opened.");
    case "metadata":
      if (detail.slides !== undefined) return `${String(detail.slides)} slides.`;
      if (detail.embedded_media !== undefined) return `${String(detail.embedded_media)} embedded media file(s).`;
      return `${formatBytes(detail.bytes as number)} — within the 10 GB limit.`;
    default:
      return JSON.stringify(detail);
  }
}
