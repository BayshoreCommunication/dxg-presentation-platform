"use client";

import { InfoTip } from "@/components/InfoTip";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { AgendaPresentation, AgendaSession, EventDraft, SpeakerRow } from "@/lib/api";
import { agendaApi } from "@/lib/api";
import { Chip } from "@/components/Chip";
import { humanize, timeZoneLabel } from "@pmp/format";
import { EventDetails } from "@/components/EventDetails";
import {
  ConfirmDelete,
  ActionMenu,
  PresenterForm,
  ReasonForm,
  RemovePresenter,
  RemovePresenterConfirm,
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
  undecided: "Not set",
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
  /*
   * The tab is read from the address, not held in state (D-134): the sidebar's "Agenda"
   * link points here with `?tab=agenda`, and on this page that is a navigation to the
   * same component — state set once at mount would ignore it. Next keeps
   * `useSearchParams` in step with `history.replaceState`, so choosing a tab below
   * updates it too. `initialTab` is the server's reading, for the first paint.
   */
  const params = useSearchParams();
  // No `tab` in the address means Overview — not "whatever the page was opened with".
  const wanted = params ? (params.get("tab") ?? undefined) : initialTab;
  const tab: Tab = TABS.some((candidate) => candidate.id === wanted) ? (wanted as Tab) : "overview";

  const choose = (next: Tab) => {
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
  /*
   * One editor open at a time, named by what it edits — `session:<id>`,
   * `talk:<slotId>`, `new-session` and so on. Two open forms on one agenda is two
   * half-finished changes, and the page's refresh would re-render both under the
   * operator's cursor.
   */
  const [open, setOpen] = useState<string | null>(null);
  const close = () => setOpen(null);
  const toggle = (key: string) => setOpen((current) => (current === key ? null : key));

  const eventWindow = { from: setup.starts_on, to: setup.ends_on };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return agenda.filter((session) => {
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
  }, [agenda, query]);

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
        {canEdit && (
          <button type="button" className="btn pri" onClick={() => toggle("new-session")}>
            + Add session
          </button>
        )}
      </div>
      <div className="note" style={{ marginBottom: 6 }}>
        {agenda.length} sessions · {presentations} presentations · times in {timeZoneLabel(timezone)}
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
              // Not `overflow: hidden` on the card: it clipped the row's action menu.
              <div key={session.id} className={canceled ? "ag-sess canceled" : "ag-sess"}>
                <div className="ag-head">
                  {/* Start over end, so every session's title starts on the same line (D-131). */}
                  <div className="ag-time mono num">
                    <span>{clock(session.starts_at, timezone)}</span>
                    <span>{clock(session.ends_at, timezone)}</span>
                  </div>
                  <div className="ag-what">
                    <b className="ag-title">{session.title}</b>
                    <div className="note">
                      {[session.room ?? "No room", session.track, session.kind !== "session" ? session.kind : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <div className="ag-actions">
                    {state && <Chip status={state.status} label={state.label} />}
                    {canEdit && (
                      <ActionMenu
                        label={`Actions for session ${session.title}`}
                        items={[
                          { label: "Edit session", onSelect: () => toggle(`session:${session.id}`) },
                          // Each speaker gets their own presentation in the session (D-137).
                          ...(canceled || session.presentations.length === 0
                            ? []
                            : [{ label: "Add speaker", onSelect: () => toggle(`add-speaker:${session.id}`) }]),
                          // No "Add presentation" (D-132): one presentation per session.
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
                {open === `add-speaker:${session.id}` && session.presentations[0] && (
                  <div style={{ padding: "0 12px" }}>
                    <PresenterForm
                      eventId={eventId}
                      slotId={session.presentations[0].slot_id}
                      asSpeaker
                      onClose={close}
                    />
                  </div>
                )}

                {session.presentations.length === 0 ? (
                  <div className="ag-talk">
                    <div className="ag-time" />
                    <div className="note">No presentations in this session.</div>
                  </div>
                ) : (
                  session.presentations.map((item) => (
                    <PresentationRow
                      key={item.slot_id}
                      eventId={eventId}
                      timezone={timezone}
                      sessionTitle={session.title}
                      onlyOne={session.presentations.length === 1}
                      item={item}
                      canEdit={canEdit}
                      open={open}
                      toggle={toggle}
                      close={close}
                    />
                  ))
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
  sessionTitle,
  onlyOne,
  item,
  canEdit,
  open,
  toggle,
  close,
}: {
  eventId: string;
  timezone: string;
  sessionTitle: string;
  onlyOne: boolean;
  item: AgendaPresentation;
  canEdit: boolean;
  open: string | null;
  toggle: (key: string) => void;
  close: () => void;
}) {
  // No "Edit presentation" (D-132): its title follows the session (D-130) and it runs on
  // the session's times (D-129). Edit the session instead.
  // Co-presenters' presentations share the title (D-137); who presents tells them apart.
  const who = item.speakers.map((person) => person.name).join(", ");
  const editor =
    open === `presenter:${item.slot_id}` ? (
      <PresenterForm eventId={eventId} slotId={item.slot_id} onClose={close} />
    ) : open?.startsWith(`remove-presenter:${item.slot_id}:`) ? (
      (() => {
        const person = item.speakers.find((speaker) => open === `remove-presenter:${item.slot_id}:${speaker.id}`);
        return person ? (
          <RemovePresenterConfirm
            eventId={eventId}
            slotId={item.slot_id}
            speakerId={person.id}
            name={person.name}
            title={item.title}
            onClose={close}
          />
        ) : null;
      })()
    ) : open === `delete-talk:${item.slot_id}` ? (
      <ConfirmDelete
        what={`the presentation "${item.title}"${who ? ` (${who})` : ""}`}
        onConfirm={() => agendaApi.deletePresentation(eventId, item.slot_id)}
        onClose={close}
      />
    ) : null;

  const talkHref = `/events/${eventId}/talks/${item.slot_id}`;
  const ownTitle = item.title !== sessionTitle;

  return (
    <div className="ag-talk">
      {/* A presentation with no time of its own runs with its session (D-031). */}
      <div className="ag-time mono num note">
        {item.starts_at ? (
          <>
            <span>{clock(item.starts_at, timezone)}</span>
            {item.ends_at && item.ends_at !== item.starts_at && <span>{clock(item.ends_at, timezone)}</span>}
          </>
        ) : null}
      </div>

      <div className="ag-what">
        {/*
          A presentation named after its session is not named again (D-130); one with a
          title of its own shows it above its speakers.
        */}
        {ownTitle && (
          <Link href={talkHref} className="ag-talk-title">
            {item.title}
          </Link>
        )}

        {/* One speaker per line (D-131): who presents is what this row is for. */}
        {item.speakers.length === 0 ? (
          <div className="ag-spk empty">
            <span className="avatar sm" aria-hidden="true">
              ?
            </span>
            <span className="note">No speaker assigned yet</span>
            {canEdit && (
              <button type="button" className="btn ag-add" onClick={() => toggle(`presenter:${item.slot_id}`)}>
                + Add presenter
              </button>
            )}
          </div>
        ) : (
          <ul className="ag-spks" aria-label={`Speakers for ${item.title}${who ? ` — ${who}` : ""}`}>
            {item.speakers.map((person) => (
              <li key={person.id} className="ag-spk">
                <span className="avatar sm" aria-hidden="true">
                  {initialsOf(person.name)}
                </span>
                <span className="ag-name">{person.name}</span>
                {person.organization && <span className="ag-org">{person.organization}</span>}
                {person.role !== "speaker" && <span className="chip ag-role">{humanize(person.role)}</span>}
                {canEdit && (
                  <span className="ag-remove">
                    <RemovePresenter
                      name={person.name}
                      onAsk={() => toggle(`remove-presenter:${item.slot_id}:${person.id}`)}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {editor && <div className="ag-editor">{editor}</div>}
      </div>

      <div className="ag-actions">
        {/* The status opens the presentation, as its title would. */}
        <Link href={talkHref} title="Open this presentation" className="ag-status">
          <Chip status={item.status} label={item.status_label} />
        </Link>
        {/* "Add presenter" moved to the session's menu as "Add speaker" (D-137). */}
        {canEdit && !onlyOne && (
          <ActionMenu
            label={`Actions for presentation ${item.title}${who ? ` (${who})` : ""}`}
            items={[
              /*
               * A session's only presentation is not deleted on its own (D-132): with no
               * "Add presentation" the session could never be filled again. "Delete
               * session" removes both.
               */
              ...(onlyOne
                ? []
                : [{ label: "Delete presentation", onSelect: () => toggle(`delete-talk:${item.slot_id}`), danger: true }]),
            ]}
          />
        )}
      </div>
    </div>
  );
}

/** "Dr. Priya Raman" → "PR": honorifics are not initials. */
function initialsOf(name: string): string {
  const words = name
    .replace(/^(dr|prof|mr|mrs|ms|mx|sir|dame)\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length > 1 ? words[0]![0]! + words[words.length - 1]![0]! : words[0]!.slice(0, 2);
  return letters.toUpperCase();
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
    const map = new Map<
      string,
      { slot_id: string; title: string; status: string; status_label: string }[]
    >();
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
                <th style={{ textAlign: "left" }}>Sessions</th>
                <th style={{ textAlign: "left" }}>Files</th>
                <th style={{ textAlign: "left", whiteSpace: "nowrap" }}>
                  Archive permission
                  <InfoTip label="Archive permission" align="right">
                  What this speaker agreed the client may keep after the event. Full release: the
                  PowerPoint and a PDF go into the post-event archive. PDF only: just the PDF. No
                  release, or Not set: their presentations are left out. For a shared talk the
                  strictest speaker&rsquo;s choice applies.
                </InfoTip>
                </th>
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
