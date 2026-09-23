"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AgendaPresentation, AgendaSession, EventDraft, SpeakerRow } from "@/lib/api";
import { agendaApi } from "@/lib/api";
import { Chip } from "@/components/Chip";
import { EventDetails } from "@/components/EventDetails";
import {
  ConfirmDelete,
  ActionMenu,
  PresentationForm,
  PresenterForm,
  ReasonForm,
  RemovePresenter,
  SessionForm,
  localClock,
  localDate,
} from "@/components/AgendaEditor";

type Tab = "overview" | "agenda" | "speakers";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "agenda", label: "Agenda" },
  { id: "speakers", label: "Speakers" },
];

/** Times always render in the event's timezone — never the viewer's browser. */
const clock = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone });

const dayHeading = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

const RELEASE: Record<string, string> = {
  undecided: "Undecided",
  full: "Full release",
  pdf_only: "PDF only",
  none: "No release",
};

const SESSION_STATE: Record<string, { status: string; label: string }> = {
  moved: { status: "needs_revision", label: "Moved" },
  replaced: { status: "needs_revision", label: "Replaced" },
  canceled: { status: "canceled", label: "Canceled" },
  completed: { status: "approved", label: "Completed" },
};

/**
 * The event details, split into tabs (D-063). Overview is the setup that was already
 * here; Agenda and Speakers show what the setup produced — every session and
 * presentation, and every person giving one — without leaving the event.
 *
 * Tabs rather than one long page because the three answer different questions and an
 * agenda runs to hundreds of rows: stacked, the KPIs and risk list below would be
 * pushed out of reach. The chosen tab lives in the URL (`?tab=`), so a link or a
 * reload lands on it, and it survives the command centre's five-second refresh.
 */
