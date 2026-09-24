"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { DuplicatePair, SpeakerRow } from "@/lib/api";
import {
  getSpeakers,
  mergeSpeakers,
  inviteSpeaker,
  remindSpeakersWithoutFiles,
  addSpeaker,
  sendUploadLink,
  ApiError,
} from "@/lib/api";
import { Chip } from "@/components/Chip";
import { Icon } from "@/components/Icon";
import { HoverTip } from "@/components/HoverTip";

/** Screen 5 — the speaker directory, its duplicates, and the chase list. */
export function SpeakersView({
  eventId,
  initial,
  duplicates,
  talks,
}: {
  eventId: string;
  initial: SpeakerRow[];
  duplicates: DuplicatePair[];
  /** Talks a new speaker can be assigned to straight away. */
  talks: { slot_id: string; label: string }[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  // The one row action in flight, as `${speakerId}:send|copy`. Per row rather than the
  // screen-wide `busy`, so copying one link does not disable and redraw every button.
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // The server component re-renders on refresh; the list here is client state, so a
  // new speaker is fetched rather than waiting on a prop that `useState` would ignore.
  async function reload() {
    const { items } = await getSpeakers(eventId, query);
    setRows(items);
  }

  async function search(next: string) {
    setQuery(next);
    try {
      const { items } = await getSpeakers(eventId, next);
      setRows(items);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Search failed.");
    }
  }

  const missing = rows.filter((row) => row.with_files === 0);

  async function emailLink(row: SpeakerRow) {
    setPending(`${row.id}:send`);
    setError(null);
    setToast(null);
    try {
      const sent = await sendUploadLink(eventId, row.id);
      setToast(`Upload link emailed to ${sent.to}`);
      await reload();
      // The dispatcher picks it up within a second or two; show "sent" when it has.
      setTimeout(() => void reload().catch(() => undefined), 2500);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "The email could not be sent.",
      );
    } finally {
      setPending(null);
    }
  }

  function statusOf(row: SpeakerRow): { status: string; label: string } {
    if (row.talks === 0) return { status: "canceled", label: "No talks" };
    if (row.with_files === 0)
      return { status: "missing", label: "Not submitted" };
    if (row.approved >= row.talks)
      return { status: "synchronized_onsite", label: "Approved" };
    return { status: "submitted", label: "Submitted" };
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <h1 className="htitle" style={{ margin: 0 }}>
          Speakers · {rows.length}
        </h1>
        <span style={{ display: "flex", gap: 8 }}>
          {/*
            It sends now. This said "Reminder queued to the N speakers without a
            file" and queued nothing — the handler only set the toast — so the one
            thing on the screen that claimed an action had happened was the one thing
            that had not. It reports what actually happened instead, including the
            recipients the send refused and why.
          */}
          <button
            className="btn"
            disabled={busy || missing.length === 0}
            onClick={() => {
              setBusy(true);
              setError(null);
              setToast(null);
              void (async () => {
                try {
                  const result = await remindSpeakersWithoutFiles(eventId);
                  const skipped = result.skipped
                    .map((entry) => `${entry.count} ${entry.reason}`)
                    .join(" · ");
                  setToast(
                    result.queued === 0 && skipped
                      ? `Nobody was emailed — ${skipped}`
                      : `Reminder sent to ${result.queued} speaker${result.queued === 1 ? "" : "s"}` +
                          (skipped ? ` · skipped: ${skipped}` : ""),
                  );
                  // The log and the delivery counters live on Communications.
                  router.refresh();
                } catch (caught) {
                  setError(
                    caught instanceof ApiError
                      ? caught.message
                      : "The reminder could not be sent.",
                  );
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            Bulk remind ({missing.length})
          </button>
          <button
            className="btn pri"
            disabled={busy}
            onClick={() => setAdding(true)}
          >
            + Add speaker
          </button>
        </span>
      </div>

      {error && <div className="err">{error}</div>}

      {duplicates.length > 0 && (
        <div className="card" style={{ borderColor: "var(--warn)" }}>
          <div className="chd">
            <h3>Possible duplicates · {duplicates.length}</h3>
            <span className="m">
              merging preserves both file histories and every assignment
            </span>
          </div>
          <div className="cbd" style={{ padding: "0 0 4px" }}>
            <table>
              <tbody>
                {duplicates.map((pair) => (
                  <tr key={`${pair.a_id}-${pair.b_id}`}>
                    <td>
                      <b>{pair.a_name}</b>{" "}
                      <span className="note">{pair.a_email}</span>
                      {" ↔ "}
                      <b>{pair.b_name}</b>{" "}
                      <span className="note">{pair.b_email}</span>
                      <br />
                      <span className="note">matched on {pair.reason}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => {
                          setBusy(true);
                          void mergeSpeakers(pair.b_id, pair.a_id)
                            .then(() => {
                              setToast(
                                `Merged into ${pair.a_name} — assignments and history preserved`,
                              );
                              router.refresh();
                            })
                            .catch((caught: unknown) =>
                              setError(
                                caught instanceof ApiError
                                  ? caught.message
                                  : "Merge failed.",
                              ),
                            )
                            .finally(() => setBusy(false));
                        }}
                      >
                        Merge into {pair.a_name}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="cbd" style={{ borderBottom: "1px solid var(--line)" }}>
          <input
            style={{ width: "100%" }}
            placeholder={`Search ${initial.length} speakers by name, organization or email…`}
            value={query}
            onChange={(event) => void search(event.target.value)}
          />
        </div>
        <div className="cbd" style={{ padding: "0 0 4px", overflowX: "auto" }}>
          {rows.length === 0 ? (
            <div className="empty">No speaker matches “{query}”.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Speaker</th>
                  <th>Organization</th>
                  <th>Talks</th>
                  <th>Status</th>
                  <th>Upload link</th>
                  <th style={{ textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const status = statusOf(row);
                  return (
                    <tr key={row.id}>
                      <td>
                        <b>{row.full_name}</b>
                        <br />
                        <span
                          className="note mono"
                          style={{ overflowWrap: "anywhere" }}
                        >
                          {row.email ?? "no email"}
                        </span>
                      </td>
                      <td>{row.organization ?? "—"}</td>
                      <td className="num">{row.talks}</td>
                      <td>
                        <Chip status={status.status} label={status.label} />
                      </td>
                      <td>
                        <EmailStatus email={row.last_email} />
                      </td>
                      <td>
                        <span
                          style={{
                            display: "flex",
                            flexWrap: "nowrap",
                            justifyContent: "flex-end",
                            gap: 6,
                          }}
                        >
                          {/* Emailed once, never again (D-086): once sent, the send action is gone. */}
                          {!emailedAlready(row) &&
                            (() => {
                              const label = !row.email
                                ? "Add an email address first"
                                : row.talks === 0
                                  ? "Assign a presentation first"
                                  : "Email upload link";
                              return (
                                <HoverTip label={label}>
                                  <button
                                    className="btn"
                                    style={ICON_BUTTON}
                                    disabled={
                                      pending === `${row.id}:send` ||
                                      !row.email ||
                                      row.talks === 0
                                    }
                                    aria-label={label}
                                    onClick={() => void emailLink(row)}
                                  >
                                    <Icon name="send" />
                                  </button>
                                </HoverTip>
                              );
                            })()}
                          <HoverTip label="Copy upload link">
                            <button
                              className="btn"
                              style={ICON_BUTTON}
                              disabled={pending === `${row.id}:copy`}
                              aria-label={`Copy upload link for ${row.full_name}`}
                              onClick={() => {
                                setPending(`${row.id}:copy`);
                                void inviteSpeaker(row.id)
                                  .then(async (invite) => {
                                    try {
                                      await navigator.clipboard.writeText(
                                        invite.url,
                                      );
                                      setToast(
                                        `Link copied for ${row.full_name}`,
                                      );
                                    } catch {
                                      setToast(`Upload link · ${invite.url}`);
                                    }
                                  })
                                  .catch(() =>
                                    setError("Could not issue a link."),
                                  )
                                  .finally(() => setPending(null));
                              }}
                            >
                              <Icon name="clipboard" />
                            </button>
                          </HoverTip>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {adding && (
        <AddSpeakerDialog
          eventId={eventId}
          talks={talks}
          onClose={() => setAdding(false)}
          onAdded={(message) => {
            setAdding(false);
            setError(null);
            setToast(message);
            void reload().catch(() => undefined);
            router.refresh();
          }}
        />
      )}

      <div
        className={`toast ${toast ? "show" : ""}`}
        style={{ maxWidth: "80vw" }}
      >
        {toast}
      </div>
    </>
  );
}

function AddSpeakerDialog({
  eventId,
  talks,
  onClose,
  onAdded,
}: {
  eventId: string;
  talks: { slot_id: string; label: string }[];
  onClose: () => void;
  onAdded: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [slotId, setSlotId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [saving, onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("A speaker needs a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await addSpeaker(eventId, {
        name: name.trim(),
        email: email.trim(),
        organization: organization.trim(),
        ...(slotId ? { slot_id: slotId } : {}),
      });
      const talk = talks.find((candidate) => candidate.slot_id === slotId);
      onAdded(
        result.created
          ? `${name.trim()} added${talk ? ` to ${talk.label}` : ""}`
          : `${name.trim()} was already on this event — now on ${talk?.label ?? "that talk"} too`,
      );
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "The speaker could not be added.",
      );
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add speaker"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8,12,20,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        zIndex: 50,
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <form
        className="card"
        style={{ maxWidth: 460, width: "100%" }}
        onSubmit={(event) => void submit(event)}
      >
        <div className="chd">
          <h3>Add speaker</h3>
        </div>
        <div className="cbd">
          {error && <div className="err">{error}</div>}
          <div className="field">
            <label htmlFor="new-speaker-name">Full name</label>
            <input
              id="new-speaker-name"
              style={{ width: "100%" }}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label htmlFor="new-speaker-email">Email</label>
            <input
              id="new-speaker-email"
              type="email"
              style={{ width: "100%" }}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Needed to send an upload link"
            />
          </div>
          <div className="field">
            <label htmlFor="new-speaker-org">Organization</label>
            <input
              id="new-speaker-org"
              style={{ width: "100%" }}
              value={organization}
              onChange={(event) => setOrganization(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="new-speaker-talk">Presentation</label>
            <select
              id="new-speaker-talk"
              style={{ width: "100%" }}
              value={slotId}
              onChange={(event) => setSlotId(event.target.value)}
            >
              <option value="">Not assigned yet</option>
              {talks.map((talk) => (
                <option key={talk.slot_id} value={talk.slot_id}>
                  {talk.label}
                </option>
              ))}
            </select>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              marginTop: 4,
            }}
          >
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" className="btn pri" disabled={saving}>
              {saving ? "Adding…" : "Add speaker"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

/**
 * The upload link is emailed once per speaker (D-086). Only an email that failed before
 * leaving leaves the button live; the server enforces the same rule.
 */
const emailedAlready = (row: SpeakerRow) =>
  row.last_email && row.last_email.status !== "failed" ? row.last_email : null;

const ICON_BUTTON: React.CSSProperties = {
  width: 32,
  height: 32,
  padding: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

function EmailStatus({ email }: { email: SpeakerRow["last_email"] }) {
  if (!email) return <span className="note">Not sent</span>;
  const tone: Record<string, string> = {
    queued: "submitted",
    sent: "submitted",
    delivered: "synchronized_onsite",
    opened: "synchronized_onsite",
    clicked: "synchronized_onsite",
    bounced: "missing",
    complained: "missing",
    failed: "missing",
  };
  const label = email.status.charAt(0).toUpperCase() + email.status.slice(1);
  return <Chip status={tone[email.status] ?? "submitted"} label={label} />;
}
