"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { agendaApi, ApiError } from "@/lib/api";
import type { PresentationInput, PresenterInput, SessionInput } from "@/lib/api";
import { DateField, TimeField } from "@/components/DateTimeField";

/**
 * The forms behind the Agenda tab's edit controls (D-064). Each one saves a single
 * change straight to the event and then re-reads the page, so the agenda, the
 * speakers tab and the risk list below all show the result together.
 */

/** `HH:MM` of an instant, on the event's clock. */
export const localClock = (iso: string | null, timeZone: string): string =>
  iso
    ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone })
    : "";

/** `YYYY-MM-DD` of an instant, on the event's clock. */
export const localDate = (iso: string, timeZone: string): string =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone });

/** Busy / error bookkeeping shared by every form: run, refresh on success, show why on failure. */
function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>, onDone?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone?.();
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

const formBox: React.CSSProperties = {
  border: "1px solid var(--blue)",
  borderRadius: 6,
  padding: 12,
  margin: "8px 0",
  background: "var(--white)",
};

function Actions({
  busy,
  label,
  onCancel,
}: {
  busy: boolean;
  label: string;
  onCancel: () => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
      <button type="submit" className="btn pri" disabled={busy}>
        {busy ? "Saving…" : label}
      </button>
      <button type="button" className="btn" disabled={busy} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

export function SessionForm({
  eventId,
  window: range,
  sessionId,
  initial,
  onClose,
}: {
  eventId: string;
  window: { from: string; to: string };
  /** Given, the form edits that session; absent, it adds one. */
  sessionId?: string;
  initial?: SessionInput;
  onClose: () => void;
}) {
  const [value, setValue] = useState<SessionInput>(
    initial ?? { title: "", room: "", track: "", date: range.from, start: "09:00", end: "10:00" },
  );
  const [presenter, setPresenter] = useState<PresenterInput>({ name: "", email: "", organization: "" });
  const { busy, error, run } = useSave();
  const set = (patch: Partial<SessionInput>) => setValue((current) => ({ ...current, ...patch }));
  const adding = !sessionId;

  return (
    <form
      style={formBox}
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          () =>
            adding
              ? agendaApi.createSession(eventId, { ...value, presenter })
              : agendaApi.updateSession(eventId, sessionId, value),
          onClose,
        );
      }}
    >
      <b>{adding ? "New session" : "Edit session"}</b>
      <div className="grid2" style={{ marginTop: 8 }}>
        <div className="field">
          <label htmlFor="session-title">Title</label>
          <input
            id="session-title"
            style={{ width: "100%" }}
            value={value.title}
            onChange={(event) => set({ title: event.target.value })}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="session-room">Location</label>
          <input
            id="session-room"
            style={{ width: "100%" }}
            value={value.room}
            placeholder="Room name"
            onChange={(event) => set({ room: event.target.value })}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="session-track">Track</label>
          <input
            id="session-track"
            style={{ width: "100%" }}
            value={value.track}
            placeholder="Optional"
            onChange={(event) => set({ track: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="session-date">Day</label>
          <DateField
            id="session-date"
            value={value.date}
            min={range.from}
            max={range.to}
            onChange={(date) => set({ date })}
            ariaLabel="Session day"
          />
        </div>
        <div className="field">
          <label htmlFor="session-start">Starts</label>
          <TimeField id="session-start" value={value.start} onChange={(start) => set({ start })} ariaLabel="Session start" />
        </div>
        <div className="field">
          <label htmlFor="session-end">Ends</label>
          <TimeField id="session-end" value={value.end} onChange={(end) => set({ end })} ariaLabel="Session end" />
        </div>
      </div>
      {adding && (
        <>
          <div className="note" style={{ marginTop: 8 }}>
            Presenter (optional) — matched to an existing speaker by email, or added.
          </div>
          <PresenterFields value={presenter} onChange={setPresenter} idPrefix="new-session" />
        </>
      )}
      {!adding && (
        <div className="note" style={{ marginTop: 6 }}>
          Moving a session to another location sends its approved files to the new room.
        </div>
      )}
      {error && (
        <div className="err" style={{ marginTop: 10, marginBottom: 0 }}>
          {error}
        </div>
      )}
      <Actions busy={busy} label={adding ? "Add session" : "Save session"} onCancel={onClose} />
    </form>
  );
}

function PresenterFields({
  value,
  onChange,
  idPrefix,
}: {
  value: PresenterInput;
  onChange: (value: PresenterInput) => void;
  idPrefix: string;
}) {
  return (
    <div className="grid2" style={{ marginTop: 6 }}>
      <div className="field">
        <label htmlFor={`${idPrefix}-name`}>Name</label>
        <input
          id={`${idPrefix}-name`}
          style={{ width: "100%" }}
          value={value.name}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-email`}>Email</label>
        <input
          id={`${idPrefix}-email`}
          type="email"
          style={{ width: "100%" }}
          value={value.email}
          onChange={(event) => onChange({ ...value, email: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-org`}>Organisation</label>
        <input
          id={`${idPrefix}-org`}
          style={{ width: "100%" }}
          value={value.organization}
          placeholder="Optional"
          onChange={(event) => onChange({ ...value, organization: event.target.value })}
        />
      </div>
    </div>
  );
}

export function PresentationForm({
  eventId,
  sessionId,
  slotId,
  initial,
  onClose,
}: {
  eventId: string;
  /** Adding: the session it goes into. */
  sessionId?: string;
  /** Editing: the presentation itself. */
  slotId?: string;
  initial?: PresentationInput;
  onClose: () => void;
}) {
  const [value, setValue] = useState<PresentationInput>(initial ?? { title: "", start: "", end: "" });
  const [presenter, setPresenter] = useState<PresenterInput>({ name: "", email: "", organization: "" });
  const { busy, error, run } = useSave();
  const adding = !slotId;

  return (
    <form
      style={formBox}
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          () =>
            adding
              ? agendaApi.addPresentation(eventId, sessionId!, { ...value, presenter })
              : agendaApi.updatePresentation(eventId, slotId, value),
          onClose,
        );
      }}
    >
      <b>{adding ? "New presentation" : "Edit presentation"}</b>
      <div className="grid2" style={{ marginTop: 8 }}>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor={`talk-title-${slotId ?? "new"}`}>Title</label>
          <input
            id={`talk-title-${slotId ?? "new"}`}
            style={{ width: "100%" }}
            value={value.title}
            onChange={(event) => setValue({ ...value, title: event.target.value })}
            required
          />
        </div>
        <div className="field">
          <label htmlFor={`talk-start-${slotId ?? "new"}`}>Starts (optional)</label>
          <TimeField
            id={`talk-start-${slotId ?? "new"}`}
            value={value.start}
            onChange={(start) => setValue({ ...value, start })}
            ariaLabel="Presentation start"
          />
        </div>
        <div className="field">
          <label htmlFor={`talk-end-${slotId ?? "new"}`}>Ends (optional)</label>
          <TimeField
            id={`talk-end-${slotId ?? "new"}`}
            value={value.end}
            onChange={(end) => setValue({ ...value, end })}
            ariaLabel="Presentation end"
          />
        </div>
      </div>
      <div className="note" style={{ marginTop: 6 }}>
        Leave the times empty and it runs with its session.
      </div>
      {adding && (
        <>
          <div className="note" style={{ marginTop: 8 }}>
            Presenter (optional)
          </div>
          <PresenterFields value={presenter} onChange={setPresenter} idPrefix="new-talk" />
        </>
      )}
      {error && (
        <div className="err" style={{ marginTop: 10, marginBottom: 0 }}>
          {error}
        </div>
      )}
      <Actions busy={busy} label={adding ? "Add presentation" : "Save presentation"} onCancel={onClose} />
    </form>
  );
}

