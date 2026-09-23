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
} from "@/lib/api";
import { Chip } from "@/components/Chip";

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

  return (
    <>
      <h1 className="htitle">Check-in · {detail.speaker.name}</h1>

      {error && <div className="err">{error}</div>}

      <div className="card">
        <div className="chd">
          <h3>{detail.talk.title}</h3>
          <Chip status={detail.talk.status} label={detail.talk.status_label} />
        </div>
        <div className="cbd">
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
                  <button className="btn" onClick={() => setToast("Receipt sent to the station printer")}>
                    Print receipt
                  </button>
                  <button
                    className="btn"
                    onClick={() => setToast(`Receipt emailed to ${detail.speaker.name}`)}
                  >
                    Email receipt
                  </button>
                  <button
                    className="btn"
                    disabled={busy || detail.checkin.departed_at !== null}
                    onClick={() =>
                      void run(async () => {
                        await departCheckin(detail.checkin.id);
                        router.push(`/events/${eventId}/srr`);
                        return "Checked out";
                      })
                    }
                  >
                    Check out
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <button
                className="btn good"
                disabled={busy || !signable}
                title={signable ? undefined : "Only a scanned, stored version can be signed off"}
                onClick={() =>
                  void run(async () => {
                    const { receipt } = await signOffCheckin(
                      detail.checkin.id,
                      detail.latest!.file_version_id,
                    );
                    return `Signed off · v${receipt.version_number} · logged — the speaker portal can no longer replace this file`;
                  })
                }
              >
                Confirm v{detail.latest?.version_number ?? "—"} as the final onsite version
              </button>
              <span className="note" style={{ alignSelf: "center" }}>
                Sign-off locks the talk: further versions can only come from here.
              </span>
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
              <b>v{usb.version_number} accepted</b> · inspection: {usb.inspection_state} · now in the
              review queue. Sign off above once DXG has approved it, or send the speaker back to the
              room with the current approved version.
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
