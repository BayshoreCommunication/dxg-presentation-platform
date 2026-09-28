"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { DuplicatePair, ReleasePermission, SpeakerRow } from "@/lib/api";
import {
  getSpeakers,
  mergeSpeakers,
  inviteSpeaker,
  remindSpeakersWithoutFiles,
  addSpeaker,
  sendUploadLink,
  setReleasePermission,
  removeSpeaker,
  updateSpeakerEmail,
  ApiError,
} from "@/lib/api";
import { Chip } from "@/components/Chip";
import { Icon } from "@/components/Icon";
import { InfoTip } from "@/components/InfoTip";
import { HoverTip } from "@/components/HoverTip";
import { WhyNot } from "@/components/WhyNot";
import { EMAIL_STATUS, wordsFor } from "@pmp/format";

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
  const [removing, setRemoving] = useState<SpeakerRow | null>(null);
  const [mergeAsk, setMergeAsk] = useState<string | null>(null);
  const [editingEmail, setEditingEmail] = useState<{ row: SpeakerRow; value: string } | null>(null);

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

  // Anyone with a presentation still missing a file — what "Remind speakers missing files" chases.
  // Counted over the whole event, not the search results: the send goes to everyone (D-111).
  const missing = initial.filter(
    (row) => row.talks > 0 && row.talks_with_files < row.talks,
  );

  // What the archive may share for this speaker (D-089). Until it is set, their
  // presentations are left out of the client's package.
  async function changeRelease(row: SpeakerRow, value: ReleasePermission) {
    const before = row.release_permission;
    setPending(`${row.id}:release`);
    setError(null);
    setRows((current) =>
      current.map((item) =>
        item.id === row.id ? { ...item, release_permission: value } : item,
      ),
    );
    try {
      await setReleasePermission(eventId, row.id, value);
      setToast(
        `${row.full_name}: ${RELEASE_OPTIONS.find(([key]) => key === value)?.[1] ?? value}`,
      );
    } catch (caught) {
      setRows((current) =>
        current.map((item) =>
          item.id === row.id ? { ...item, release_permission: before } : item,
        ),
      );
      setError(
        caught instanceof ApiError
          ? caught.message
          : "The release permission could not be saved.",
      );
    } finally {
      setPending(null);
    }
  }

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
    if (row.talks === 0)
      return { status: "canceled", label: "No presentations" };
    if (row.talks_with_files === 0)
      return { status: "missing", label: "Not submitted" };
    // Sent back by a reviewer (D-090) — the portal says "Needs revision", so this does too.
    if (row.talks_needing_revision > 0) {
      return {
        status: "needs_revision",
        label:
          row.talks > 1
            ? `${row.talks_needing_revision} of ${row.talks} need revision`
            : "Needs revision",
      };
    }
    // Some presentations have a file and some do not (D-087) — "Submitted" hid the gap.
    if (row.talks_with_files < row.talks) {
      return {
        status: "needs_revision",
        label: `${row.talks_with_files} of ${row.talks} submitted`,
      };
    }
    if (row.talks_approved >= row.talks)
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
        {/* D-111, S30: the reminder button's reason sits under the button row. */}
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
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
              Remind speakers missing files ({missing.length})
            </button>
            <button
              className="btn pri"
              disabled={busy}
              onClick={() => setAdding(true)}
            >
              + Add speaker
            </button>
          </span>
          <WhyNot
            reason={
              missing.length > 0 ? null : "Nobody to remind — every speaker with a presentation has sent a file."
            }
          />
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
                      {/* Merging asks which record to keep and says what it does (D-108): it
                          used to run on one click, always keeping the first. */}
                      {mergeAsk === `${pair.a_id}-${pair.b_id}` ? (
                        <span style={{ display: "inline-flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                          <span className="note" style={{ maxWidth: 320, textAlign: "right" }}>
                            Which record should stay? The other one&rsquo;s talks and history move across, and its
                            upload link stops working.
                          </span>
                          <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            {[
                              { keep: pair.a_id, keepName: pair.a_name, drop: pair.b_id },
                              { keep: pair.b_id, keepName: pair.b_name, drop: pair.a_id },
                            ].map((choice) => (
                              <button
                                key={choice.keep}
                                className="btn"
                                disabled={busy}
                                onClick={() => {
                                  setBusy(true);
                                  void mergeSpeakers(choice.drop, choice.keep)
                                    .then(() => {
                                      setMergeAsk(null);
                                      setToast(`Merged into ${choice.keepName} — talks and history kept`);
                                      router.refresh();
                                    })
                                    .catch((caught: unknown) =>
                                      setError(caught instanceof ApiError ? caught.message : "Merge failed."),
                                    )
                                    .finally(() => setBusy(false));
                                }}
                              >
                                Keep {choice.keepName}
                              </button>
                            ))}
                            <button className="btn" onClick={() => setMergeAsk(null)}>
                              Cancel
                            </button>
                          </span>
                        </span>
                      ) : (
                        <button className="btn" disabled={busy} onClick={() => setMergeAsk(`${pair.a_id}-${pair.b_id}`)}>
                          Merge…
                        </button>
                      )}
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
                  <th>Presentations</th>
                  <th>Status</th>
                  <th style={{ whiteSpace: "nowrap" }}>
                    Archive permission
                    <InfoTip label="Archive permission" align="right">
                      What this speaker agreed the client may keep after the
                      event. Full release: the PowerPoint and a PDF go into the
                      post-event archive. PDF only: just the PDF. No release, or
                      Not set: their presentations are left out. For a shared
                      talk the strictest speaker&rsquo;s choice applies.
                    </InfoTip>
                  </th>
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
                        {/* Organization sits under the name: its own column pushed the table wider than the card. */}
                        {row.organization && (
                          <>
                            <br />
                            <span className="note">{row.organization}</span>
                          </>
                        )}
                        <br />
                        <span
                          className="note mono"
                          style={{ overflowWrap: "anywhere" }}
                        >
                          {row.email ?? "no email"}
                        </span>
                      </td>
                      <td className="num">{row.talks}</td>
                      <td>
                        <Chip status={status.status} label={status.label} />
                      </td>
                      <td>
                        <select
                          aria-label={`Archive permission for ${row.full_name}`}
                          value={row.release_permission}
                          disabled={pending === `${row.id}:release`}
                          style={{ minWidth: 0, maxWidth: 124 }}
                          onChange={(event) =>
                            void changeRelease(
                              row,
                              event.target.value as ReleasePermission,
                            )
                          }
                        >
                          {RELEASE_OPTIONS.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
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
                                    <Icon name="send" /> Email link
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
                              <Icon name="clipboard" /> Copy link
                            </button>
                          </HoverTip>
                          <HoverTip label="Edit email">
                            <button
                              className="btn"
                              style={ICON_BUTTON}
                              aria-label={`Edit email for ${row.full_name}`}
                              onClick={() => setEditingEmail({ row, value: row.email ?? "" })}
                            >
                              <Icon name="mail" /> Edit email
                            </button>
                          </HoverTip>
                          <HoverTip label="Remove speaker">
                            <button
                              className="btn"
                              style={ICON_BUTTON}
                              disabled={pending === `${row.id}:remove`}
                              aria-label={`Remove ${row.full_name} from this event`}
                              onClick={() => setRemoving(row)}
                            >
                              <Icon name="trash" /> Remove
                            </button>
                          </HoverTip>
                        </span>
                        {/* D-111: why "Email link" is greyed, on the page and with the way round it. */}
                        {!emailedAlready(row) && (
                          <WhyNot
                            reason={
                              !row.email
                                ? "No email address yet — use Edit email to add one."
                                : row.talks === 0
                                  ? "Not on a presentation yet — add them to one on the event's Agenda tab first."
                                  : null
                            }
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Correcting an address (D-108): a bounced email was a dead end before. */}
      {editingEmail && (
        <div className="card" style={{ maxWidth: 560 }}>
          <div className="chd">
            <h3>Email address for {editingEmail.row.full_name}</h3>
          </div>
          <form
            className="cbd"
            onSubmit={(event) => {
              event.preventDefault();
              const who = editingEmail.row;
              setPending(`${who.id}:email`);
              setError(null);
              void updateSpeakerEmail(eventId, who.id, editingEmail.value)
                .then(({ email }) => {
                  setRows((current) => current.map((row) => (row.id === who.id ? { ...row, email } : row)));
                  setEditingEmail(null);
                  setToast(`Saved. You can now email ${who.full_name} their upload link.`);
                  router.refresh();
                })
                .catch((caught) => setError(caught instanceof ApiError ? caught.message : "Could not save the address."))
                .finally(() => setPending(null));
            }}
          >
            {editingEmail.row.last_email?.status === "bounced" && (
              <div className="note" style={{ marginBottom: 8 }}>
                The last email to {editingEmail.row.email} bounced — it couldn&rsquo;t be delivered. Check the
                spelling with the speaker.
              </div>
            )}
            <input
              type="email"
              aria-label="Email address"
              style={{ width: "100%" }}
              value={editingEmail.value}
              onChange={(event) => setEditingEmail({ ...editingEmail, value: event.target.value })}
              autoFocus
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn pri" disabled={pending === `${editingEmail.row.id}:email` || !editingEmail.value.trim()}>
                Save address
              </button>
              <button type="button" className="btn" onClick={() => setEditingEmail(null)}>
                Cancel
              </button>
            </div>
            <WhyNot reason={!editingEmail.value.trim() ? "Enter an email address to save." : null} />
          </form>
        </div>
      )}

      {removing && (
        <RemoveSpeakerDialog
          speaker={removing}
          busy={pending === `${removing.id}:remove`}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const who = removing;
            setPending(`${who.id}:remove`);
            setError(null);
            try {
              const result = await removeSpeaker(eventId, who.id);
              setRemoving(null);
              setToast(
                `${who.full_name} removed` +
                  (result.presentations > 0
                    ? ` · taken off ${result.presentations} presentation${result.presentations === 1 ? "" : "s"}`
                    : ""),
              );
              await reload();
              router.refresh();
            } catch (caught) {
              setRemoving(null);
              setError(
                caught instanceof ApiError
                  ? caught.message
                  : "The speaker could not be removed.",
              );
            } finally {
              setPending(null);
            }
          }}
        />
      )}

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
    if (!slotId) {
      setError("Choose the presentation this speaker is giving.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await addSpeaker(eventId, {
        name: name.trim(),
        email: email.trim(),
        organization: organization.trim(),
        slot_id: slotId,
      });
      const talk = talks.find((candidate) => candidate.slot_id === slotId);
      onAdded(
        result.created
          ? `${name.trim()} added to ${talk?.label ?? "the presentation"}`
          : `${name.trim()} was already on this event — now on ${talk?.label ?? "that presentation"} too`,
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
            {talks.length === 0 && (
              <div className="note" style={{ marginBottom: 6 }}>
                Add the presentation to the agenda first — a speaker is always
                added to one.
              </div>
            )}
            <select
              id="new-speaker-talk"
              style={{ width: "100%" }}
              value={slotId}
              required
              disabled={talks.length === 0}
              onChange={(event) => setSlotId(event.target.value)}
            >
              {/* Required (D-095): a speaker is added to a presentation. */}
              <option value="" disabled>
                {talks.length === 0
                  ? "No presentations on the agenda yet"
                  : "Choose a presentation…"}
              </option>
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
            <button
              type="submit"
              className="btn pri"
              disabled={saving || !slotId}
            >
              {saving ? "Adding…" : "Add speaker"}
            </button>
          </div>
          {/* D-111. With no presentations at all, the note above the list already says why. */}
          <WhyNot
            reason={!slotId && talks.length > 0 ? "Choose the presentation this speaker gives to continue." : null}
          />
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
  // A bounced link can be sent again once the address is corrected (D-108).
  row.last_email && !["failed", "bounced"].includes(row.last_email.status) ? row.last_email : null;

/** What the archive may share (FR-SPK-003); "Not set" leaves the speaker's talks out. */
const RELEASE_OPTIONS: [ReleasePermission, string][] = [
  ["undecided", "Not set"],
  ["full", "Full release"],
  ["pdf_only", "PDF only"],
  ["none", "No release"],
];

/** Icon plus a short word (S31, D-110): icon-only actions left staff guessing. */
const ICON_BUTTON: React.CSSProperties = {
  height: 32,
  padding: "0 10px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  whiteSpace: "nowrap",
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
    suppressed: "missing",
  };
  // In staff words from EMAIL_STATUS (D-108, S31, D-110): "Complained" and "Queued" meant
  // nothing to anyone. A problem status carries its next step underneath.
  const words = wordsFor(EMAIL_STATUS, email.status);
  return (
    <span title={words.meaning || undefined}>
      <Chip status={tone[email.status] ?? "submitted"} label={words.label} />
      {words.next && <div className="note">{words.next}</div>}
    </span>
  );
}

/**
 * Confirms removing a speaker (D-095), saying what it does. Asked on the page, not with
 * `window.confirm`, which the desktop app's browser dismisses unseen (D-073).
 */
function RemoveSpeakerDialog({
  speaker,
  busy,
  onClose,
  onConfirm,
}: {
  speaker: SpeakerRow;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [busy, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Remove ${speaker.full_name}`}
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
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="card" style={{ maxWidth: 460, width: "100%" }}>
        <div className="chd">
          <h3>Remove {speaker.full_name}?</h3>
        </div>
        <div className="cbd">
          <p style={{ marginTop: 0 }}>
            {speaker.full_name} will be taken off{" "}
            {speaker.talks === 1
              ? "their presentation"
              : `their ${speaker.talks} presentations`}{" "}
            and removed from this event. Their upload link and access code stop
            working at once.
          </p>
          <p className="note">
            Files they uploaded stay with the presentations, and emails already
            sent stay in the delivery log.
          </p>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              marginTop: 12,
            }}
          >
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={onClose}
              autoFocus
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn warnb"
              disabled={busy}
              onClick={() => void onConfirm()}
            >
              {busy ? "Removing…" : "Remove speaker"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
