"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IdentificationIcon, LifebuoyIcon, ShieldCheckIcon, WrenchScrewdriverIcon } from "@heroicons/react/24/outline";
import type { AccountType, StaffRow } from "@/lib/api";
import {
  createStaff,
  deleteStaff,
  resetStaffPassword,
  resetStaffMfa,
  setStaffName,
  setStaffAccountType,
  setStaffActive,
  unlockStaff,
  ApiError,
} from "@/lib/api";
import { WhyNot } from "@/components/WhyNot";
import { ConfirmInline } from "@/components/ConfirmInline";
import { ACCOUNT_KIND, plural, SECURITY } from "@pmp/format";
import { Icon } from "@/components/Icon";
import { SelectMenu } from "@/components/SelectMenu";

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

const ACCOUNT_TYPES: { value: AccountType; label: string; hint: string; icon: ReactNode }[] = [
  { value: "support", label: ACCOUNT_KIND.support!.label, hint: ACCOUNT_KIND.support!.meaning, icon: <LifebuoyIcon aria-hidden="true" /> },
  { value: "technician", label: ACCOUNT_KIND.technician!.label, hint: ACCOUNT_KIND.technician!.meaning, icon: <WrenchScrewdriverIcon aria-hidden="true" /> },
  // The client's own people (the review's "Client Admin"), named "Client access" (Travis, 2026-10-11).
  { value: "client", label: ACCOUNT_KIND.client!.label, hint: ACCOUNT_KIND.client!.meaning, icon: <IdentificationIcon aria-hidden="true" /> },
  { value: "root_admin", label: ACCOUNT_KIND.root_admin!.label, hint: ACCOUNT_KIND.root_admin!.meaning, icon: <ShieldCheckIcon aria-hidden="true" /> },
];

const kindLabel = (type: AccountType) => ACCOUNT_KIND[type]?.label ?? type;

function TypeBadge({ type }: { type: AccountType }) {
  return (
    <span className="staff-access-badge">
      {ACCOUNT_TYPES.find((option) => option.value === type)?.icon}
      {kindLabel(type)}
    </span>
  );
}

const small = { padding: "3px 9px", fontSize: 12 } as const;
type AccountFilter = "all" | "active" | "deactivated";
const PAGE_SIZE = 8;

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function paginationItems(current: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = [...new Set([1, total, current - 1, current, current + 1])]
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);
  const items: Array<number | "ellipsis"> = [];
  pages.forEach((page, index) => {
    if (index > 0 && page - pages[index - 1]! > 1) items.push("ellipsis");
    items.push(page);
  });
  return items;
}

/** Row actions that take access away or change someone's level — each asks first, under its row (D-113). */
type RowAction = "name" | "password" | "mfa" | "type" | "deactivate" | "delete";

