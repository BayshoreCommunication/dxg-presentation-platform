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
export function StaffAdmin({ initial, events }: { initial: StaffRow[]; events: EventRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ title: string; value: string; note: string } | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [eventId, setEventId] = useState(events[0]?.id ?? "");

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

      <div className="card">
        <div className="chd">
          <h3>Accounts · {initial.length}</h3>
          <span className="m">grant roles per event</span>
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
                  <td>
                    {user.roles.length === 0 ? (
                      <span className="note">no roles</span>
                    ) : (
                      user.roles.map((role) => (
                        <div key={`${role.event_id}-${role.role}`} style={{ marginBottom: 2 }}>
                          <span className="chip c-mut">{role.role.replace(/_/g, " ")}</span>{" "}
                          <span className="note">{role.event_name}</span>{" "}
                          <button
                            className="btn"
                            style={{ padding: "1px 7px", fontSize: 11 }}
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await setStaffRole(user.id, role.event_id, role.role, false);
                              })
                            }
                          >
                            remove
                          </button>
                        </div>
                      ))
                    )}
                    <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                      <select id={`role-${user.id}`} defaultValue="" style={{ fontSize: 12, padding: "3px 6px" }}>
                        <option value="">add role…</option>
                        {EVENT_ROLE_NAMES.map((role) => (
                          <option key={role} value={role}>
                            {role.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                      <select
                        id={`event-${user.id}`}
                        defaultValue={eventId}
                        onChange={(event) => setEventId(event.target.value)}
                        style={{ fontSize: 12, padding: "3px 6px" }}
                      >
                        {events.map((event) => (
                          <option key={event.id} value={event.id}>
                            {event.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn"
                        style={{ padding: "2px 8px", fontSize: 12 }}
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const role = (document.getElementById(`role-${user.id}`) as HTMLSelectElement).value;
                            const chosenEvent = (document.getElementById(`event-${user.id}`) as HTMLSelectElement)
                              .value;
                            if (!role) throw new ApiError("request", "Pick a role first.", 400);
                            await setStaffRole(user.id, chosenEvent, role, true);
                          })
                        }
                      >
                        grant
                      </button>
                    </div>
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
