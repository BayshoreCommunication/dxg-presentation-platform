import type { MyAgendaSession } from "@/lib/api";

const clock = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });

/** A bare `YYYY-MM-DD` as a calendar day — never shifted through a timezone. */
const dayOf = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * The event's programme as a speaker sees it: every session by day, with room, time and
 * who presents — the public programme — and the speaker's own talks marked with their
 * status. Nothing about anyone else's files.
 */
export function Agenda({ event, sessions }: { event: { id: string; name: string; timezone: string }; sessions: MyAgendaSession[] }) {
  const days = [...new Set(sessions.map((session) => session.day ?? ""))];
  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <h1 className="htitle" style={{ margin: 0 }}>
          Agenda
        </h1>
        <p className="note" style={{ margin: "4px 0 0" }}>
          {event.name}. Your own talks are marked; times are the event&rsquo;s local time.
        </p>
      </div>
      {sessions.length === 0 && (
        <div className="card">
          <div className="empty">The agenda has not been published yet.</div>
        </div>
      )}
      {days.map((day) => (
        <div key={day || "undated"} className="card">
          <div className="chd">
            <h3>{day ? dayOf(day) : "No day yet"}</h3>
          </div>
          <table>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Time</th>
                <th>Session</th>
                <th style={{ width: 160 }}>Room</th>
              </tr>
            </thead>
            <tbody>
              {sessions
                .filter((session) => (session.day ?? "") === day)
                .map((session) => (
                  <tr key={session.id} style={session.state === "canceled" ? { opacity: 0.55 } : undefined}>
                    <td className="num" style={{ whiteSpace: "nowrap", verticalAlign: "top" }}>
                      {clock(session.starts_at, event.timezone)}–{clock(session.ends_at, event.timezone)}
                    </td>
                    <td>
                      <b>{session.title}</b>
                      {session.state === "canceled" && <span className="chip" style={{ marginLeft: 8 }}>Canceled</span>}
                      {session.track && <div className="note">{session.track}</div>}
                      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                        {session.presentations.map((presentation) => (
                          <li key={presentation.slot_id} style={{ margin: "2px 0" }}>
                            {presentation.title}
                            {presentation.speakers.length > 0 && (
                              <span className="note">
                                {" "}
                                — {presentation.speakers.map((who) => who.name + (who.organization ? ` (${who.organization})` : "")).join(", ")}
                              </span>
                            )}
                            {presentation.mine && (
                              <span className="chip c-info" style={{ marginLeft: 8 }} title="One of your talks">
                                You{presentation.status_label ? ` · ${presentation.status_label}` : ""}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td style={{ verticalAlign: "top" }}>{session.room ?? <span className="note">To be confirmed</span>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
