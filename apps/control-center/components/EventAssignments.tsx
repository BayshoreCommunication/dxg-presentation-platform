"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EventRow, StaffRow } from "@/lib/api";
import { setStaffRole, EVENT_ROLE_NAMES, ApiError } from "@/lib/api";
import { Chip } from "@/components/Chip";

/**
 * Who is on each event, inverted from the per-account list.
 *
 * The same facts either way, but the questions are different. "What can this person
 * reach?" is answered by the account rows; "who is working NeuroSummit, and as what?"
 * is not, and that is the question an administrator has while staffing an event.
 *
 * Events with nobody on them are kept in the list rather than filtered out — an event
 * with no staff is the thing most worth seeing here, and it is invisible in a view
 * organised by person, because the absence has no row to appear on.
 */
function byEvent(staff: StaffRow[], events: EventRow[]) {
  return events.map((event) => ({
    event,
    // One entry per person, carrying every hat they wear here. Pairing (person, role)
    // instead would repeat the same name down the column — three lines for someone
    // holding three roles, which reads as three people at a glance.
    people: staff
      .map((person) => ({
        person,
        roles: person.roles.filter((held) => held.event_id === event.id).map((held) => held.role),
      }))
      .filter((entry) => entry.roles.length > 0)
      .sort((a, b) => a.person.display_name.localeCompare(b.person.display_name)),
  }));
}

/**
 * Event assignments — who works which event, and as what.
 *
 * A separate page from Staff accounts because they are separate jobs. This one is
 * asked while staffing an event and is about placement; the other is asked about a
 * person and is about their password, authenticator and whether they can sign in at
 * all. Holding both on one screen meant every account row carried controls for a
 * question nobody was asking at that moment.
 */
