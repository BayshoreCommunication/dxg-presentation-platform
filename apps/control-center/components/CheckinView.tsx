"use client";

import { useCallback, useState } from "react";
import { Toast } from "@/components/Toast";
import { useRouter } from "next/navigation";
import type { CheckinDetail } from "@/lib/api";
import {
  getCheckin,
  ingestUsb,
  signOffCheckin,
  departCheckin,
  ApiError,
  emailCheckinReceipt,
} from "@/lib/api";
import { Chip } from "@/components/Chip";
import { ConfirmationStrip } from "@/components/ConfirmationStrip";
import { WhyNot } from "@/components/WhyNot";
import { LocalIntake } from "@/components/LocalIntake";

/**
 * Day and time on the event's clock — the actual date, not just a weekday, and never
 * the viewer's own zone. Both helpers used to assume New York for every event.
 */
const when = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });

/**
 * Screens 12 and 13 — check-in and the three-step local intake (`LocalIntake`, D-152).
 */
/** "v2 · deck.pptx · 24 slides" (R34, D-112). */
const receiptVersion = (receipt: NonNullable<CheckinDetail["receipt"]>) =>
  [
    `v${receipt.version_number}`,
    receipt.file_name,
    typeof receipt.slides === "number" ? `${receipt.slides} slide${receipt.slides === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

export function CheckinView({
  eventId,
  timezone,
  initial,
}: {
  eventId: string;
  timezone: string;
  initial: CheckinDetail;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  // Local intake opens from its own button rather than always sitting below check-in:
  // most speakers arrive with nothing new, and the three steps are noise until one does.
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const closeToast = useCallback(() => setToast(null), []);

  const refresh = useCallback(async () => {
    setDetail(await getCheckin(detail.checkin.id));
    router.refresh();
  }, [detail.checkin.id, router]);

  const run = useCallback(
    async (work: () => Promise<string>) => {
      setBusy(true);
      setError(null);
      try {
        setToast(await work());
        await refresh();
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : "Something went wrong.");
      } finally {
        setBusy(false);
        setTimeout(() => setToast(null), 5000);
      }
    },
    [refresh],
  );

  const signable = detail.latest && detail.latest.processing_state === "stored";
  const [confirmCheckout, setConfirmCheckout] = useState(false);
  const latestNumber = detail.latest?.version_number;
  const approvedNumber = detail.approved?.version_number;
  // Why the newest file can't be signed off, in words a technician can act on (D-108).
  const blockedReason = !detail.latest
    ? "The speaker hasn't uploaded a presentation yet. Bring their file in with Local intake below — from a USB drive or this computer."
    : detail.latest.processing_state === "quarantined"
      ? `v${latestNumber} failed the virus check and can't be used. Ask the speaker for a clean copy and bring it in with Local intake below.`
      : detail.latest.processing_state !== "stored"
        ? `v${latestNumber} is still being checked. This takes a moment — refresh the page shortly.`
        : null;

  // The last local import, from the check-in itself, so a refresh doesn't lose it (R37, D-112).
  const lastImportNumber =
    detail.usb?.file_version_id && detail.usb.file_version_id === detail.latest?.file_version_id
      ? latestNumber
      : undefined;
  const lastImport = detail.usb
    ? detail.usb.scan_result === "clean"
      ? `Last local import (${when(detail.usb.created_at, timezone)}) passed the virus check${
          lastImportNumber !== undefined ? ` and was saved as v${lastImportNumber}` : ""
        }.`
      : `Last local import (${when(detail.usb.created_at, timezone)}) failed the virus check and was not stored.`
    : null;

  const checkoutBlocked = detail.checkin.departed_at !== null ? "This speaker is already checked out." : null;

  const checkOut = (
    <>
      {confirmCheckout ? (
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="note">
            {detail.receipt ? "Check the speaker out?" : "Check out without a signed-off version?"}
          </span>
          <button
            className="btn"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await departCheckin(detail.checkin.id);
                router.push(`/events/${eventId}/srr`);
                return "Checked out — the station is free";
              })
            }
          >
            Yes, check out
          </button>
          <button className="btn" onClick={() => setConfirmCheckout(false)}>
            Stay
          </button>
        </span>
      ) : (
        <button
          className="btn"
          disabled={busy || checkoutBlocked !== null}
          title={checkoutBlocked ?? undefined}
          onClick={() => setConfirmCheckout(true)}
        >
          Check out
        </button>
      )}
    </>
  );

  const signOffButton = (label: string) => (
    <button
      className="btn pri"
      disabled={busy || !signable}
      onClick={() =>
        void run(async () => {
          const { receipt } = await signOffCheckin(detail.checkin.id, detail.latest!.file_version_id);
          return `Confirmed v${receipt.version_number} as the final version — the speaker can no longer replace it from the portal`;
        })
      }
    >
      {label}
    </button>
  );

  // Sign-off does not need an approval (Travis's call, 2026-09-28); say so where it matters.
  const approvalNote =
    signable && latestNumber !== approvedNumber
      ? approvedNumber
        ? `v${latestNumber} hasn't been approved by a reviewer yet. You can still confirm it as the speaker's final version; the room keeps playing v${approvedNumber} until v${latestNumber} is approved.`
        : `v${latestNumber} hasn't been approved by a reviewer yet. You can still confirm it as the speaker's final version; nothing plays in the room until it is approved.`
      : null;

  const departed = detail.checkin.departed_at !== null;
  const newerAfterReceipt = Boolean(
    detail.receipt && signable && latestNumber !== undefined && latestNumber > detail.receipt.version_number,
  );
  const earlier = !detail.receipt ? detail.standing_sign_off : null;
  const stripFacts = {
    status: detail.talk.status,
    room: detail.talk.room,
    hasSpeaker: true,
    latestVersion: latestNumber ?? null,
    approved: detail.approved
      ? { version: detail.approved.version_number, by: detail.approved.approved_by, at: detail.approved.approved_at }
      : null,
    roomStates: detail.approved?.room_states,
    // This visit's receipt, else the sign-off from an earlier visit, which still stands (D-119).
    signOff: detail.receipt
      ? { version: detail.receipt.version_number, by: detail.receipt.technician, at: detail.receipt.signed_at }
      : earlier
        ? { version: earlier.version_number, by: earlier.technician, at: earlier.signed_at }
        : null,
    timezone,
  };
  const printReceipt = (
    <a className="btn" href={`/events/${eventId}/srr/${detail.checkin.id}/receipt`} target="_blank" rel="noopener">
      Print receipt
    </a>
  );
  const emailReceipt = (
    <button
      className="btn"
      disabled={busy}
      onClick={() =>
        void run(async () => {
          const { emailed_to } = await emailCheckinReceipt(detail.checkin.id);
          return `Receipt emailed to ${emailed_to}`;
        })
      }
    >
      Email receipt
    </button>
  );
  const openUsb = (
    <button type="button" className="btn pri" onClick={() => setIntakeOpen(true)}>
      Take the file (Local intake)
    </button>
  );
  const preview = (
    <a className="btn" href={`/events/${eventId}/talks/${detail.talk.slot_id}`} target="_blank" rel="noopener">
      Preview slides
    </a>
  );
  const who = detail.speaker.name;

  /** The one thing to do now, in the order a technician meets the cases (D-120). */
  const next: { title: string; body?: string; actions: React.ReactNode; showApprovalNote?: boolean } = departed
    ? {
        title: `${who} has checked out.`,
        body: "If they come back, check them in again from the Speaker Ready Room.",
        actions: detail.receipt ? (
          <>
            {printReceipt}
            {emailReceipt}
          </>
        ) : null,
      }
    : blockedReason
      ? { title: blockedReason, actions: <>{!detail.latest || detail.latest.processing_state === "quarantined" ? openUsb : null}{checkOut}</> }
      : newerAfterReceipt
        ? {
            title: `A newer version (v${latestNumber}) came in after ${who} signed off.`,
            body: "Go through it with them. If it's right, confirm it as their final version.",
            actions: (
              <>
                {signOffButton(`Confirm v${latestNumber}`)}
                {preview}
                {checkOut}
              </>
            ),
            showApprovalNote: true,
          }
        : detail.receipt
          ? {
              title: `Done — ${who} confirmed v${detail.receipt.version_number} as their final version.`,
              // Signed off but not approved: say it can't play yet, so "Done" isn't read as all done (D-120).
              body:
                approvedNumber === detail.receipt.version_number
                  ? `Give them the receipt, then check them out to free ${detail.checkin.station ?? "the station"}.`
                  : `Give them the receipt, then check them out to free ${detail.checkin.station ?? "the station"}. A reviewer still needs to approve v${detail.receipt.version_number} in Manage presentations before it plays in ${detail.talk.room ?? "the room"}.`,
              actions: (
                <>
                  {printReceipt}
                  {emailReceipt}
                  {checkOut}
                </>
              ),
            }
          : earlier && earlier.version_number === latestNumber
            ? {
                title: `${who} already confirmed v${earlier.version_number} on an earlier visit.`,
                body: "If nothing has changed, they're all set — check them out. To give them a new receipt, confirm it again.",
                actions: (
                  <>
                    {checkOut}
                    {signOffButton(`Confirm v${earlier.version_number} again`)}
                    {preview}
                  </>
                ),
              }
            : {
                title: `Go through the slides with ${who}.`,
                body: `If they're right, confirm v${latestNumber} as their final version. After that the speaker can't replace it from the portal — any change comes through this desk. You'll get a receipt to print or email.`,
                actions: (
                  <>
                    {signOffButton(`Confirm v${latestNumber} as final`)}
                    {preview}
                    {checkOut}
                  </>
                ),
                showApprovalNote: true,
              };

  return (
    <>
      <h1 className="htitle" style={{ marginBottom: 4 }}>
        {detail.speaker.name}
      </h1>
      {/* One line of context; the rest is under "Details" (D-120). */}
      <p className="note" style={{ marginTop: 0 }}>
        {detail.talk.title} · {detail.talk.room ?? "No room"} · {when(detail.talk.starts_at, timezone)}
        {!departed && detail.checkin.station ? ` · at ${detail.checkin.station}` : ""}
      </p>

      {error && <div className="err">{error}</div>}

      {/* ── What to do now (D-120): one sentence, one main button. A beginner used to face a
          status chip, the same room-PC warning twice, three boxes and a paragraph of rules
          before finding the action. ─────────────────────────────────────────── */}
      <div className="card next-step">
        <div className="cbd">
          <div className="next-step-label">What to do now</div>
          <h2 className="next-step-title">{next.title}</h2>
          {next.body && <p className="next-step-body">{next.body}</p>}
          {approvalNote && next.showApprovalNote && <p className="note" style={{ marginTop: 0 }}>{approvalNote}</p>}
          {detail.receipt && !newerAfterReceipt && (
            <p className="note" style={{ marginTop: 0 }}>
              Receipt: {receiptVersion(detail.receipt)} · {when(detail.receipt.signed_at, timezone)} ·{" "}
              {detail.receipt.station}
            </p>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>{next.actions}</div>
          <WhyNot reason={checkoutBlocked && !departed ? checkoutBlocked : null} />
        </div>
      </div>

      {/* The three confirmations as one line (D-120). */}
      <div className="card">
        <div className="cbd" style={{ padding: "10px 14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div className="next-step-label">Progress</div>
              <ConfirmationStrip compact facts={stripFacts} />
            </div>
            <Chip status={detail.talk.status} label={detail.talk.status_label} />
          </div>
          <details style={{ marginTop: 8 }}>
            <summary className="note" style={{ cursor: "pointer" }}>
              Details
            </summary>
            <ConfirmationStrip facts={stripFacts} />
            <div className="note">
              Checked in {when(detail.checkin.checked_in_at, timezone)} · {detail.checkin.station ?? "no station"} ·
              technician {detail.checkin.technician}
              {detail.talk.final_locked ? " · final version locked (changes come through this desk)" : ""}
            </div>
          </details>
        </div>
      </div>

      {/* ── Local intake (screen 13), opened from check-in ───────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0 10px" }}>
        <button
          type="button"
          className={intakeOpen ? "btn" : "btn pri"}
          aria-expanded={intakeOpen}
          onClick={() => setIntakeOpen((open) => !open)}
        >
          {intakeOpen ? "Close local intake" : "Local intake"}
        </button>
        <span className="note">
          {intakeOpen
            ? "Check the file for viruses, compare it with the approved version, then accept."
            : "The speaker brought a new version — on a USB drive or saved on this computer? Bring it in here."}
        </span>
      </div>

      {intakeOpen && (
        <LocalIntake
          submit={(body) => ingestUsb(detail.checkin.id, body)}
          approvedNumber={approvedNumber}
          lastImport={lastImport}
          outcomeNote="You can confirm it as the final version above."
          onDone={async (message) => {
            setToast(message);
            await refresh();
          }}
        />
      )}

      <Toast message={toast} onClose={closeToast} />
    </>
  );
}
