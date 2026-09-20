"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EventRow, StaffRow } from "@/lib/api";
import {
  createStaff,
  resetStaffPassword,
  resetStaffMfa,
  setStaffActive,
  unlockStaff,
  setStaffRole,
  EVENT_ROLE_NAMES,
  ApiError,
} from "@/lib/api";
import { Chip } from "@/components/Chip";

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "never";

/**
 * Staff accounts. There is no signup, so this screen is the only way an account
 * comes into existence — and the only way back in for someone who has lost their
 * phone or their password.
 */
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
    people: staff
      .flatMap((person) =>
        person.roles
          .filter((held) => held.event_id === event.id)
          .map((held) => ({ person, role: held.role })),
      )
      .sort((a, b) => a.person.display_name.localeCompare(b.person.display_name)),
  }));
}

export function StaffAdmin({ initial, events }: { initial: StaffRow[]; events: EventRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ title: string; value: string; note: string } | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [view, setView] = useState<"person" | "event">("event");

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
      <h1 className="htitle">Staff accounts</h1>
      <div className="note" style={{ margin: "-8px 0 14px" }}>
        There is no signup. Accounts are created here, and every account needs an authenticator
        before it can use the platform.
      </div>

      {error && <div className="err">{error}</div>}

      {secret && (
        <div className="card" style={{ borderColor: "var(--warn)" }}>
          <div className="chd">
            <h3>{secret.title}</h3>
            <span className="chip c-warn">shown once</span>
          </div>
          <div className="cbd">
            <div
              className="mono"
              style={{
                fontSize: 17,
                letterSpacing: "0.08em",
                background: "var(--mist)",
                border: "1px solid var(--line)",
                borderRadius: 6,
                padding: "12px 14px",
              }}
            >
              {secret.value}
            </div>
            <div className="note" style={{ marginTop: 8 }}>
              {secret.note}
            </div>
            <button className="btn" style={{ marginTop: 10 }} onClick={() => setSecret(null)}>
              I have passed it on
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="chd">
          <h3>Create an account</h3>
          <span className="m">a temporary password is issued and must be changed on first use</span>
        </div>
        <div className="cbd">
          <div className="grid2">
            <div className="field">
              <label htmlFor="email">Work email</label>
              <input
                id="email"
                type="email"
                style={{ width: "100%" }}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@dxg.live"
              />
            </div>
            <div className="field">
              <label htmlFor="name">Name</label>
              <input
                id="name"
                style={{ width: "100%" }}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="D. Ruiz"
              />
            </div>
          </div>
          <button
            className="btn pri"
            disabled={busy || !email}
            onClick={() =>
              void run(async () => {
                const created = await createStaff(email, name);
                if (created.temporary_password) {
                  setSecret({
                    title: `Temporary password for ${name || email}`,
                    value: created.temporary_password,
                    note: "Give this to them directly. They must change it when they first sign in, and set up an authenticator before they can do anything else.",
                  });
                }
                setEmail("");
                setName("");
              })
            }
          >
            Create account
          </button>
        </div>
      </div>

      {/*
        Assignments, read the way an administrator staffing an event asks for them.
        The account rows below answer the other question — what one person can reach.
      */}
      {view === "event" && (
        <div className="card">
          <div className="chd">
            <h3>Event assignments</h3>
            <span className="m">
              who works which event, and as what
              <button
                className="btn"
                style={{ padding: "2px 8px", fontSize: 12, marginLeft: 10 }}
                onClick={() => setView("person")}
              >
                manage accounts ›
              </button>
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
                        people.map(({ person, role }) => (
                          <div key={`${person.id}-${role}`} style={{ marginBottom: 3 }}>
                            <span style={{ display: "inline-block", minWidth: 150 }}>
                              {person.display_name}
                            </span>
                            <span className="chip c-mut">{role.replace(/_/g, " ")}</span>{" "}
                            {!person.is_active && <Chip status="attention" label="deactivated" />}
                            {person.is_active && !person.mfa_enrolled && (
                              <Chip status="needs_revision" label="2FA not set up" />
                            )}{" "}
                            <button
                              className="btn"
                              style={{ padding: "1px 7px", fontSize: 11 }}
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await setStaffRole(person.id, event.id, role, false);
                                })
                              }
                            >
                              remove
                            </button>
                          </div>
                        ))
                      )}

                      {/*
                        Assigning happens here rather than on the account rows: this is
                        where the question is being asked, and the event is already
                        decided by which row you are on — so it cannot be got wrong by
                        leaving a dropdown on its default.
                      */}
                      <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
                        <select
                          id={`who-${event.id}`}
                          defaultValue=""
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
                        <select
                          id={`as-${event.id}`}
                          defaultValue=""
                          style={{ fontSize: 12, padding: "3px 6px" }}
                        >
                          <option value="">as…</option>
                          {EVENT_ROLE_NAMES.map((role) => (
                            <option key={role} value={role}>
                              {role.replace(/_/g, " ")}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn"
                          style={{ padding: "2px 8px", fontSize: 12 }}
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const who = (document.getElementById(`who-${event.id}`) as HTMLSelectElement)
                                .value;
                              const as = (document.getElementById(`as-${event.id}`) as HTMLSelectElement)
                                .value;
                              if (!who) throw new ApiError("request", "Pick who to assign.", 400);
                              if (!as) throw new ApiError("request", "Pick which role they hold.", 400);
                              await setStaffRole(who, event.id, as, true);
                            })
                          }
                        >
                          assign
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="chd">
          <h3>Accounts · {initial.length}</h3>
          <span className="m">
            {view === "person" ? (
              <>
                passwords, authenticators, access
                <button
                  className="btn"
                  style={{ padding: "2px 8px", fontSize: 12, marginLeft: 10 }}
                  onClick={() => setView("event")}
                >
                  ‹ event assignments
                </button>
              </>
            ) : (
              "passwords, authenticators, access"
            )}
          </span>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Roles</th>
                <th>Status</th>
                <th>Last sign-in</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {initial.map((user) => (
                <tr key={user.id}>
                  <td>
                    <b>{user.display_name}</b>
                    <br />
                    <span className="note mono">{user.email}</span>
                  </td>
                  {/*
                    Read-only here, on purpose. Assigning someone to an event is a
                    different job from administering their account, and cramming both
                    into one cell put two dropdowns and a button on every row — the
                    editing controls outnumbered the facts they were editing. The
                    assignment work now lives in the event view above, where the
                    question "who is on this event?" is actually being asked.
                  */}
                  <td>
                    {user.roles.length === 0 ? (
                      <span className="chip c-warn">no event — cannot use the platform</span>
                    ) : (
                      <>
                        {user.roles.map((role) => (
                          <div key={`${role.event_id}-${role.role}`} className="note">
                            {role.event_name} · <strong>{role.role.replace(/_/g, " ")}</strong>
                          </div>
                        ))}
                        <button
                          className="btn"
                          style={{ padding: "1px 7px", fontSize: 11, marginTop: 4 }}
                          onClick={() => setView("event")}
                        >
                          change assignments
                        </button>
                      </>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {!user.is_active && <Chip status="attention" label="deactivated" />}
                    {user.is_active && user.mfa_enrolled && <Chip status="synchronized_onsite" label="2FA on" />}
                    {user.is_active && !user.mfa_enrolled && <Chip status="needs_revision" label="2FA not set up" />}
                    {user.must_change_password && (
                      <>
                        <br />
                        <span className="note">temporary password</span>
                      </>
                    )}
                    {user.locked_until && new Date(user.locked_until) > new Date() && (
                      <>
                        <br />
                        <span className="chip c-bad">locked</span>
                      </>
                    )}
                    {user.mfa_enrolled && (
                      <>
                        <br />
                        <span className="note">{user.recovery_codes_left} recovery codes left</span>
                      </>
                    )}
                  </td>
                  <td className="note">{when(user.last_sign_in)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button
                      className="btn"
                      style={{ padding: "3px 9px", fontSize: 12 }}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const result = await resetStaffPassword(user.id);
                          setSecret({
                            title: `New temporary password for ${user.display_name}`,
                            value: result.temporary_password,
                            note: "Their existing sessions have been ended. They must change this when they next sign in.",
                          });
                        })
                      }
                    >
                      reset password
                    </button>{" "}
                    <button
                      className="btn warnb"
                      style={{ padding: "3px 9px", fontSize: 12 }}
                      disabled={busy || !user.mfa_enrolled}
                      title="Only after verifying who is asking — this turns a lost phone back into an open door"
                      onClick={() =>
                        void run(async () => {
                          const reason = window.prompt(
                            `Reset ${user.display_name}'s authenticator — who asked, and how did you verify them?`,
                            "",
                          );
                          if (reason === null) return;
                          await resetStaffMfa(user.id, reason);
                        })
                      }
                    >
                      reset 2FA
                    </button>{" "}
                    {user.locked_until && new Date(user.locked_until) > new Date() && (
                      <button
                        className="btn"
                        style={{ padding: "3px 9px", fontSize: 12 }}
                        disabled={busy}
                        onClick={() => void run(async () => void (await unlockStaff(user.id)))}
                      >
                        unlock
                      </button>
                    )}{" "}
                    <button
                      className={user.is_active ? "btn danger" : "btn"}
                      style={{ padding: "3px 9px", fontSize: 12 }}
                      disabled={busy}
                      onClick={() => void run(async () => void (await setStaffActive(user.id, !user.is_active)))}
                    >
                      {user.is_active ? "deactivate" : "reactivate"}
                    </button>
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