export function EventAssignments({ initial, events }: { initial: StaffRow[]; events: EventRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Who is being assigned to which event, and with which roles, before pressing assign. */
  const [draft, setDraft] = useState<Record<string, { who: string; roles: string[] }>>({});

  const setWho = (eventId: string, who: string) =>
    setDraft((current) => ({ ...current, [eventId]: { who, roles: [] } }));

  const toggleRole = (eventId: string, role: string) =>
    setDraft((current) => {
      const entry = current[eventId] ?? { who: "", roles: [] };
      const roles = entry.roles.includes(role)
        ? entry.roles.filter((held) => held !== role)
        : [...entry.roles, role];
      return { ...current, [eventId]: { ...entry, roles } };
    });

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="htitle">Event assignments</h1>
      <div className="note" style={{ margin: "-8px 0 14px" }}>
        A role is held on an event, not on the platform — so someone assigned nowhere can sign in and
        reach nothing.
      </div>

      {error && <div className="err">{error}</div>}

        <div className="card">
          <div className="chd">
            <h3>Event assignments</h3>
            <span className="m">
              who works which event, and as what
              <Link href="/admin/users" className="btn" style={{ padding: "2px 8px", fontSize: 12, marginLeft: 10 }}>
                manage accounts ›
              </Link>
            </span>
          </div>
          <div className="cbd" style={{ padding: "0 0 4px" }}>
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Staff assigned</th>
                </tr>
              </thead>
              <tbody>
                {byEvent(initial, events).map(({ event, people }) => (
                  <tr key={event.id}>
                    <td style={{ verticalAlign: "top", whiteSpace: "nowrap" }}>
                      <div style={{ fontWeight: 600 }}>{event.name}</div>
                      <span className="note mono">
                        {event.starts_on}–{event.ends_on}
                      </span>
                    </td>
                    <td>
                      {people.length === 0 ? (
                        /*
                         * The point of this view. An event nobody can work on looks
                         * exactly like a healthy one from the account list, because
                         * an absence has no row of its own to appear on.
                         */
                        <span className="chip c-warn">nobody assigned yet</span>
                      ) : (
                        people.map(({ person, roles }) => (
                          <div
                            key={person.id}
                            style={{
                              display: "flex",
                              alignItems: "baseline",
                              gap: 6,
                              flexWrap: "wrap",
                              marginBottom: 4,
                            }}
                          >
                            <span style={{ display: "inline-block", minWidth: 150 }}>
                              {person.display_name}
                            </span>
                            {!person.is_active && <Chip status="attention" label="deactivated" />}
                            {person.is_active && !person.mfa_enrolled && (
                              <Chip status="needs_revision" label="2FA not set up" />
                            )}
                            {/*
                              Each hat keeps its own remove, because they are removed one
                              at a time — taking someone off room sync should not also
                              take them off review.
                            */}
                            {roles.map((role) => (
                              <span
                                key={role}
                                style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
                              >
                                <span className="chip c-mut">{role.replace(/_/g, " ")}</span>
                                <button
                                  className="btn"
                                  title={`Remove ${role.replace(/_/g, " ")}`}
                                  style={{ padding: "0 5px", fontSize: 11, lineHeight: 1.5 }}
                                  disabled={busy}
                                  onClick={() =>
                                    void run(async () => {
                                      await setStaffRole(person.id, event.id, role, false);
                                    })
                                  }
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        ))
                      )}

                      {/*
                        Assigning happens here rather than on the account rows: this is
                        where the question is being asked, and the event is already
                        decided by which row you are on — so it cannot be got wrong by
                        leaving a dropdown on its default.

                        Roles are checkboxes, not a single choice, because one person
                        routinely wears two hats on an event — the SRR technician who
                        also runs a room, the presentation manager who reviews content.
                        The data model always allowed it; making it one role at a time
                        implied otherwise and cost a round trip per hat.
                      */}
                      <div style={{ marginTop: 8 }}>
                        <select
                          value={draft[event.id]?.who ?? ""}
                          onChange={(e) => setWho(event.id, e.target.value)}
                          style={{ fontSize: 12, padding: "3px 6px" }}
                        >
                          <option value="">assign someone…</option>
                          {initial
                            .filter((person) => person.is_active)
                            .map((person) => (
                              <option key={person.id} value={person.id}>
                                {person.display_name}
                              </option>
                            ))}
                        </select>

                        {draft[event.id]?.who && (
                          <div style={{ marginTop: 6 }}>
                            <div className="note" style={{ marginBottom: 4 }}>
                              as — tick every role they hold on this event:
                            </div>
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                              {EVENT_ROLE_NAMES.map((role) => {
                                const already = people.some(
                                  (p) => p.person.id === draft[event.id]?.who && p.roles.includes(role),
                                );
                                return (
                                  <label
                                    key={role}
                                    className="note"
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 4,
                                      opacity: already ? 0.45 : 1,
                                    }}
                                    /* Held already, so there is nothing to add. */
                                    title={already ? "Already holds this role here" : undefined}
                                  >
                                    <input
                                      type="checkbox"
                                      disabled={already || busy}
                                      checked={already || (draft[event.id]?.roles ?? []).includes(role)}
                                      onChange={() => toggleRole(event.id, role)}
                                    />
                                    {role.replace(/_/g, " ")}
                                  </label>
                                );
                              })}
                            </div>
                            <button
                              className="btn"
                              style={{ padding: "2px 8px", fontSize: 12 }}
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  const chosen = draft[event.id];
                                  if (!chosen?.who) throw new ApiError("request", "Pick who to assign.", 400);
                                  if (!chosen.roles.length) {
                                    throw new ApiError("request", "Tick at least one role.", 400);
                                  }
                                  // Sequential, so a failure part-way names the role it
                                  // failed on rather than losing it in a race.
                                  for (const role of chosen.roles) {
                                    await setStaffRole(chosen.who, event.id, role, true);
                                  }
                                  setDraft((current) => ({ ...current, [event.id]: { who: "", roles: [] } }));
                                })
                              }
                            >
                              assign{" "}
                              {(draft[event.id]?.roles.length ?? 0) > 0 &&
                                `${draft[event.id]!.roles.length} role${draft[event.id]!.roles.length > 1 ? "s" : ""}`}
                            </button>
                          </div>
                        )}
                      </div>
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