function StaffNameEditor({ user, onSaved, onCancel, onSavingChange }: {
  user: StaffRow;
  onSaved: (name: string) => void;
  onCancel: () => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const [name, setName] = useState(user.display_name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a name, not just spaces.");
      return;
    }
    setSaving(true);
    onSavingChange(true);
    setError(null);
    try {
      const result = await setStaffName(user.id, trimmed);
      onSaved(result.display_name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change the name. Please try again.");
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  }

  return (
    <form className="confirm-inline" aria-label={`Change name for ${user.display_name}`} onSubmit={(event) => void save(event)}>
      <div className="field" style={{ margin: 0 }}>
        <label htmlFor={`staff-name-${user.id}`}>Name</label>
        <input
          id={`staff-name-${user.id}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={200}
          required
          autoFocus
          disabled={saving}
          aria-invalid={Boolean(error)}
          aria-describedby={`staff-name-help-${user.id}${error ? ` staff-name-error-${user.id}` : ""}`}
          style={{ width: "100%", maxWidth: 520 }}
        />
      </div>
      <p className="note" id={`staff-name-help-${user.id}`} style={{ margin: "8px 0 0" }}>
        Only the display name changes. Email, access level and sign-in details stay the same.
      </p>
      {error && <div className="err" id={`staff-name-error-${user.id}`} role="alert" style={{ margin: "8px 0 0" }}>{error}</div>}
      <div className="confirm-inline-actions">
        <button type="submit" className="btn pri" disabled={saving || name.trim() === user.display_name}>
          <Icon name="save" />
          {saving ? "Saving…" : "Save name"}
        </button>
        <button type="button" className="btn" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AccountFilter>("all");
  const [page, setPage] = useState(1);
  const [managingId, setManagingId] = useState<string | null>(null);

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

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return initial.filter((user) => {
      if (filter === "active" && !user.is_active) return false;
      if (filter === "deactivated" && user.is_active) return false;
      if (!needle) return true;
      return [user.display_name, user.email, kindLabel(user.account_type)]
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [filter, initial, query]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const firstResult = rows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastResult = Math.min(currentPage * PAGE_SIZE, rows.length);

  const resetList = () => {
    setPage(1);
    setManagingId(null);
    setAsking(null);
    setRowNotice(null);
  };

  const goToPage = (next: number) => {
    setPage(Math.min(Math.max(next, 1), totalPages));
    setManagingId(null);
    setAsking(null);
    setRowNotice(null);
  };

  const toggleManager = (id: string) => {
    setManagingId((current) => (current === id ? null : id));
    setAsking(null);
    setRowNotice(null);
    setMfaReason("");
  };

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
        DXG Support staff run the events they are assigned to — everything there except taking in a
        speaker&rsquo;s file; DXG Technician staff work the Speaker Ready Room, Manage presentations and
        Room sync — approving, taking in files and loading the room PCs.
      </div>

      {error && <div className="err">{error}</div>}

      {notice && (
        <div className="card" role="status">
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
            <SelectMenu
              id="account-type"
              label="Access level"
              value={accountType}
              options={ACCOUNT_TYPES.map((type) => ({ value: type.value, label: type.label, icon: type.icon }))}
              onChange={setAccountType}
              className="account-type-select form-select"
            />
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

      <div className="card assignment-card staff-accounts-card">
        <div className="staff-accounts-heading">
          <div>
            <h3>Accounts</h3>
            <span>Manage names, passwords, sign-in apps and access levels.</span>
          </div>
          <Link href="/admin/assignments" className="btn staff-event-assignments">
            <Icon name="calendar" />
            Event assignments
          </Link>
        </div>

        <div className="assignment-toolbar staff-accounts-toolbar">
          <label className="assignment-search">
            <span className="sr-only">Search staff accounts</span>
            <Icon name="search" />
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); resetList(); }}
              placeholder="Search name, email or access level…"
            />
          </label>

          <div className="assignment-filters" aria-label="Filter staff accounts">
            {([ ["all", "All accounts", "users"], ["active", "Active", "checkCircle"], ["deactivated", "Deactivated", "pause"] ] as const).map(([value, label, icon]) => (
              <button
                key={value}
                type="button"
                className={filter === value ? "on" : ""}
                aria-pressed={filter === value}
                onClick={() => { setFilter(value); resetList(); }}
              >
                <Icon name={icon} size={15} />{label}
              </button>
            ))}
          </div>

          <span className="assignment-result-count">{rows.length} {rows.length === 1 ? "account" : "accounts"}</span>
        </div>

        <div className="assignment-table-wrap">
          <table className="assignment-table staff-accounts-table">
            <colgroup>
              <col className="staff-col-account" />
              <col className="staff-col-access" />
              <col className="staff-col-security" />
              <col className="staff-col-signin" />
              <col className="staff-col-action" />
            </colgroup>
            <thead>
              <tr>
                <th>Account</th>
                <th>Access level</th>
                <th>Security</th>
                <th>Last sign-in</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((user) => {
                const isMe = user.id === me;
                const lastRoot = user.account_type === "root_admin" && user.is_active && rootAdmins <= 1;
                const locked = user.locked_until && new Date(user.locked_until) > new Date();
                const askingHere = asking?.id === user.id ? asking.action : null;
                const isOpen = managingId === user.id;
                return (
                  <Fragment key={user.id}>
                    <tr className={isOpen ? "assignment-row-open" : undefined}>
                      <td>
                        <div className="staff-account-identity">
                          <span className="assignment-avatar" aria-hidden="true">{initials(user.display_name)}</span>
                          <span>
                            <strong>{user.display_name}{isMe && <em>you</em>}</strong>
                            <small>{user.email}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <TypeBadge type={user.account_type} />
                      </td>
                      <td>
                        <div className="staff-security">
                          <span className={`staff-security-status ${!user.is_active || !user.mfa_enrolled ? "attention" : ""}`}>
                            <Icon name={user.is_active && user.mfa_enrolled ? "check" : "warning"} />
                            {!user.is_active ? "Deactivated" : user.mfa_enrolled ? "Sign-in app set up" : "Setup needed"}
                          </span>
                          <small>
                            {locked
                              ? "Account locked"
                              : user.must_change_password
                                ? "Must choose a password"
                                : user.mfa_enrolled
                                  ? `${plural(user.recovery_codes_left, "backup code")} left`
                                  : "No sign-in app yet"}
                          </small>
                        </div>
                      </td>
                      <td className="staff-last-signin">{when(user.last_sign_in)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn assignment-more-button"
                          aria-label={`Manage ${user.display_name}`}
                          aria-expanded={isOpen}
                          disabled={busy}
                          onClick={() => toggleManager(user.id)}
                        >
                          <Icon name="chevronDown" size={18} />
                        </button>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr className="assignment-editor-row staff-account-editor-row">
                        <td colSpan={5}>
                          <div className="assignment-editor staff-account-editor">
                            <div className="assignment-editor-head">
                              <div>
                                <strong>Manage {user.display_name}</strong>
                                <span>Name, password, sign-in security and account access.</span>
                              </div>
                            </div>

                            <div className="staff-account-actions">
                          <button
                            className="btn"
                            style={small}
                            disabled={busy}
                            title="Change the display name without changing sign-in or access"
                            onClick={() => ask(user.id, "name")}
                          >
                            <Icon name="edit" />
                            Change name
                          </button>
                          <button
                            className="btn staff-action-security"
                            style={small}
                            disabled={busy}
                            title="Emails them a new temporary password and ends their open sessions"
                            onClick={() => ask(user.id, "password")}
                          >
                            <Icon name="key" />
                            Reset password
                          </button>
                          <button
                            className="btn warnb"
                            style={small}
                            disabled={busy || !user.mfa_enrolled}
                            title="Only after verifying who is asking — this turns a lost phone back into an open door"
                            onClick={() => ask(user.id, "mfa")}
                          >
                            <Icon name="refresh" />
                            Reset sign-in app
                          </button>
                          {locked && (
                            <button
                              className="btn good"
                              style={small}
                              disabled={busy}
                              onClick={() => void run(async () => void (await unlockStaff(user.id)))}
                            >
                              <Icon name="unlock" />
                              Unlock
                            </button>
                          )}
                          <button
                            className="btn staff-action-access"
                            style={small}
                            disabled={busy || isMe || (user.account_type === "root_admin" && lastRoot)}
                            title="Change what this account can reach"
                            onClick={() => {
                              setNewType(user.account_type === "root_admin" ? "support" : user.account_type === "support" ? "technician" : "support");
                              ask(user.id, "type");
                            }}
                          >
                            <Icon name="edit" />
                            Change access level
                          </button>
                          <button
                            className={user.is_active ? "btn warnb" : "btn good"}
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
                            {user.is_active ? "Deactivate" : "Reactivate"}
                          </button>
                          <button
                            className="btn danger"
                            style={small}
                            disabled={busy || isMe || lastRoot}
                            title="Removes the account and its event access; the record of what they did is kept"
                            onClick={() => ask(user.id, "delete")}
                          >
                            <Icon name="trash" />
                            Delete
                          </button>
                            </div>
                            <WhyNot reason={rowReason(user, isMe, lastRoot)} />

                          {/* D-113: the confirmation and outcome stay inside the account being managed. */}
                          {rowNotice?.id === user.id && !askingHere && (
                            <div className="confirm-inline" role="status">
                              <b>{rowNotice.text}</b>
                              <div className="confirm-inline-actions">
                                <button type="button" className="btn" style={small} onClick={() => setRowNotice(null)}>
                                  dismiss
                                </button>
                              </div>
                            </div>
                          )}
                          {askingHere === "name" && (
                            <StaffNameEditor
                              user={user}
                              onSaved={(name) => {
                                setAsking(null);
                                setNotice(`Name changed to ${name}.`);
                                router.refresh();
                              }}
                              onCancel={() => setAsking(null)}
                              onSavingChange={setBusy}
                            />
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
                                <SelectMenu
                                  id={`type-${user.id}`}
                                  label={`New access level for ${user.display_name}`}
                                  value={newType}
                                  options={ACCOUNT_TYPES
                                    .filter((type) => type.value !== user.account_type)
                                    .map((type) => ({ value: type.value, label: type.label, icon: type.icon }))}
                                  onChange={setNewType}
                                  className="account-type-select form-select"
                                />
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
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}

              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="assignment-no-results">
                    <Icon name="search" size={20} />
                    <strong>No accounts found</strong>
                    <span>Try a different search or status filter.</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {rows.length > 0 && (
          <div className="assignment-pagination" aria-label="Staff account pages">
            <span className="assignment-page-summary">Showing {firstResult}–{lastResult} of {rows.length}</span>
            {totalPages > 1 && (
              <div className="assignment-page-controls">
                <button type="button" className="btn assignment-page-step" disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)} aria-label="Previous page">
                  <Icon name="chevronDown" size={15} />Previous
                </button>
                <div className="assignment-page-numbers">
                  {paginationItems(currentPage, totalPages).map((item, index) => item === "ellipsis" ? (
                    <span key={`ellipsis-${index}`} aria-hidden="true">…</span>
                  ) : (
                    <button key={item} type="button" className={item === currentPage ? "on" : ""} aria-label={`Page ${item}`} aria-current={item === currentPage ? "page" : undefined} onClick={() => goToPage(item)}>{item}</button>
                  ))}
                </div>
                <button type="button" className="btn assignment-page-step" disabled={currentPage === totalPages} onClick={() => goToPage(currentPage + 1)} aria-label="Next page">
                  Next<Icon name="chevronDown" size={15} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
