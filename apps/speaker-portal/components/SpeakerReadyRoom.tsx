import type { MySrr } from "@/lib/api";
import { formatDateRange } from "@pmp/format";

const when = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone });

/**
 * The Speaker Ready Room as a speaker sees it: where it is and how it works, whether they
 * have checked in and what they signed off. Presentation files and updates live under
 * Manage presentations.
 */
export function SpeakerReadyRoom({ srr }: { srr: MySrr }) {
  const open = srr.checkins.find((visit) => !visit.departed_at);
  const latestSignOff = srr.sign_offs[0];
  const tz = srr.event.timezone;

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <h1 className="htitle" style={{ margin: 0 }}>
          Speaker Ready Room
        </h1>
        <p className="note" style={{ margin: "4px 0 0", maxWidth: "62ch" }}>
          {srr.event.name} · {formatDateRange(srr.event.starts_on, srr.event.ends_on)}
          {srr.event.venue ? ` · ${srr.event.venue}` : ""}. Before your session, come to the Speaker Ready Room: a technician
          checks you in at a desk, you look over your slides together, and you confirm the final version.
        </p>
      </div>

      {/* The room opens on the event day (D-157). */}
      {!srr.open && (
        <div className="card next-step">
          <div className="cbd">
            <div className="next-step-label">Not open yet</div>
            <p className="next-step-body" style={{ margin: 0 }}>
              The Speaker Ready Room opens on the event day. Until then you can keep updating your presentation under Manage
              presentations.
            </p>
          </div>
        </div>
      )}

      <div className="card">
        <div className="chd">
          <h3>Your status</h3>
          <span className={`chip ${latestSignOff ? "c-ok" : open ? "c-info" : ""}`}>
            {latestSignOff ? "Signed off" : open ? "Checked in" : "Not checked in yet"}
          </span>
        </div>
        <div className="cbd">
          {open ? (
            <p style={{ margin: 0 }}>
              You are checked in{open.station ? ` at ${open.station}` : ""} since {when(open.checked_in_at, tz)}, with {open.technician}.
            </p>
          ) : latestSignOff ? (
            <p style={{ margin: 0 }}>
              You confirmed <b>{latestSignOff.file_name}</b> (version {latestSignOff.version_number}) for “{latestSignOff.talk}” as final on{" "}
              {when(latestSignOff.signed_at, tz)}.
              {latestSignOff.receipt_emailed_to ? ` A receipt was emailed to ${latestSignOff.receipt_emailed_to}.` : ""}
            </p>
          ) : (
            <p style={{ margin: 0 }}>
              You have not checked in yet. When you arrive, a technician will check you in at one of the desks below.
            </p>
          )}
          {srr.checkins.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary className="note" style={{ cursor: "pointer" }}>
                Your visits ({srr.checkins.length})
              </summary>
              <ul className="note" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {srr.checkins.map((visit) => (
                  <li key={visit.id}>
                    {when(visit.checked_in_at, tz)}
                    {visit.station ? ` · ${visit.station}` : ""} · {visit.technician}
                    {visit.departed_at ? ` · left ${when(visit.departed_at, tz)}` : " · still here"}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>Desks</h3>
        </div>
        <div className="cbd">
          {srr.stations.length === 0 ? (
            <span className="note">The team has not set up the desks yet.</span>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {srr.stations.map((station) => (
                <li key={station.name}>
                  {station.name} <span className="note">· {station.busy ? "busy" : "free"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
