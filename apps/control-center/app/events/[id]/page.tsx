import { SrrSwitch } from "@/components/SrrSwitch";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSummary, getRiskList, getFleet, getDraft, getSession, getAgenda, getSpeakers, getReviewQueue, ApiError } from "@/lib/api";
import { Chip } from "@/components/Chip";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EventTabs } from "@/components/EventTabs";
import { ROOM_LABEL, roomLoadedLine } from "@/lib/roomWords";
import { guard } from "@/lib/guard";

export const dynamic = "force-dynamic";

/** Times always render in the event's timezone — never the viewer's browser. */
const time = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });

/** Day and time on the event's clock: "Tue, Oct 27 · 09:00" — talks run over several days. */
const dayTime = (iso: string, timeZone: string) =>
  `${new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone })} · ${time(iso, timeZone)}`;

/**
 * "Action needed" (D-174, was "Today's risk list" — it was never only today's): every talk not
 * yet loaded in its room, grouped by what has to happen next and who does it, each with the
 * one thing to do in words and the screen where it's done. S25 (D-113) gave each row a reason;
 * a reason ("Waiting for review") still left the reader to work out the action.
 */
type ActionGroup = { key: string; title: string; who: string; link: { label: string; href: (id: string) => string } };
const ACTION_GROUPS: ActionGroup[] = [
  {
    key: "speaker",
    title: "Waiting for the speaker",
    who: "the speaker sends a file",
    link: { label: "Speakers", href: (id) => `/events/${id}?tab=speakers` },
  },
  {
    key: "review",
    title: "To review",
    who: "a reviewer approves the file",
    link: { label: "Manage presentations", href: (id) => `/events/${id}/review` },
  },
  {
    key: "load",
    title: "To load in the room",
    who: "copy the approved file to the room PC and tick it",
    link: { label: "Room sync", href: (id) => `/events/${id}/sync` },
  },
  {
    key: "room",
    title: "Needs a room",
    who: "give the session a room",
    link: { label: "Agenda", href: (id) => `/events/${id}?tab=agenda` },
  },
];
/**
 * Why a room isn't ready (D-176), in Action needed's words: each talk that still needs something,
 * by name, under what it needs — "To load: Amara Okafor · To review: Tomás Herrera".
 */
