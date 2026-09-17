"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SrrDashboard } from "@/lib/api";
import { startCheckin, ApiError } from "@/lib/api";
import { Chip } from "@/components/Chip";

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
  });

/** Screen 11 — the Speaker Ready Room's own view of who is coming and what is unresolved. */
export function SrrDashboardView({ eventId, data }: { eventId: string; data: SrrDashboard }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check(speakerId: string, station: string) {
    setBusy(true);
    setError(null);
    try {
      const { checkin_id } = await startCheckin(eventId, speakerId, station);
      router.push(`/events/${eventId}/srr/${checkin_id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Check-in failed.");
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="htitle">Speaker Ready Room · Room 118</h1>
      <div className="note" style={{ margin: "-8px 0 14px" }}>
        Stations 1–3 · walk-ins and scheduled check-ins
      </div>

      {error && <div className="err">{error}</div>}

      <div className="card">
        <div className="chd">
          <h3>Expected · {data.expected.length}</h3>
          <span className="m">ordered by session time</span>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          <table>
            <tbody>
              {data.expected.map((row) => (
                <tr key={row.speaker_id}>
                  <td>
                    <b>{row.speaker}</b>
                    <br />
                    <span className="note">
                      {row.room} · {time(row.starts_at)} · {row.title}
                    </span>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Chip status={row.status} label={row.status_label} />{" "}
                    {row.checkin_id ? (
                      <a className="btn" href={`/events/${eventId}/srr/${row.checkin_id}`}>
                        Open check-in →
                      </a>
                    ) : (
                      <button
                        className="btn pri"
                        disabled={busy}
                        onClick={() => void check(row.speaker_id, "Station 2")}
                      >
                        Check in →
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>Unresolved warnings · {data.warnings.length}</h3>
          <span className="m">on versions still awaiting review</span>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          {data.warnings.length === 0 ? (
            <div className="empty">No unresolved warnings.</div>
          ) : (
            <table>
              <tbody>
                {data.warnings.map((warning, index) => (
                  <tr key={`${warning.slot_id}-${index}`}>
                    <td>
                      {warning.speaker} · {warning.check_code.replace("_", " ")}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Chip
                        status={warning.severity === "blocking" ? "attention" : "needs_revision"}
                        label={warning.severity === "blocking" ? "Blocking" : "Tech review"}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>Stations</h3>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          <table>
            <tbody>
              {data.stations.map((station) => (
                <tr key={station.station}>
                  <td>
                    {station.station}
                    {station.technician ? ` · ${station.technician}` : ""}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Chip
                      status={station.busy ? "submitted" : "canceled"}
                      label={station.busy ? "In session" : "Free"}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
