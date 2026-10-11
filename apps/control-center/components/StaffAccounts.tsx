"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AccountType, StaffRow } from "@/lib/api";
import {
  createStaff,
  deleteStaff,
  resetStaffPassword,
  resetStaffMfa,
  setStaffAccountType,
  setStaffActive,
  unlockStaff,
  ApiError,
} from "@/lib/api";
import { Chip } from "@/components/Chip";
import { WhyNot } from "@/components/WhyNot";
import { ConfirmInline } from "@/components/ConfirmInline";
import { ACCOUNT_KIND, plural, SECURITY } from "@pmp/format";
import { Icon } from "@/components/Icon";

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
 *
 * DXG Admins only (D-100; "root admin" in the code). An account is a DXG Admin (every event, every account) or
 * staff (the events it is assigned to, nothing else). Temporary passwords go to the
 * account's own email address; this screen never shows one.
 */

const ACCOUNT_TYPES: { value: AccountType; label: string; hint: string }[] = [
  { value: "support", label: ACCOUNT_KIND.support!.label, hint: ACCOUNT_KIND.support!.meaning },
  { value: "technician", label: ACCOUNT_KIND.technician!.label, hint: ACCOUNT_KIND.technician!.meaning },
  // The client's own people (the review's "Client Admin"), named "Client access" (Travis, 2026-10-11).
  { value: "client", label: ACCOUNT_KIND.client!.label, hint: ACCOUNT_KIND.client!.meaning },
  { value: "root_admin", label: ACCOUNT_KIND.root_admin!.label, hint: ACCOUNT_KIND.root_admin!.meaning },
];

const kindLabel = (type: AccountType) => ACCOUNT_KIND[type]?.label ?? type;

function TypeBadge({ type }: { type: AccountType }) {
  return <span className={`chip ${type === "root_admin" ? "c-sync" : type === "client" ? "c-mut" : "c-info"}`}>{kindLabel(type)}</span>;
}

const small = { padding: "3px 9px", fontSize: 12 } as const;

/** Row actions that take access away or change someone's level — each asks first, under its row (D-113). */
type RowAction = "password" | "mfa" | "type" | "deactivate" | "delete";

/**
 * Why a row's buttons are greyed out, on the page (A12, D-111). Mirrors the API's own
 * refusals in services/admin.ts: no self-lockout, never lose the last active DXG
 * administrator, and nothing to reset without a sign-in app.
 */
function rowReason(user: StaffRow, isMe: boolean, lastRoot: boolean): string | null {
  const reasons: string[] = [];
  if (isMe) {
    reasons.push(
      `You can't change your own access level, deactivate or delete your own account — ask another ${SECURITY.admin}.`,
    );
  } else if (lastRoot) {
    reasons.push(
      `The only active ${SECURITY.admin} can't be changed, deactivated or deleted — make someone else a ${SECURITY.admin} first.`,
    );
  }
  if (!user.mfa_enrolled) reasons.push(`No ${SECURITY.factor} to reset — they haven't set one up yet.`);
  return reasons.length ? reasons.join(" ") : null;
}