export function EventTabs({
  eventId,
  timezone,
  setup,
  talks,
  canEdit,
  agenda,
  speakers,
  initialTab,
}: {
  eventId: string;
  timezone: string;
  setup: EventDraft;
  talks: { total: number; collected: number };
  canEdit: boolean;
  agenda: AgendaSession[];
  speakers: SpeakerRow[];
  initialTab: string | undefined;
}) {
  const [tab, setTab] = useState<Tab>(
    TABS.some((candidate) => candidate.id === initialTab) ? (initialTab as Tab) : "overview",
  );

  const choose = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  };

  const presentationCount = agenda.reduce((sum, session) => sum + session.presentations.length, 0);
  const counts: Record<Tab, number | null> = {
    overview: null,
    agenda: agenda.length,
    speakers: speakers.length,
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <div className="tabs" role="tablist" aria-label="Event details">
        {TABS.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            id={`tab-${candidate.id}`}
            aria-selected={tab === candidate.id}
            aria-controls={`panel-${candidate.id}`}
            onClick={() => choose(candidate.id)}
          >
            {candidate.label}
            {counts[candidate.id] !== null && <span className="count">{counts[candidate.id]}</span>}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "overview" && <EventDetails setup={setup} talks={talks} canEdit={canEdit} embedded />}
        {tab === "agenda" && (
          <div className="card">
            <div className="cbd">
              <AgendaPanel
                eventId={eventId}
                timezone={timezone}
                agenda={agenda}
                presentations={presentationCount}
                setup={setup}
                canEdit={canEdit}
              />
            </div>
          </div>
        )}
        {tab === "speakers" && (
          <div className="card">
            <div className="cbd">
              <SpeakersPanel eventId={eventId} agenda={agenda} speakers={speakers} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AgendaPanel({
  eventId,
  timezone,
  agenda,
  presentations,
  setup,
  canEdit,
}: {
  eventId: string;
  timezone: string;
  agenda: AgendaSession[];
  presentations: number;
  setup: EventDraft;
  canEdit: boolean;
}) {
  const [query, setQuery] = useState("");
  const [room, setRoom] = useState("");
  /*
   * One editor open at a time, named by what it edits — `session:<id>`,
   * `talk:<slotId>`, `new-session` and so on. Two open forms on one agenda is two
   * half-finished changes, and the page's refresh would re-render both under the
   * operator's cursor.
   */
  const [open, setOpen] = useState<string | null>(null);
  const close = () => setOpen(null);
  const toggle = (key: string) => setOpen((current) => (current === key ? null : key));

  const rooms = useMemo(
    () => [...new Set(agenda.map((session) => session.room).filter((name): name is string => Boolean(name)))].sort(),
    [agenda],
  );
  const eventWindow = { from: setup.starts_on, to: setup.ends_on };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return agenda.filter((session) => {
      if (room && session.room !== room) return false;
      if (!needle) return true;
      const haystack = [
        session.title,
        session.track ?? "",
        ...session.presentations.flatMap((item) => [
          item.title,
          ...item.speakers.flatMap((person) => [person.name, person.organization ?? ""]),
        ]),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [agenda, query, room]);

  // Grouped by day, in the order the sessions already come in (start time).
  const days = useMemo(() => {
    const grouped = new Map<string, AgendaSession[]>();
    for (const session of visible) {
      const key = session.day ?? "";
      grouped.set(key, [...(grouped.get(key) ?? []), session]);
    }
    return [...grouped.entries()];
  }, [visible]);

  const newSession =
    open === "new-session" ? (
      <SessionForm eventId={eventId} window={eventWindow} onClose={close} />
    ) : null;

  if (agenda.length === 0) {
    return (
      <div style={{ padding: "12px 0" }}>
        <div className="empty">
          No agenda yet — sessions come from the schedule import.{" "}
          <Link href={`/events/${eventId}/import`}>Import an agenda →</Link>
        </div>
        {canEdit && !newSession && (
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn" onClick={() => setOpen("new-session")}>
              + Add a session by hand
            </button>
          </div>
        )}
        {newSession}
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input
          type="search"
          aria-label="Search the agenda"
          placeholder="Search sessions, talks, speakers…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ flex: "1 1 240px" }}
        />
        {rooms.length > 1 && (
          <select aria-label="Filter by room" value={room} onChange={(event) => setRoom(event.target.value)}>
            <option value="">All rooms</option>
            {rooms.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
        {canEdit && (
          <button type="button" className="btn pri" onClick={() => toggle("new-session")}>
            + Add session
          </button>
        )}
      </div>
      <div className="note" style={{ marginBottom: 6 }}>
        {agenda.length} sessions · {presentations} presentations · times in {timezone}
        {canEdit && " · changes save straight to the event"}
      </div>

      {newSession}

      {days.length === 0 && <div className="empty">Nothing matches.</div>}

      {days.map(([day, sessions]) => (
        <section key={day || "undated"} style={{ marginBottom: 14 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, margin: "12px 0 6px" }}>
            {day ? dayHeading(day) : "No day assigned"}
          </h4>
          {sessions.map((session) => {
            const state = SESSION_STATE[session.state];
            const canceled = session.state === "canceled";
            return (
              <div
                key={session.id}
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: 6,
                  marginBottom: 8,
                  // Not `overflow: hidden`: it clipped the row's action menu.
                  opacity: canceled ? 0.75 : 1,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "8px 12px",
                    background: "var(--mist)",
                    borderRadius: "6px 6px 0 0",
                  }}
                >
                  <div>
                    <span className="mono num" style={{ marginRight: 10 }}>
                      {clock(session.starts_at, timezone)}–{clock(session.ends_at, timezone)}
                    </span>
                    <b style={canceled ? { textDecoration: "line-through" } : undefined}>{session.title}</b>
                    <div className="note">
                      {[session.room ?? "No room", session.track, session.kind !== "session" ? session.kind : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {state && <Chip status={state.status} label={state.label} />}
                    {canEdit && (
                      <ActionMenu
                        label={`Actions for session ${session.title}`}
                        items={[
                          { label: "Edit session", onSelect: () => toggle(`session:${session.id}`) },
                          ...(canceled
                            ? []
                            : [{ label: "Add presentation", onSelect: () => toggle(`add-talk:${session.id}`) }]),
                          ...(session.state === "completed"
                            ? []
                            : [
                                {
                                  label: canceled ? "Reinstate session" : "Cancel session",
                                  onSelect: () => toggle(`cancel:${session.id}`),
                                },
                              ]),
                          { label: "Delete session", onSelect: () => toggle(`delete-session:${session.id}`), danger: true },
                        ]}
                      />
                    )}
                  </div>
                </div>

                {open === `session:${session.id}` && (
                  <div style={{ padding: "0 12px" }}>
                    <SessionForm
                      eventId={eventId}
                      window={eventWindow}
                      sessionId={session.id}
                      initial={{
                        title: session.title,
                        room: session.room ?? "",
                        track: session.track ?? "",
                        date: session.day ?? localDate(session.starts_at, timezone),
                        start: localClock(session.starts_at, timezone),
                        end: localClock(session.ends_at, timezone),
                      }}
                      onClose={close}
                    />
                  </div>
                )}
                {open === `cancel:${session.id}` && (
                  <div style={{ padding: "0 12px" }}>
                    <ReasonForm
                      label={canceled ? "Reinstate session" : "Cancel session"}
                      onSubmit={(reason) =>
                        canceled
                          ? agendaApi.reinstateSession(eventId, session.id, reason)
                          : agendaApi.cancelSession(eventId, session.id, reason)
                      }
                      onClose={close}
                    />
                  </div>
                )}
                {open === `delete-session:${session.id}` && (
                  <div style={{ padding: "0 12px" }}>
                    <ConfirmDelete
                      what={`the session "${session.title}" and its presentations`}
                      onConfirm={() => agendaApi.deleteSession(eventId, session.id)}
                      onClose={close}
                    />
                  </div>
                )}
                {open === `add-talk:${session.id}` && (
                  <div style={{ padding: "0 12px" }}>
                    <PresentationForm eventId={eventId} sessionId={session.id} onClose={close} />
                  </div>
                )}

                {session.presentations.length === 0 ? (
                  <div className="note" style={{ padding: "8px 12px" }}>
                    No presentations in this session.
                  </div>
                ) : (
                  <table>
                    <tbody>
                      {session.presentations.map((item) => (
                        <PresentationRow
                          key={item.slot_id}
                          eventId={eventId}
                          timezone={timezone}
                          item={item}
                          canEdit={canEdit}
                          open={open}
                          toggle={toggle}
                          close={close}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function PresentationRow({
  eventId,
  timezone,
  item,
  canEdit,
  open,
  toggle,
  close,
}: {
  eventId: string;
  timezone: string;
  item: AgendaPresentation;
  canEdit: boolean;
  open: string | null;
  toggle: (key: string) => void;
  close: () => void;
}) {
  const editor =
    open === `talk:${item.slot_id}` ? (
      <PresentationForm
        eventId={eventId}
        slotId={item.slot_id}
        initial={{
          title: item.title,
          start: localClock(item.starts_at, timezone),
          end: localClock(item.ends_at, timezone),
        }}
        onClose={close}
      />
    ) : open === `presenter:${item.slot_id}` ? (
      <PresenterForm eventId={eventId} slotId={item.slot_id} onClose={close} />
    ) : open === `delete-talk:${item.slot_id}` ? (
      <ConfirmDelete
        what={`the presentation "${item.title}"`}
        onConfirm={() => agendaApi.deletePresentation(eventId, item.slot_id)}
        onClose={close}
      />
    ) : null;

  return (
    <>
      <tr>
        {/* A presentation with no time of its own runs with its session (D-031). */}
        <td style={{ width: 110 }} className="mono num note">
          {item.starts_at
            ? `${clock(item.starts_at, timezone)}${item.ends_at ? `–${clock(item.ends_at, timezone)}` : ""}`
            : ""}
        </td>
        <td>
          <Link href={`/events/${eventId}/talks/${item.slot_id}`}>{item.title}</Link>
          <div className="note">
            {item.speakers.length === 0
              ? "No speaker assigned"
              : item.speakers.map((person, index) => (
                  <span key={person.id}>
                    {index > 0 && ", "}
                    {person.name}
                    {person.organization ? ` (${person.organization})` : ""}
                    {person.role !== "speaker" ? ` · ${person.role}` : ""}
                    {canEdit && (
                      <RemovePresenter
                        eventId={eventId}
                        slotId={item.slot_id}
                        speakerId={person.id}
                        name={person.name}
                      />
                    )}
                  </span>
                ))}
          </div>
        </td>
        <td className="note num" style={{ width: 90 }}>
          {item.version_count === 0 ? "no file" : `${item.version_count} version${item.version_count === 1 ? "" : "s"}`}
        </td>
        <td style={{ textAlign: "right", width: 200 }}>
          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
            <Chip status={item.status} label={item.status_label} />
            {canEdit && (
              <ActionMenu
                label={`Actions for presentation ${item.title}`}
                items={[
                  { label: "Edit presentation", onSelect: () => toggle(`talk:${item.slot_id}`) },
                  { label: "Add presenter", onSelect: () => toggle(`presenter:${item.slot_id}`) },
                  { label: "Delete presentation", onSelect: () => toggle(`delete-talk:${item.slot_id}`), danger: true },
                ]}
              />
            )}
          </div>
        </td>
      </tr>
      {editor && (
        <tr>
          <td colSpan={4} style={{ borderTop: "none", paddingTop: 0 }}>
            {editor}
          </td>
        </tr>
      )}
    </>
  );
}

function SpeakersPanel({
  eventId,
  agenda,
  speakers,
}: {
  eventId: string;
  agenda: AgendaSession[];
  speakers: SpeakerRow[];
}) {
  const [query, setQuery] = useState("");

  // Which talks each speaker gives, from the agenda already loaded for the other tab.
  const talksBySpeaker = useMemo(() => {
    const map = new Map<string, { slot_id: string; title: string; status: string; status_label: string }[]>();
    for (const session of agenda) {
      for (const item of session.presentations) {
        for (const person of item.speakers) {
          map.set(person.id, [...(map.get(person.id) ?? []), item]);
        }
      }
    }
    return map;
  }, [agenda]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return speakers;
    return speakers.filter((person) =>
      [person.full_name, person.organization ?? "", person.email ?? ""].join(" ").toLowerCase().includes(needle),
    );
  }, [speakers, query]);

  if (speakers.length === 0) {
    return (
      <div className="empty" style={{ padding: "18px 0" }}>
        No speakers yet — they arrive with the agenda import.
      </div>
    );
  }

  const withFiles = speakers.filter((person) => person.with_files > 0).length;

  return (
    <div style={{ paddingBottom: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <input
          type="search"
          aria-label="Search speakers"
          placeholder="Search name, organisation, email…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ flex: "1 1 240px" }}
        />
        <span className="note">
          {speakers.length} speakers · {withFiles} have uploaded
        </span>
        <Link href={`/events/${eventId}/speakers`} className="btn">
          Manage speakers →
        </Link>
      </div>

      {visible.length === 0 ? (
        <div className="empty">Nothing matches.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Speaker</th>
                <th style={{ textAlign: "left" }}>Presentations</th>
                <th style={{ textAlign: "left" }}>Files</th>
                <th style={{ textAlign: "left" }}>Release</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((person) => {
                const given = talksBySpeaker.get(person.id) ?? [];
                return (
                  <tr key={person.id}>
                    <td>
                      <b>{person.full_name}</b>
                      <div className="note">
                        {[person.organization, person.email].filter(Boolean).join(" · ") || "No contact recorded"}
                      </div>
                    </td>
                    <td>
                      {given.length === 0 ? (
                        <span className="note">None assigned</span>
                      ) : (
                        given.map((item) => (
                          <div
                            key={item.slot_id}
                            style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "2px 0" }}
                          >
                            <Link href={`/events/${eventId}/talks/${item.slot_id}`}>{item.title}</Link>
                            <Chip status={item.status} label={item.status_label} />
                          </div>
                        ))
                      )}
                    </td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>
                      {person.with_files} / {person.talks} uploaded
                      <div className="note">{person.approved} approved</div>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {RELEASE[person.release_permission] ?? person.release_permission}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
