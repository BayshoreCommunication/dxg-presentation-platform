"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SrrDashboard } from "@/lib/api";
import { startCheckin, ApiError } from "@/lib/api";
import { Chip } from "@/components/Chip";

/**
 * A session's day and time, on the event's clock. The day is spelled out rather than
 * implied: on a three-day event "10:30" alone does not say which 10:30, and "today"
 * is only true on one of them.
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

/** Screen 11 — the Speaker Ready Room's own view of who is coming and what is unresolved. */
export function SrrDashboardView({
  eventId,
  eventName,
  timezone,
  data,
}: {
  eventId: string;
  eventName: string;
  timezone: string;
  data: SrrDashboard;
}) {
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
      {/*
        This heading said "Speaker Ready Room · Room 118" and "Stations 1–3" on every
        event. It now names the event, the actual date at the venue, and the stations
        this room really has.
      */}
      <h1 className="htitle">Speaker Ready Room · {eventName}</h1>
      <div className="note" style={{ margin: "-8px 0 14px" }}>
        {new Date().toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: timezone,
        })}
        {data.stations.length > 0 && ` · ${data.stations.map((station) => station.station).join(", ")}`}
        {" · walk-ins and scheduled check-ins"}
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
                      {row.room} · {when(row.starts_at, timezone)} · {row.title}
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