export function StaffAccounts({ initial, me }: { initial: StaffRow[]; me: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("support");
  /** The access level being chosen for a row, before "are you sure?". */
  const [newType, setNewType] = useState<AccountType>("support");
  /** A14: the account just created, for the "assign them to an event" next step. */
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  /** The row whose "are you sure?" is open, and which action it is asking about. */
  const [asking, setAsking] = useState<{ id: string; action: RowAction } | null>(null);
  /** A11: what happens next for that person, shown under their row after a reset. */
  const [rowNotice, setRowNotice] = useState<{ id: string; text: string } | null>(null);
  /** Reset sign-in app needs a reason for the record (it used to be a window.prompt). */
  const [mfaReason, setMfaReason] = useState("");

  const ask = (id: string, action: RowAction) => {
    setAsking({ id, action });
    setRowNotice(null);
    setMfaReason("");
  };

  /** The confirmed action: call the API, then refresh the list. Errors show in the confirm box. */
  const confirmed = (work: () => Promise<void>) => async () => {
    await work();
    router.refresh();
  };

  const rootAdmins = initial.filter((user) => user.account_type === "root_admin" && user.is_active).length;

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    setCreated(null);
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
        There is no signup. Accounts are created here, and every account sets up a sign-in app on
        their phone before it can use the platform. DXG Admins see every event and every account.
        DXG Support staff run the events they are assigned to — everything except the Speaker Ready
        Room and Manage presentations; DXG Technician staff see only those two.
      </div>

      {error && <div className="err">{error}</div>}

      {notice && (
        <div className="card">
          <div className="chd">
            <h3>{notice}</h3>
            <button
              className="btn"
              style={small}
              onClick={() => {
                setNotice(null);
                setCreated(null);
              }}
            >
              dismiss
            </button>
          </div>
          {/* A14 (D-113): a new account can reach nothing until it is on an event. */}
          {created && (
            <div className="cbd">
              <Link href={`/admin/assignments?assign=${encodeURIComponent(created.id)}`} className="btn pri">
                Next: assign {created.name} to an event →
              </Link>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="chd">
          <h3>Create an account</h3>
          <span className="m">a temporary password is emailed to them and must be changed on first use</span>
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
                placeholder="Full name"
              />
            </div>
          </div>
          <div className="field" style={{ marginTop: 10 }}>
            {/* A16: "Role" is kept for event jobs; the account's own type is its access level. */}
            <label htmlFor="account-type">Access level</label>
            <select
              id="account-type"
              style={{ minWidth: 220 }}
              value={accountType}
              onChange={(event) => setAccountType(event.target.value as AccountType)}
            >
              {ACCOUNT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
            <div className="note" style={{ marginTop: 4 }}>
              {ACCOUNT_TYPES.find((type) => type.value === accountType)?.hint}
              {accountType !== "root_admin" && " Assign them to events on Event assignments after creating the account."}
            </div>
          </div>
          <button
            className="btn pri"
            style={{ marginTop: 10 }}
            disabled={busy || !email}
            onClick={() =>
              void run(async () => {
                const made = await createStaff(email, name, accountType);
                setNotice(`${kindLabel(accountType)} account created — temporary password emailed to ${made.emailed_to ?? email}.`);
                // DXG Admins already reach every event, so only staff need the next step.
                if (accountType !== "root_admin") setCreated({ id: made.user_id, name: name.trim() || email });
                setEmail("");
                setName("");
                setAccountType("support");
              })
            }
          >
            <Icon name="add" />
            Create account
          </button>
          <WhyNot reason={!email ? "Enter their work email to create the account." : null} />
        </div>
      </div>

      {/*
        Assignments, read the way an administrator staffing an event asks for them.
        The account rows below answer the other question — what one person can reach.
      */}

      <div className="card">
        <div className="chd">
          <h3>Accounts · {initial.length}</h3>
          <span className="m">
            passwords, sign-in apps, access
            <Link
              href="/admin/assignments"
              className="btn"
              style={{ padding: "2px 8px", fontSize: 12, marginLeft: 10 }}
            >
              event assignments ›
            </Link>
          </span>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Access level</th>
                <th>Status</th>
                <th>Last sign-in</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {initial.map((user) => {
                const isMe = user.id === me;
                const lastRoot = user.account_type === "root_admin" && user.is_active && rootAdmins <= 1;
                const locked = user.locked_until && new Date(user.locked_until) > new Date();
                const askingHere = asking?.id === user.id ? asking.action : null;
                return (
                  <Fragment key={user.id}>
                    <tr>
                      <td>
                        <b>{user.display_name}</b>
                        {isMe && <span className="note"> (you)</span>}
                        <br />
                        <span className="note mono">{user.email}</span>
                      </td>
                      <td>
                        <TypeBadge type={user.account_type} />
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {!user.is_active && <Chip status="attention" label="deactivated" />}
                        {/* A15: status in plain words, one security vocabulary. */}
                        {user.is_active && user.mfa_enrolled && <Chip status="synchronized_onsite" label="Sign-in app set up" />}
                        {user.is_active && !user.mfa_enrolled && <Chip status="needs_revision" label="Sign-in app not set up" />}
                        {user.must_change_password && (
                          <>
                            <br />
                            <span className="note">Must choose a password</span>
                          </>
                        )}
                        {locked && (
                          <>
                            <br />
                            <span className="chip c-bad">locked</span>
                          </>
                        )}
                        {user.mfa_enrolled && (
                          <>
                            <br />
                            <span className="note">
                              {plural(user.recovery_codes_left, "backup code")} left
                            </span>
                          </>
                        )}
                      </td>
                      <td className="note">{when(user.last_sign_in)}</td>
                      <td style={{ textAlign: "right" }}>
                        <div style={{ display: "inline-flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end" }}>
                          <button
                            className="btn"
                            style={small}
                            disabled={busy}
                            title="Emails them a new temporary password and ends their open sessions"
                            onClick={() => ask(user.id, "password")}
                          >
                            <Icon name="key" />
                            reset password
                          </button>
                          <button
                            className="btn warnb"
                            style={small}
                            disabled={busy || !user.mfa_enrolled}
                            title="Only after verifying who is asking — this turns a lost phone back into an open door"
                            onClick={() => ask(user.id, "mfa")}
                          >
                            <Icon name="refresh" />
                            reset sign-in app
                          </button>
                          {locked && (
                            <button
                              className="btn"
                              style={small}
                              disabled={busy}
                              onClick={() => void run(async () => void (await unlockStaff(user.id)))}
                            >
                              <Icon name="unlock" />
                              unlock
                            </button>
                          )}
                          <button
                            className="btn"
                            style={small}
                            disabled={busy || isMe || (user.account_type === "root_admin" && lastRoot)}
                            title="Change what this account can reach"
                            onClick={() => {
                              setNewType(user.account_type === "root_admin" ? "support" : user.account_type === "support" ? "technician" : "support");
                              ask(user.id, "type");
                            }}
                          >
                            <Icon name="edit" />
                            change access level
                          </button>
                          <button
                            className={user.is_active ? "btn danger" : "btn"}
                            style={small}
                            disabled={busy || isMe || (user.is_active && lastRoot)}
                            onClick={() =>
                              // A13 (D-113): deactivating asks first; reactivating gives access back, so it acts at once.
                              user.is_active
                                ? ask(user.id, "deactivate")
                                : void run(async () => void (await setStaffActive(user.id, true)))
                            }
                          >
                            <Icon name={user.is_active ? "pause" : "play"} />
                            {user.is_active ? "deactivate" : "reactivate"}
                          </button>
                          <button
                            className="btn danger"
                            style={small}
                            disabled={busy || isMe || lastRoot}
                            title="Removes the account and its event access; the record of what they did is kept"
                            onClick={() => ask(user.id, "delete")}
                          >
                            <Icon name="trash" />
                            delete
                          </button>
                        </div>
                        <WhyNot reason={rowReason(user, isMe, lastRoot)} />
                      </td>
                    </tr>
                    {/* D-113: the "are you sure?" and what happens next sit under the row they belong to. */}
                    {(askingHere || rowNotice?.id === user.id) && (
                      <tr>
                        <td colSpan={5} style={{ borderTop: "none", paddingTop: 0 }}>
                          {rowNotice?.id === user.id && !askingHere && (
                            <div className="confirm-inline">
                              <b>{rowNotice.text}</b>
                              <div className="confirm-inline-actions">
                                <button type="button" className="btn" style={small} onClick={() => setRowNotice(null)}>
                                  dismiss
                                </button>
                              </div>
                            </div>
                          )}
                          {askingHere === "password" && (
                            <ConfirmInline
                              question={`Email ${user.display_name} a new temporary password?`}
                              detail="Their open sessions end at once, and they must choose a new password when they next sign in. Their sign-in app stays as it is."
                              confirmLabel="Send new password"
                              icon="key"
                              busyLabel="Sending…"
                              onConfirm={confirmed(async () => {
                                const result = await resetStaffPassword(user.id);
                                // A11: say what happens next for them.
                                setRowNotice({
                                  id: user.id,
                                  text: `New temporary password emailed to ${result.emailed_to}. ${user.display_name} has been signed out; next time they sign in with it, they'll choose their own password, then enter their sign-in app code as usual.`,
                                });
                              })}
                              onClose={() => setAsking(null)}
                            />
                          )}
                          {askingHere === "mfa" && (
                            <>
                              <div className="field" style={{ margin: "8px 0 0" }}>
                                <label htmlFor={`mfa-reason-${user.id}`}>
                                  Who asked, and how did you check it was them?
                                </label>
                                <input
                                  id={`mfa-reason-${user.id}`}
                                  style={{ width: "100%", maxWidth: 520 }}
                                  value={mfaReason}
                                  onChange={(event) => setMfaReason(event.target.value)}
                                  placeholder="e.g. They phoned from their usual number and I recognised their voice"
                                />
                              </div>
                              <ConfirmInline
                                question={`Reset ${user.display_name}'s sign-in app?`}
                                detail="Only do this after checking it really is them — until they set up a new one, their password alone gets them in. Their open sessions end and their backup codes stop working."
                                confirmLabel="Reset sign-in app"
                                icon="refresh"
                                busyLabel="Resetting…"
                                danger
                                onConfirm={confirmed(async () => {
                                  if (!mfaReason.trim()) throw new Error("Say who asked and how you checked it was them.");
                                  await resetStaffMfa(user.id, mfaReason.trim());
                                  // A11 / D-108: it used to succeed silently.
                                  setRowNotice({
                                    id: user.id,
                                    text: `${user.display_name}'s sign-in app was removed and they have been signed out. Next time they sign in, they'll scan a new code with their phone and get new backup codes.`,
                                  });
                                })}
                                onClose={() => setAsking(null)}
                              />
                            </>
                          )}
                          {askingHere === "type" && (
                            <>
                              <div className="field" style={{ margin: "8px 0 0" }}>
                                <label htmlFor={`type-${user.id}`}>New access level for {user.display_name}</label>
                                <select
                                  id={`type-${user.id}`}
                                  style={{ minWidth: 220 }}
                                  value={newType}
                                  onChange={(event) => setNewType(event.target.value as AccountType)}
                                >
                                  {ACCOUNT_TYPES.filter((type) => type.value !== user.account_type).map((type) => (
                                    <option key={type.value} value={type.value}>
                                      {type.label}
                                    </option>
                                  ))}
                                </select>
                                <div className="note" style={{ marginTop: 4 }}>
                                  {ACCOUNT_TYPES.find((type) => type.value === newType)?.hint}
                                </div>
                              </div>
                              <ConfirmInline
                                question={`Make ${user.display_name} ${kindLabel(newType)}?`}
                                detail={
                                  newType === "root_admin"
                                    ? "They will see every event and every account, and can create, reset and delete accounts."
                                    : `They keep the events they are assigned to, as ${kindLabel(newType)}. The change applies at their next sign-in.`
                                }
                                confirmLabel={`Make ${kindLabel(newType)}`}
                                icon="edit"
                                busyLabel="Saving…"
                                danger={user.account_type === "root_admin"}
                                onConfirm={confirmed(async () => {
                                  await setStaffAccountType(user.id, newType);
                                })}
                                onClose={() => setAsking(null)}
                              />
                            </>
                          )}
                          {askingHere === "deactivate" && (
                            <ConfirmInline
                              question={`Deactivate ${user.display_name}?`}
                              detail="They are signed out and can't sign in until reactivated; their history and event assignments are kept."
                              confirmLabel="Deactivate"
                              icon="pause"
                              busyLabel="Deactivating…"
                              danger
                              onConfirm={confirmed(async () => void (await setStaffActive(user.id, false)))}
                              onClose={() => setAsking(null)}
                            />
                          )}
                          {askingHere === "delete" && (
                            <ConfirmInline
                              question={`Delete ${user.display_name} (${user.email})?`}
                              detail="They are signed out and lose access to every event. This can't be undone, but the record of what they did is kept and the email address can be invited again later."
                              confirmLabel="Delete account"
                              icon="trash"
                              busyLabel="Deleting…"
                              danger
                              onConfirm={confirmed(async () => {
                                await deleteStaff(user.id);
                                setNotice(`${user.display_name}'s account was deleted.`);
                              })}
                              onClose={() => setAsking(null)}
                            />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