const ROOM_REASON_LABEL: Record<string, string> = {
  load: "To load",
  review: "To review",
  speaker: "Waiting for the speaker",
};
function roomReasons(talks: { status: string; speaker: string | null; title: string }[]): string | null {
  const parts = ["load", "review", "speaker"].flatMap((group) => {
    const names = talks
      .filter((talk) => ACTION_FOR[talk.status]?.group === group)
      .map((talk) => talk.speaker ?? talk.title);
    return names.length > 0 ? [`${ROOM_REASON_LABEL[group]}: ${names.join(", ")}`] : [];
  });
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Which group a talk's status falls in, and the one thing to do, in words. */
const ACTION_FOR: Record<string, { group: string; todo: string }> = {
  missing: { group: "speaker", todo: "Nothing uploaded yet — remind the speaker to upload, or take the file in at the Speaker Ready Room." },
  needs_revision: { group: "speaker", todo: "Changes were asked for — waiting for the speaker's new version." },
  attention: { group: "speaker", todo: "The file failed the virus check — ask the speaker for a clean copy." },
  submitted: { group: "review", todo: "Review the file and approve it, or ask for changes." },
  processing: { group: "review", todo: "The file checks are still running — it will be ready to review in a minute." },
  approved_delivering: { group: "load", todo: "Copy the approved file to the room PC and tick Loaded on Room sync." },
  update_pending_ack: { group: "load", todo: "A newer version is approved — load it on the room PC (it still has the older one)." },
  approved: { group: "room", todo: "Approved, but the session has no room — set one in the Agenda." },
};

/** Who may change an event's setup. A hint for the UI; `services/events.ts` decides. */
const CONFIGURERS = ["presentation_manager", "project_manager", "platform_admin"];

export default async function CommandCenterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  /*
   * A technician's event is the Speaker Ready Room and Manage presentations (D-151); the
   * command centre is support staff's, so they are sent on. Support staff review on Manage
   * presentations too (D-163).
   */
  const session = await guard(getSession(), `/events/${id}`);
  const kind = session.principal.staff_kind;
  if (kind === "technician") redirect(`/events/${id}/srr`);
  const unlessRefused = <T,>(work: Promise<T>, fallback: T): Promise<T> =>
    work.catch((caught: unknown) => (caught instanceof ApiError && caught.status === 403 ? fallback : Promise.reject(caught)));
  const [summary, risk, fleet, setup, agenda, speakers, review] = await guard(
    Promise.all([
      getSummary(id),
      getRiskList(id),
      getFleet(id),
      getDraft(id),
      getAgenda(id),
      getSpeakers(id),
      unlessRefused(getReviewQueue(id), { items: [] }),
    ]),
    `/events/${id}`,
  );
  // The talks that need someone to act (D-174): a cancelled session needs nothing.
  const actionable = risk.items.filter((item) => ACTION_FOR[item.status] !== undefined);

  /*
   * A draft is not a running event, and this screen has no way to say so: it would
   * report a live indicator, zero of zero talks collected and "every talk is
   * synchronized onsite" for an event with no agenda at all. The portfolio link is not
   * the only way in — the sidebar's event switcher lists drafts too, as does a
   * bookmark — so the rule belongs here rather than only on the card that started it.
   */
  if (summary.event.status === "draft") redirect(`/events/new?event=${id}`);

  /*
   * This line was the literal string "Tampa Convention Center · Day 2 of 3 · Doors
   * 08:00" on every event, whatever its venue and however long it ran — invented
   * operational facts on the event's home screen, beside a live indicator. SCREEN_SPECS
   * §4 specifies `name · venue · Day N of M · doors`; three of those four are real data
   * and the fourth is not recorded anywhere, so it is not shown.
   *
   * "Day N of M" only appears while the event is running. Before it starts and after it
   * ends there is no current day, and picking one would be the same invention in a
   * smaller font.
   */
  const days = (() => {
    const from = new Date(`${summary.event.starts_on}T00:00:00Z`);
    const to = new Date(`${summary.event.ends_on}T00:00:00Z`);
    const total = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    // Today as the venue reckons it, not as the viewer's browser does.
    const todayThere = new Date().toLocaleDateString("en-CA", { timeZone: summary.event.timezone });
    const current =
      Math.round(new Date(`${todayThere}T00:00:00Z`).getTime() - from.getTime()) / 86_400_000 + 1;
    return current >= 1 && current <= total ? `Day ${current} of ${total}` : null;
  })();
  // S28 (D-113): no green "live" dot once the event's last day has passed at the venue.
  const over = new Date().toLocaleDateString("en-CA", { timeZone: summary.event.timezone }) > summary.event.ends_on;

  const dateRange = `${new Date(`${summary.event.starts_on}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })} – ${new Date(`${summary.event.ends_on}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })}`;

  const archived = summary.event.status === "archived";
  // The roles held on *this* event (D-116: a practice event's manager is not one elsewhere).
  const canConfigure =
    session.principal.is_root_admin ||
    (session.principal.event_roles ?? []).some((held) => held.event_id === id && CONFIGURERS.includes(held.role));
  const header = [summary.event.venue, days ?? dateRange].filter(Boolean) as string[];

  return (
    <>
      <AutoRefresh seconds={5} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
        <div>
          <h1 className="htitle" style={{ marginBottom: 2 }}>
            {summary.event.name}
          </h1>
          <span className="note">
            {header.join(" · ")}
            {header.length > 0 && <>&nbsp;</>}
            {!archived && !over && (
              <span className="live">
                <i /> live
              </span>
            )}
          </span>
        </div>
        {/*
          No "Back to portfolio" button (D-173): the breadcrumb's "Portfolio" is the way out. And
          "Manage presentations" shows only when something waits for review, with how many
          (D-173); with nothing waiting, the sidebar's Manage presentations still opens it.
        */}
        {review.items.length > 0 && (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <Link href={`/events/${id}/review`} className="btn pri">
              {`Manage presentations (${review.items.length}) →`}
            </Link>
          </div>
        )}
      </div>

      {/* The Speaker Ready Room's event-day switch (D-157): support staff run the event and open it. */}
      {!archived && (
        <div style={{ margin: "-4px 0 14px" }}>
          <SrrSwitch eventId={id} open={summary.event.srr_open} canSwitch={canConfigure} />
        </div>
      )}

      {archived && (
        <div className="err" style={{ borderLeftColor: "var(--line)", background: "var(--mist)" }}>
          This event is archived and read-only — it is hidden from the portfolio and nothing in it can be
          changed. Everything is kept;
          {canConfigure
            ? " Restore it from the portfolio’s Archived list."
            : " a presentation manager can restore it from the portfolio."}
        </div>
      )}

      {/*
        What the event is, above how it is going (D-058). This was screen 18, a click
        away, so the timezone every time on this page is rendered in — and the deadline
        that closes the speaker portal — could only be read by leaving the event.
      */}
      <EventTabs
        eventId={id}
        timezone={summary.event.timezone}
        setup={setup}
        talks={{ total: summary.total, collected: summary.collected }}
        canEdit={canConfigure && !archived}
        agenda={agenda.items}
        speakers={speakers.items}
        initialTab={tab}
      />

      {/* Action needed (D-174): what has to happen for each talk not yet in its room. A
          cancelled session needs nothing, so it isn't listed. The five number tiles that sat
          above it (Collected, Approved, Warnings, Missing, Rooms ready) are gone (D-175). */}
      <div className="card">
        <div className="chd">
          <h3>Action needed</h3>
          <span className="m">
            {actionable.length === 0
              ? "every talk is ready in its room"
              : `${actionable.length} talk${actionable.length === 1 ? "" : "s"} not ready for the room yet · click one to open it`}
          </span>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          {actionable.length === 0 ? (
            <div className="empty">
              {summary.total === 0
                ? "No talks yet — the agenda has none, or none of its sessions carry one."
                : "Nothing to do — every talk's file is approved and loaded on its room PC."}
            </div>
          ) : (
            ACTION_GROUPS.map((group) => {
              const items = actionable.filter((item) => ACTION_FOR[item.status]!.group === group.key);
              if (items.length === 0) return null;
              return (
                <div key={group.key}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      gap: 8,
                      flexWrap: "wrap",
                      padding: "12px 14px 4px",
                    }}
                  >
                    <div>
                      <b>
                        {group.title} · {items.length}
                      </b>
                      <span className="note"> — {group.who}</span>
                    </div>
                    <Link className="note" href={group.link.href(id)}>
                      {group.link.label} →
                    </Link>
                  </div>
                  <table>
                    <tbody>
                      {items.map((item) => (
                        <tr className="rb" key={item.slot_id}>
                          <td>
                            <Link href={`/events/${id}/talks/${item.slot_id}`} style={{ display: "block" }}>
                              <span className="note">
                                {dayTime(item.starts_at, summary.event.timezone)} · {item.room ?? "No room"} ·{" "}
                              </span>
                              <b>{item.speaker ?? "No speaker"}</b> — {item.title}
                            </Link>
                            <div className="note">{ACTION_FOR[item.status]!.todo}</div>
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <Chip status={item.status} label={item.status_label} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="card">
        <div className="chd">
          <h3>Room readiness</h3>
          {/* S3 (D-112): plain words for where these statuses come from — since D-125, the ticks on Room sync. */}
          <Link className="m" href={`/events/${id}/sync`}>
            From the ticks on Room sync →
          </Link>
        </div>
        <div className="cbd" style={{ padding: "0 0 4px" }}>
          <table>
            <tbody>
              {fleet.items.map((room) => (
                <tr key={room.room_id}>
                  <td>
                    <b>{room.room}</b>
                    <br />
                    <span className="note">{roomLoadedLine(room)}</span>
                    {/* Why not ready, by name (D-176): the chip alone didn't say what was holding it. */}
                    {room.readiness !== "ready" && roomReasons(room.talks) && (
                      <div className="note" style={{ color: "var(--foreground)" }}>
                        {roomReasons(room.talks)}
                      </div>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Chip
                      status={room.readiness}
                      label={ROOM_LABEL[room.readiness]}
                    />
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
