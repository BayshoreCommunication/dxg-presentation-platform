"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { CheckinDetail, UsbResult } from "@/lib/api";
import {
  getCheckin,
  beginSrrUpload,
  putSrrPart,
  ingestUsb,
  signOffCheckin,
  departCheckin,
  ApiError,
  emailCheckinReceipt,
} from "@/lib/api";
import { Chip } from "@/components/Chip";
import { ConfirmationStrip } from "@/components/ConfirmationStrip";
import { WhyNot } from "@/components/WhyNot";

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
 * Screens 12 and 13 — check-in and the three-step USB intake. The steps are
 * ordered by the rules, not by the layout: nothing is compared or accepted
 * before the scan, and acceptance needs a reason (FR-SRR-002/003/004).
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
  const [usb, setUsb] = useState<UsbResult | null>(null);
  // USB intake opens from its own button rather than always sitting below check-in:
  // most speakers arrive with nothing new, and the three steps are noise until one does.
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  // What USB intake still needs, said before anything is uploaded (R35, D-111): the
  // reason used to be refused only after the whole file had gone up.
  const intakeBlocked =
    !reason.trim() && !file
      ? "To import, write a reason and choose the file from the USB drive."
      : !reason.trim()
        ? "To import, write a reason for the new version."
        : !file
          ? "To import, choose the file from the USB drive."
          : null;

  async function scanAndImport() {
    if (!file || !reason.trim()) return;
    await run(async () => {
      const session = await beginSrrUpload();
      const total = Math.max(1, Math.ceil(file.size / session.part_size));
      for (let part = 1; part <= total; part += 1) {
        const start = (part - 1) * session.part_size;
        await putSrrPart(session.upload_id, part, await file.slice(start, start + session.part_size).arrayBuffer());
      }
      const result = await ingestUsb(detail.checkin.id, {
        upload_id: session.upload_id,
        file_name: file.name,
        reason,
      });
      setUsb(result);
      return result.message;
    });
  }

  const signable = detail.latest && detail.latest.processing_state === "stored";
  const [confirmCheckout, setConfirmCheckout] = useState(false);
  const latestNumber = detail.latest?.version_number;
  const approvedNumber = detail.approved?.version_number;
  // Why the newest file can't be signed off, in words a technician can act on (D-108).
  const blockedReason = !detail.latest
    ? "The speaker hasn't uploaded a presentation yet. Bring their file in with USB intake below."
    : detail.latest.processing_state === "quarantined"
      ? `v${latestNumber} failed the virus check and can't be used. Ask the speaker for a clean copy and bring it in with USB intake below.`
      : detail.latest.processing_state !== "stored"
        ? `v${latestNumber} is still being checked. This takes a moment — refresh the page shortly.`
        : null;

  // The last USB import, from the check-in itself, so a refresh doesn't lose it (R37, D-112).
  const lastImportNumber =
    detail.usb?.file_version_id && detail.usb.file_version_id === detail.latest?.file_version_id
      ? latestNumber
      : undefined;
  const lastImport = detail.usb
    ? detail.usb.scan_result === "clean"
      ? `Last USB import (${when(detail.usb.created_at, timezone)}) passed the virus check${
          lastImportNumber !== undefined ? ` and was saved as v${lastImportNumber}` : ""
        }.`
      : `Last USB import (${when(detail.usb.created_at, timezone)}) failed the virus check and was not stored.`
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
      Take the file by USB
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

      {/* ── USB intake (screen 13), opened from check-in ─────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0 10px" }}>
        <button
          type="button"
          className={intakeOpen ? "btn" : "btn pri"}
          aria-expanded={intakeOpen}
          onClick={() => setIntakeOpen((open) => !open)}
        >
          {intakeOpen ? "Close USB intake" : "USB intake"}
        </button>
        <span className="note">
          {intakeOpen
            ? "Check the file for viruses, compare it with the approved version, then accept."
            : "The speaker brought a new version on a USB drive? Bring it in here."}
        </span>
      </div>

      {intakeOpen && (
        <>

      <div className="card">
        <div className="chd">
          {/* Plain intake words (R36, D-112). */}
          <h3>1 · Virus check</h3>
          {usb ? (
            <Chip
              status={usb.scan_result === "clean" ? "synchronized_onsite" : "attention"}
              label={usb.scan_result === "clean" ? "Clean" : "Held back"}
            />
          ) : (
            <Chip status="canceled" label="Choose the file from the USB drive" />
          )}
        </div>
        <div className="cbd">
          <p className="note" style={{ marginTop: 0 }}>
            Nothing is stored until the file passes the virus check. A file that fails is held back, and
            the room keeps what it already has.
          </p>
          {/* R37 (D-112): after a refresh the full result is gone; say what the last import did. */}
          {!usb && lastImport && <div className="note" style={{ marginBottom: 8 }}>{lastImport}</div>}
          <div className="field">
            <label>Reason (required)</label>
            <input
              style={{ width: "100%" }}
              placeholder="e.g. speaker added a closing slide onsite"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <input
            type="file"
            accept=".pptx,.ppt,.pdf,.key"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <div style={{ marginTop: 10 }}>
            <button
              className="btn pri"
              disabled={busy || intakeBlocked !== null}
              title={intakeBlocked ?? undefined}
              onClick={() => void scanAndImport()}
            >
              {busy ? "Checking…" : "Check & import file"}
            </button>
            <WhyNot reason={intakeBlocked} />
          </div>
          {usb && <div className={usb.scan_result === "clean" ? "lane int" : "err"}>{usb.message}</div>}
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>
            2 · Comparison vs the {usb?.compared_with?.basis ?? "approved"} version
          </h3>
          {usb?.scan_result === "clean" ? (
            <Chip
              status="submitted"
              label={`v${usb.version_number} vs v${usb.compared_with?.version_number ?? "—"}`}
            />
          ) : (
            <Chip status="canceled" label="After the virus check" />
          )}
        </div>
        <div className="cbd" style={{ padding: usb?.comparison.length ? "0 0 4px" : undefined }}>
          {usb?.scan_result === "clean" && usb.comparison.length > 0 ? (
            <table>
              <thead>
                <tr>
                  <th />
                  <th>v{usb.compared_with?.version_number ?? "—"}</th>
                  <th>v{usb.version_number}</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {usb.comparison.map((row) => (
                  <tr key={row.field}>
                    <td>{row.field}</td>
                    <td className="num">{row.approved}</td>
                    <td className="num">{row.incoming}</td>
                    <td>
                      <Chip
                        status={row.delta === "unchanged" ? "synchronized_onsite" : "needs_revision"}
                        label={row.delta}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="note">Shown once the file passes the virus check.</div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>3 · Outcome</h3>
        </div>
        <div className="cbd">
          <p className="note" style={{ marginTop: 0 }}>
            An accepted version goes to re-approval. The room keeps playing the approved copy until
            the new one is approved and loaded onto the room PC by hand — it is never replaced without warning.
          </p>
          {usb?.scan_result === "clean" ? (
            <div className="lane spk">
              <b>v{usb.version_number} is in.</b> It now needs a reviewer&rsquo;s approval in Review
              presentations
              {approvedNumber ? `; the room keeps playing v${approvedNumber} until then` : ""}. You can
              confirm it as the final version above.
            </div>
          ) : (
            <div className="note">Nothing to accept yet.</div>
          )}
        </div>
      </div>
        </>
      )}

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </>
  );
}