export function PresenterForm({ eventId, slotId, onClose }: { eventId: string; slotId: string; onClose: () => void }) {
  const [value, setValue] = useState<PresenterInput>({ name: "", email: "", organization: "" });
  const { busy, error, run } = useSave();
  return (
    <form
      style={formBox}
      onSubmit={(event) => {
        event.preventDefault();
        void run(() => agendaApi.addPresenter(eventId, slotId, value), onClose);
      }}
    >
      <b>Add presenter</b>
      <div className="note">Matched to an existing speaker by email, or added to the event.</div>
      <PresenterFields value={value} onChange={setValue} idPrefix={`presenter-${slotId}`} />
      {error && (
        <div className="err" style={{ marginTop: 10, marginBottom: 0 }}>
          {error}
        </div>
      )}
      <Actions busy={busy} label="Add presenter" onCancel={onClose} />
    </form>
  );
}

/** Cancel / reinstate a session: both need a reason, which goes on its record. */
export function ReasonForm({
  label,
  onSubmit,
  onClose,
}: {
  label: string;
  onSubmit: (reason: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const { busy, error, run } = useSave();
  return (
    <form
      style={formBox}
      onSubmit={(event) => {
        event.preventDefault();
        void run(() => onSubmit(reason), onClose);
      }}
    >
      <div className="field">
        <label htmlFor="agenda-reason">Reason</label>
        <input
          id="agenda-reason"
          style={{ width: "100%" }}
          value={reason}
          placeholder="Goes on the session's record"
          onChange={(event) => setReason(event.target.value)}
          required
        />
      </div>
      {error && (
        <div className="err" style={{ marginTop: 10, marginBottom: 0 }}>
          {error}
        </div>
      )}
      <Actions busy={busy} label={label} onCancel={onClose} />
    </form>
  );
}

/** A destructive action asked in the page, not with `window.confirm` (see ArchiveEventButton). */
export function ConfirmDelete({
  what,
  onConfirm,
  onClose,
}: {
  what: string;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const { busy, error, run } = useSave();
  return (
    <div style={{ ...formBox, borderColor: "var(--block)" }}>
      Delete {what}? This cannot be undone. If files have been uploaded it is refused — cancel instead.
      {error && (
        <div className="err" style={{ marginTop: 10, marginBottom: 0 }}>
          {error}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button type="button" className="btn" disabled={busy} onClick={() => void run(onConfirm, onClose)}>
          {busy ? "Deleting…" : "Delete"}
        </button>
        <button type="button" className="btn" disabled={busy} onClick={onClose}>
          Keep it
        </button>
      </div>
    </div>
  );
}

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean };

/**
 * One "⋯" button per row instead of a row of buttons. A session carried four and a
 * presentation three, which on a real agenda is hundreds of buttons competing with
 * the titles and statuses the tab exists to show.
 */
export function ActionMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        className="btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((current) => !current)}
        style={{ padding: "2px 10px", fontSize: 15, lineHeight: 1.2 }}
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 4px)",
            zIndex: 20,
            minWidth: 170,
            background: "var(--white)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            boxShadow: "0 6px 20px rgba(20, 24, 27, .12)",
            padding: 4,
            textAlign: "left",
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                border: "none",
                background: "none",
                padding: "7px 10px",
                borderRadius: 4,
                fontSize: 13,
                cursor: "pointer",
                color: item.danger ? "var(--block)" : "var(--ink)",
              }}
              onMouseEnter={(event) => (event.currentTarget.style.background = "var(--mist)")}
              onMouseLeave={(event) => (event.currentTarget.style.background = "none")}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export function RemovePresenter({
  eventId,
  slotId,
  speakerId,
  name,
}: {
  eventId: string;
  slotId: string;
  speakerId: string;
  name: string;
}) {
  const { busy, error, run } = useSave();
  return (
    <button
      type="button"
      aria-label={`Remove ${name} from this presentation`}
      title={error ?? `Remove ${name} from this presentation`}
      disabled={busy}
      onClick={() => void run(() => agendaApi.removePresenter(eventId, slotId, speakerId))}
      style={{
        border: "none",
        background: "none",
        color: error ? "var(--block)" : "var(--dim)",
        cursor: "pointer",
        padding: "0 2px",
        fontSize: 13,
      }}
    >
      ×
    </button>
  );
}
