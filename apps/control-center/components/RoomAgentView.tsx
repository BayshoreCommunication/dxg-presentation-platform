"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentView } from "@/lib/api";
import { getAgentView, markLoaded, launchInRoom, ApiError } from "@/lib/api";
import { ROOM_COPY, wordsFor } from "@pmp/format";

/*
 * Every time on this screen is on the event's clock (D-080). It was pinned to New York,
 * which was right for one seeded event and wrong for any other.
 */
const time = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });

/** The calendar day at the venue, for grouping the room's talks by day. */
const dayKey = (iso: string | Date, timeZone: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone });

const dayLabel = (iso: string, timeZone: string) =>
  new Date(iso)
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone })
    .toUpperCase();

/**
 * Screen 15 — what the room technician sees on the room machine. The Windows
 * Electron client is M5; this is the same view and the same server-side rules,
 * so the behaviour being demonstrated is the product's, not a mock-up.
 */
export function RoomAgentView({ initial }: { initial: AgentView }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState("");

  useEffect(() => setView(initial), [initial]);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("en-US", { hour12: false, timeZone: initial.event.timezone }),
      );
    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [initial.event.timezone]);

  const refresh = useCallback(async () => {
    setView(await getAgentView(initial.room.id));
    router.refresh();
  }, [initial.room.id, router]);

  const run = useCallback(
    async (work: () => Promise<string>) => {
      setBusy(true);
      setError(null);
      try {
        setToast(await work());
        await refresh();
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : "Something went wrong.");
      } finally {
        setBusy(false);
        setTimeout(() => setToast(null), 4000);
      }
    },
    [refresh],
  );

  const zone = view.event.timezone;

  /*
   * D-125: room PCs are loaded by hand. One talk per slot — its loaded copy (the one Launch
   * plays) and any newer approved copy still to load — instead of one row per copy.
   */
  const talks = groupBySlot(view.schedule);
  const newer = talks.find((talk) => talk.loaded && talk.waiting);
  const notLoaded = talks.filter((talk) => talk.waiting && !talk.loaded).length;
  const loadedCount = talks.filter((talk) => talk.loaded && !talk.waiting).length;
  const nextUp = talks.find((talk) => talk.loaded?.launchable && !talk.loaded.presented_at)?.loaded;
  // The next talk the audience is waiting for, for the holding screen (D-127): the first
  // not yet presented whose start is no more than 15 minutes past — a talk long gone is
  // not "next". Nothing upcoming, and the screen shows the event name alone.
  const nextForAudience = [...view.schedule]
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .find((row) => !row.presented_at && new Date(row.starts_at).getTime() > Date.now() - 15 * 60_000);
  const nextDay =
    nextForAudience && dayKey(nextForAudience.starts_at, zone) !== dayKey(new Date(), zone)
      ? `${new Date(nextForAudience.starts_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zone })} · `
      : "";
  const launchNote = "Launch records the talk as presented; opening PowerPoint on the room PC is connected in a later release.";
  const launch = (row: Row, primary: boolean) => (
    <button
      className={primary ? "btn pri" : "btn"}
      style={{ padding: "5px 14px" }}
      disabled={busy}
      onClick={() =>
        void run(async () => {
          const result = await launchInRoom(view.room.id, row.slot_id);
          // Honest until the room agent opens PowerPoint itself (G0-1): recorded, not opened (D-108).
          return result.launched
            ? `Recorded as presented at ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: zone })} — opening it on the room PC isn't connected yet`
            : `Not recorded — ${result.reason}`;
        })
      }
    >
      ▶ Launch
    </button>
  );
  // D-125: was "Switch to vN" (acknowledge); now the same tick as Room sync's Mark loaded.
  const markLoadedButton = (row: Row, primary: boolean) => (
    <button
      className={primary ? "btn pri" : "btn"}
      style={{ padding: "5px 14px" }}
      disabled={busy}
      onClick={() =>
        void run(async () => {
          await markLoaded(row.room_file_id!, row.lock_version!);
          return `v${row.version_number} ticked loaded — it is now the copy this room plays`;
        })
      }
    >
      Mark v{row.version_number} loaded
    </button>
  );

  /** The one thing that matters in this room now (D-124, D-125). */
  const now: { text: string; action?: React.ReactNode } = newer?.waiting
    ? {
        text: `A newer version of “${newer.waiting.title}”${newer.waiting.speaker ? ` (${newer.waiting.speaker})` : ""} must be loaded: v${newer.waiting.version_number} is approved, the room PC has v${newer.loaded!.version_number}. Copy it over and tick it before its ${time(newer.waiting.starts_at, zone)} session.`,
        action: markLoadedButton(newer.waiting, true),
      }
    : nextUp
      ? {
          text: `Next up: ${time(nextUp.starts_at, zone)} “${nextUp.title}”${nextUp.speaker ? ` — ${nextUp.speaker}` : ""}. It's loaded and ready to play.`,
          action: launch(nextUp, true),
        }
      : notLoaded > 0
        ? {
            text: `${notLoaded} ${notLoaded === 1 ? "talk isn't" : "talks aren't"} loaded yet — load ${notLoaded === 1 ? "it" : "them"} on Room sync.`,
            action: (
              <a className="btn pri" style={{ padding: "5px 14px" }} href={`/events/${view.event.id}/sync`}>
                Open Room sync
              </a>
            ),
          }
        : { text: "Nothing left to play in this room." };

  return (
    <div
      className="darkpane"
      // A room computer's screen, framed as one dark panel inside the page (D-078).
      style={{ minHeight: "calc(100vh - 100px)", padding: "18px 22px" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, color: "var(--white)", margin: 0 }}>{view.room.name}</h1>
          <div style={{ fontSize: 12, color: "var(--dim)" }}>Room Agent · what the room technician sees at the lectern</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* No connection tag: the platform doesn't watch room PCs (D-125). */}
          <span className="mono" style={{ fontSize: 16, color: "var(--white)" }}>
            {clock}
          </span>
        </div>
      </div>

      {error && <div className="err">{error}</div>}

      {/* ── Now (D-124): one sentence, one button — the old screen spread this across a
          header line, a change-alert banner and a column of greyed Launch buttons. ── */}
      <div className="room-now">
        <div className="room-now-label">NOW</div>
        <div className="room-now-text">{now.text}</div>
        {now.action && <div style={{ marginTop: 10 }}>{now.action}</div>}
        {now.action && nextUp && !newer && <div className="room-now-note">{launchNote}</div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 250px", gap: 16, alignItems: "start" }}>
        <div style={{ background: "var(--ink2)", border: "1px solid #2A3B46", borderRadius: 8 }}>
          {talks.length === 0 && <div className="empty">Nothing is scheduled in this room.</div>}
          {talks.map((talk, index) => {
            const first = talk.loaded ?? talk.waiting ?? talk.bare!;
            // A heading per day at the venue.
            const newDay = index === 0 || dayKey(talks[index - 1]!.startsAt, zone) !== dayKey(talk.startsAt, zone);
            const today = dayKey(talk.startsAt, zone) === dayKey(new Date(), zone);
            const playable = Boolean(talk.loaded?.launchable) && !talk.waiting;
            return (
              <Fragment key={talk.slotId}>
                {newDay && (
                  <div
                    className="mono"
                    suppressHydrationWarning
                    style={{ fontSize: 11, letterSpacing: ".1em", color: "var(--dim)", padding: "10px 14px", borderBottom: "1px solid #2A3B46" }}
                  >
                    {today ? "TODAY · " : ""}
                    {dayLabel(talk.startsAt, zone)}
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "11px 14px",
                    borderBottom: "1px solid #2A3B46",
                    ...(playable ? { background: "#0F2A36" } : {}),
                  }}
                >
                  <span className="mono" style={{ color: playable ? "var(--white)" : "var(--paneink)", width: 44 }}>
                    {time(talk.startsAt, zone)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b style={{ color: "var(--white)" }}>
                      {first.title}
                      {first.speaker ? ` — ${first.speaker}` : ""}
                    </b>
                    <br />
                    {/* One plain state per talk (D-124), in loading words (D-125). */}
                    <span style={{ fontSize: 12.5, color: playable ? "var(--ok)" : talk.loaded && talk.waiting ? "#F5C97B" : "var(--dim)" }}>
                      {talkState(talk)}
                    </span>
                  </span>
                  {talk.loaded?.presented_at && !talk.waiting ? (
                    <span className="mono" style={{ color: "var(--ok)", fontSize: 12 }}>
                      ✓ presented
                    </span>
                  ) : talk.waiting ? (
                    markLoadedButton(talk.waiting, false)
                  ) : talk.loaded?.launchable ? (
                    launch(talk.loaded, false)
                  ) : null}
                </div>
              </Fragment>
            );
          })}
        </div>

        <div>
          <div style={{ background: "var(--ink2)", border: "1px solid #2A3B46", borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
            <div className="mono" style={{ fontSize: 11, letterSpacing: ".1em", color: "var(--dim)", marginBottom: 8 }}>
              THIS ROOM PC
            </div>
            <div style={{ fontSize: 13, color: "var(--white)" }}>
              {loadedCount} of {talks.length} talk{talks.length === 1 ? "" : "s"} loaded
            </div>
            {/* D-125: loaded by hand — no bytes, no Check for updates. */}
            <div style={{ fontSize: 12, color: "var(--dim)" }}>
              Copy approved files onto this PC and tick them on{" "}
              <a href={`/events/${view.event.id}/sync`} style={{ color: "var(--paneink)" }}>
                Room sync
              </a>
              .
            </div>
          </div>

          <div style={{ background: "var(--ink2)", border: "1px solid #2A3B46", borderRadius: 8, padding: "12px 14px" }}>
            <div className="mono" style={{ fontSize: 11, letterSpacing: ".1em", color: "var(--dim)", marginBottom: 8 }}>
              HOLDING SCREEN
            </div>
            <div
              style={{
                border: "1px solid #2A3B46",
                borderRadius: 6,
                aspectRatio: "16/9",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--ink)",
                // The event's accent edges the slide, as it brands the speaker and client pages.
                ...(view.event.accent ? { boxShadow: `inset 0 -4px 0 ${view.event.accent}` } : {}),
                padding: "0 12px",
                textAlign: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 700, color: "var(--white)", letterSpacing: ".06em", textTransform: "uppercase" }}>
                  {view.event.name}
                </div>
                {/* D-127: what's on next in this room, as the audience would want to know. */}
                {nextForAudience && (
                  <div suppressHydrationWarning style={{ marginTop: 10, color: "var(--paneink)", fontSize: 11.5, lineHeight: 1.4 }}>
                    <div style={{ letterSpacing: ".1em", fontSize: 9.5, color: "var(--dim)" }}>NEXT</div>
                    <div>
                      {nextDay}
                      {time(nextForAudience.starts_at, zone)} · {nextForAudience.title}
                    </div>
                    {nextForAudience.speaker && <div style={{ color: "var(--dim)" }}>{nextForAudience.speaker}</div>}
                  </div>
                )}
              </div>
            </div>
            <div className="note" style={{ color: "var(--dim)", marginTop: 8, fontSize: 11.5 }}>
              On the projector between talks, and whenever something can&rsquo;t play — with the next talk in this
              room when there is one.
            </div>
          </div>
        </div>
      </div>

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </div>
  );
}

type Row = AgentView["schedule"][number];
type Talk = { slotId: string; startsAt: string; loaded?: Row; waiting?: Row; bare?: Row };

/**
 * One entry per talk (D-125): the copy the room plays (`active`), a newer approved copy
 * still to load, or — with neither — the talk's latest version, which has no approved copy.
 */
function groupBySlot(schedule: readonly Row[]): Talk[] {
  const talks = new Map<string, Talk>();
  for (const row of schedule) {
    const talk = talks.get(row.slot_id) ?? { slotId: row.slot_id, startsAt: row.starts_at };
    if (row.sync_state === "active") talk.loaded = row;
    else if (row.sync_state !== null) talk.waiting = row;
    else talk.bare = row;
    talks.set(row.slot_id, talk);
  }
  return [...talks.values()];
}

/** A talk's state in this room, in one line (D-124, loading words since D-125). */
function talkState(talk: Talk): string {
  if (talk.loaded && talk.waiting) {
    return `v${talk.loaded.version_number} loaded · v${talk.waiting.version_number} approved — load it (the room has v${talk.loaded.version_number})`;
  }
  if (talk.loaded) return talk.loaded.presented_at ? `v${talk.loaded.version_number}` : `v${talk.loaded.version_number} · loaded — ready to play`;
  if (talk.waiting) return `v${talk.waiting.version_number} · ${wordsFor(ROOM_COPY, talk.waiting.sync_state).label.toLowerCase()}`;
  return wordsFor(ROOM_COPY, "not_sent").label;
}
