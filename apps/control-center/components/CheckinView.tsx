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
import { Chip, StatusMeaning } from "@/components/Chip";
import { staleNoteFor } from "@/lib/roomWords";

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
export function CheckinView({
  eventId,
  timezone,
  initial,
  rooms = [],
}: {
  eventId: string;
  timezone: string;
  initial: CheckinDetail;
  /** Room sync's room list, for R7's room-PC freshness (D-110). */
  rooms?: { room: string; heartbeat_age: number | null }[];
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

  async function scanAndImport() {
    if (!file) return;
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
  const staleNote = staleNoteFor(detail.talk.status, detail.talk.room, rooms);
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
          disabled={busy || detail.checkin.departed_at !== null}
          title={detail.checkin.departed_at !== null ? "Already checked out" : undefined}
          onClick={() => setConfirmCheckout(true)}
        >
          Check out
        </button>
      )}
    </>
  );

  const signOffButton = (label: string) => (
    <button
      className="btn good"
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

  return (
    <>
      <h1 className="htitle">Check-in · {detail.speaker.name}</h1>

      {error && <div className="err">{error}</div>}

      <div className="card">
        <div className="chd">
          <h3>{detail.talk.title}</h3>
          <Chip status={detail.talk.status} label={detail.talk.status_label} stale={staleNote} />
        </div>
        <div className="cbd">
          {/* R47: what the status means, visibly; R7: amber when the room PC is quiet (D-110). */}
          <div style={{ marginBottom: 6 }}>
            <StatusMeaning status={detail.talk.status} stale={staleNote} />
          </div>
          <div className="note" style={{ marginBottom: 6 }}>
            {detail.talk.room} · {when(detail.talk.starts_at, timezone)} · current approved:{" "}
            <b className="mono">
              {detail.approved ? `v${detail.approved.version_number}` : "none"}
            </b>
          </div>
          <div className="note">
            Checked in {when(detail.checkin.checked_in_at, timezone)} · {detail.checkin.station} · Technician{" "}
            {detail.checkin.technician}
            {detail.talk.final_locked && (
              <>
                {" · "}
                <span className="chip c-ok">Final onsite version locked</span>
              </>
            )}
          </div>

          {detail.receipt ? (
            <div className="card" style={{ marginTop: 14, marginBottom: 0 }}>
              <div className="cbd">
                <h3 style={{ fontSize: 14, marginBottom: 8 }}>Presentation receipt</h3>
                <table>
                  <tbody>
                    <tr>
                      <td className="note">Version</td>
                      <td className="mono">
                        v{detail.receipt.version_number} · {detail.receipt.sha256.slice(0, 8)}…
                        {detail.receipt.sha256.slice(-4)}
                      </td>
                    </tr>
                    <tr>
                      <td className="note">Signed</td>
                      <td>
                        {when(detail.receipt.signed_at, timezone)} · {detail.receipt.station}
                      </td>
                    </tr>
                    <tr>
                      <td className="note">Technician</td>
                      <td>{detail.receipt.technician}</td>
                    </tr>
                  </tbody>
                </table>
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                  {/* Both used to show a success message and do nothing (D-106). Print opens a
                      receipt page made for paper, which prints on the station's own printer. */}
                  <a
                    className="btn"
                    href={`/events/${eventId}/srr/${detail.checkin.id}/receipt`}
                    target="_blank"
                    rel="noopener"
                  >
                    Print receipt
                  </a>
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
                  {checkOut}
                </div>
                {/* A newer file came in after sign-off (USB intake): offer to confirm it (D-108). */}
                {signable && latestNumber !== undefined && latestNumber > detail.receipt.version_number && (
                  <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span className="note">
                      v{latestNumber} came in after this receipt. Confirm it to make it the final version.
                    </span>
                    {signOffButton(`Confirm v${latestNumber} as the final onsite version`)}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              {blockedReason && (
                <div className="err" style={{ marginBottom: 10 }}>
                  {blockedReason}
                </div>
              )}
              {approvalNote && (
                <div className="note" style={{ marginBottom: 10, lineHeight: 1.5 }}>
                  {approvalNote}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {detail.latest && signOffButton(`Confirm v${latestNumber} as the final onsite version`)}
                {checkOut}
              </div>
              {signable && (
                <div className="note" style={{ marginTop: 8 }}>
                  Confirming locks the talk: the speaker can no longer replace the file from the portal, and
                  any later change must come through this desk. You&rsquo;ll get a receipt to print or email.
                </div>
              )}
            </div>
          )}
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
            ? "Scan the drive, compare with the approved version, then accept."
            : "The speaker brought a new version on a USB drive? Bring it in here."}
        </span>
      </div>

      {intakeOpen && (
        <>

      <div className="card">
        <div className="chd">
          <h3>1 · Malware scan</h3>
          {usb ? (
            <Chip
              status={usb.scan_result === "clean" ? "synchronized_onsite" : "attention"}
              label={usb.scan_result === "clean" ? "Clean" : "Quarantined"}
            />
          ) : (
            <Chip status="canceled" label="Required" />
          )}
        </div>
        <div className="cbd">
          <p className="note" style={{ marginTop: 0 }}>
            Files cannot enter any library until scanning completes. Failures are quarantined and the
            approved version stays active in the room.
          </p>
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
            <button className="btn pri" disabled={busy || !file} onClick={() => void scanAndImport()}>
              {busy ? "Scanning…" : "Scan drive & import"}
            </button>
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
            <Chip status="canceled" label="Awaiting scan" />
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
                  <th>Δ</th>
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
            <div className="note">Runs automatically after a clean scan.</div>
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
            the new one is approved and re-synced — approved room copies are never replaced silently.
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
