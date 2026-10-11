"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { EventRow, StaffRow } from "@/lib/api";
import { assignStaffToEvent, ApiError } from "@/lib/api";
import { Chip } from "@/components/Chip";
import { ConfirmInline } from "@/components/ConfirmInline";
import { ACCOUNT_KIND, formatDateRange, ROLE, wordsFor } from "@pmp/format";
import { Icon } from "@/components/Icon";

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
export function EventAssignments({
  initial,
  events,
  assign,
}: {
  initial: StaffRow[];
  events: EventRow[];
  /** A14: arrived from "Next: assign them to an event" on Staff accounts (`?assign=<user id>`). */
  assign?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  /** A19 (D-113): an error belongs to the event row it happened on, not the top of the page. */
  const [error, setError] = useState<{ eventId: string; message: string } | null>(null);
  /** A18 (D-113): the removal waiting for "are you sure?". */
  const [removing, setRemoving] = useState<{ eventId: string; person: StaffRow } | null>(null);
  const newcomer = assign
    ? initial.find((person) => person.id === assign && person.is_active && person.account_type !== "root_admin")
    : undefined;
  /** Who is about to be assigned to which event. The roles follow their kind (D-151). */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const setWho = (eventId: string, who: string) => setDraft((current) => ({ ...current, [eventId]: who }));

  async function run(eventId: string, work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      router.refresh();
    } catch (caught) {
      setError({ eventId, message: caught instanceof ApiError ? caught.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="htitle">Event assignments</h1>
      <div className="note" style={{ margin: "-8px 0 14px" }}>
        Staff are placed on events; a staff member assigned nowhere can sign in and reach nothing. What they
        can do on an event follows their access level — DXG Support staff run it, DXG Technician staff work the
        Speaker Ready Room and Manage presentations. DXG Admins reach every event already and are not listed here.
      </div>

      {newcomer && (
        <div className="card">
          <div className="cbd">
            <b>Assigning {newcomer.display_name}.</b>{" "}
            <span className="note">
              Press &ldquo;assign {newcomer.display_name} here&rdquo; on the event they will work.
            </span>
          </div>
        </div>
      )}

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
                      <span className="note">{formatDateRange(event.starts_on, event.ends_on)}</span>
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
                              <Chip status="needs_revision" label="Sign-in app not set up" />
                            )}
                            <span className="chip c-info" title={ACCOUNT_KIND[person.account_type]?.meaning}>
                              {ACCOUNT_KIND[person.account_type]?.label ?? person.account_type}
                            </span>
                            <span className="note" title={roles.map((role) => wordsFor(ROLE, role).label).join(", ")}>
                              {roles.map((role) => wordsFor(ROLE, role).label).join(" · ")}
                            </span>
                            <button
                              className="btn"
                              title={`Take ${person.display_name} off ${event.name}`}
                              style={{ padding: "0 5px", fontSize: 11, lineHeight: 1.5 }}
                              disabled={busy}
                              onClick={() => {
                                setError(null);
                                setRemoving({ eventId: event.id, person });
                              }}
                            >
                              ×
                            </button>
                          </div>
                        ))
                      )}

                      {removing?.eventId === event.id && (
                        <ConfirmInline
                          question={`Take ${removing.person.display_name} off ${event.name}?`}
                          detail="They will no longer see this event. You can assign them again at any time."
                          confirmLabel="Remove"
                          icon="trash"
                          busyLabel="Removing…"
                          danger
                          onConfirm={async () => {
                            await assignStaffToEvent(removing.person.id, event.id, false);
                            setRemoving(null);
                            router.refresh();
                          }}
                          onClose={() => setRemoving(null)}
                        />
                      )}

                      {/*
                        Assigning happens here rather than on the account rows: this is where the
                        question is being asked, and the event is already decided by which row you are
                        on. No roles to tick (D-151): the account's access level says what it does.
                      */}
                      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        {newcomer && draft[event.id] !== newcomer.id && (
                          <button
                            className="btn pri"
                            style={{ padding: "2px 8px", fontSize: 12 }}
                            onClick={() => setWho(event.id, newcomer.id)}
                          >
                            <Icon name="add" />
                            assign {newcomer.display_name} here
                          </button>
                        )}
                        <select
                          value={draft[event.id] ?? ""}
                          onChange={(e) => setWho(event.id, e.target.value)}
                          style={{ fontSize: 12, padding: "3px 6px" }}
                        >
                          <option value="">assign someone…</option>
                          {initial
                            // Admins reach every event without a role (D-100); those already here are not offered.
                            .filter(
                              (person) =>
                                person.is_active &&
                                person.account_type !== "root_admin" &&
                                !people.some((entry) => entry.person.id === person.id),
                            )
                            .map((person) => (
                              <option key={person.id} value={person.id}>
                                {person.display_name} — {ACCOUNT_KIND[person.account_type]?.label ?? person.account_type}
                              </option>
                            ))}
                        </select>
                        {draft[event.id] && (
                          <button
                            className="btn"
                            style={{ padding: "2px 8px", fontSize: 12 }}
                            disabled={busy}
                            onClick={() =>
                              void run(event.id, async () => {
                                const who = draft[event.id];
                                if (!who) throw new ApiError("request", "Pick who to assign.", 400);
                                await assignStaffToEvent(who, event.id, true);
                                setDraft((current) => ({ ...current, [event.id]: "" }));
                              })
                            }
                          >
                            <Icon name="add" />
                            assign
                          </button>
                        )}
                        {/* A19: the error shows under the event it happened on. */}
                        {error?.eventId === event.id && (
                          <div className="err" style={{ margin: "6px 0 0" }}>
                            {error.message}
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
