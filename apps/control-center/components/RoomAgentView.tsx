"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentView } from "@/lib/api";
import { getAgentView, syncRoom, acknowledgeRoomFile, launchInRoom, ApiError } from "@/lib/api";
import { formatBytes } from "@pmp/format";

const size = (bytes: string): string => {
  return formatBytes(bytes);
};

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

  const pending = view.schedule.find((row) => row.sync_state === "synced" && !row.acknowledged);
  const offline = (view.agent.heartbeat_age ?? Number.MAX_SAFE_INTEGER) > 300;

  return (
    <div
      className="darkpane"
      // A room computer's screen, framed as one dark panel inside the page rather than
      // bleeding to the edges of the old padded <main> (D-078).
      style={{ minHeight: "calc(100vh - 100px)", padding: "18px 22px" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, color: "var(--white)" }}>
            Room Agent · <span style={{ color: "var(--white)", fontWeight: 600 }}>{view.room.name}</span>
          </h1>
          <div className="mono" style={{ fontSize: 12, color: "var(--dim)" }}>
            {view.agent.fingerprint ?? "no agent registered"} · agent {view.agent.version ?? "—"} ·{" "}
            {view.library.updates_waiting === 0 ? "library complete" : "update waiting"} ·{" "}
            {offline ? "offline" : "online"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="mono" style={{ fontSize: 16, color: "var(--white)" }}>
            {clock}
          </span>
          <span className="chip c-ok">OFFLINE-SAFE ✓</span>
        </div>
      </div>

      {error && <div className="err">{error}</div>}

      {pending && (
        <div
          style={{
            background: "#3A2C10",
            border: "1px solid var(--warn)",
            borderRadius: 6,
            padding: "10px 14px",
            marginBottom: 14,
            color: "#F5C97B",
          }}
        >
          ⚠ <b>Change alert:</b> {pending.speaker} v{pending.version_number} approved — replaces the
          copy in this room for the {time(pending.starts_at, view.event.timezone)} slot. The previous version is kept for
          rollback and stays on screen until you acknowledge.
          <button
            className="btn"
            style={{ marginLeft: 8 }}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await acknowledgeRoomFile(pending.room_file_id!, pending.lock_version!);
                return `Acknowledged — v${pending.version_number} is now the copy this room plays`;
              })
            }
          >
            Acknowledge &amp; sync v{pending.version_number}
          </button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 250px", gap: 16, alignItems: "start" }}>
        <div style={{ background: "var(--ink2)", border: "1px solid #2A3B46", borderRadius: 8 }}>
          {view.schedule.length === 0 && (
            <div className="empty">Nothing is scheduled in this room.</div>
          )}
          {view.schedule.map((row, index) => {
            const zone = view.event.timezone;
            // A heading per day at the venue — it said "TODAY · WED MAR 11" whatever the date.
            const newDay = index === 0 || dayKey(view.schedule[index - 1]!.starts_at, zone) !== dayKey(row.starts_at, zone);
            const today = dayKey(row.starts_at, zone) === dayKey(new Date(), zone);
            return (
            <Fragment key={`${row.slot_id}-${row.file_version_id ?? "none"}`}>
            {newDay && (
              <div
                className="mono"
                suppressHydrationWarning
                style={{
                  fontSize: 11,
                  letterSpacing: ".1em",
                  color: "var(--dim)",
                  padding: "10px 14px",
                  borderBottom: "1px solid #2A3B46",
                }}
              >
                {today ? "TODAY · " : ""}
                {dayLabel(row.starts_at, zone)}
              </div>
            )}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "11px 14px",
                borderBottom: "1px solid #2A3B46",
                ...(row.launchable ? { background: "#0F2A36" } : {}),
              }}
            >
              <span
                className="mono"
                style={{ color: row.launchable ? "var(--white)" : "var(--paneink)", width: 44 }}
              >
                {time(row.starts_at, view.event.timezone)}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ color: "var(--white)" }}>
                  {row.title}
                  {row.speaker ? ` — ${row.speaker}` : ""}
                </b>
                <br />
                <span style={{ fontSize: 12, color: "var(--dim)" }}>
                  {row.version_number === null
                    ? "no file"
                    : `v${row.version_number} · ${describeState(row.sync_state, row.acknowledged)}`}
                  {row.presented_at ? " · presented" : ""}
                </span>
              </span>
              {row.presented_at && (
                <span className="mono" style={{ color: "var(--ok)", fontSize: 12 }}>
                  ✓ logged
                </span>
              )}
              <button
                className="btn pri"
                style={{ padding: "5px 14px" }}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await launchInRoom(view.room.id, row.slot_id);
                    return result.launched
                      ? `Launched · logged ${new Date().toLocaleTimeString("en-US", { hour12: false, timeZone: view.event.timezone })}`
                      : `Holding screen — ${result.reason}`;
                  })
                }
              >
                ▶ Launch
              </button>
            </div>
            </Fragment>
            );
          })}
        </div>

        <div>
          <div
            style={{
              background: "var(--ink2)",
              border: "1px solid #2A3B46",
              borderRadius: 8,
              padding: "12px 14px",
              marginBottom: 14,
            }}
          >
            <div
              className="mono"
              style={{ fontSize: 11, letterSpacing: ".1em", color: "var(--dim)", marginBottom: 8 }}
            >
              LIBRARY
            </div>
            <div style={{ fontSize: 13, color: "var(--white)" }}>
              {view.library.files} file{view.library.files === 1 ? "" : "s"} ·{" "}
              {size(view.library.bytes)} local
            </div>
            <div
              className="mono"
              style={{
                fontSize: 12,
                color: view.library.updates_waiting > 0 ? "var(--warn)" : "var(--ok)",
              }}
            >
              {view.library.updates_waiting > 0
                ? `${view.library.updates_waiting} update waiting`
                : "all current ✓"}
            </div>
            <div style={{ fontSize: 12, color: "var(--dim)", marginBottom: 10 }}>
              previous versions kept: {view.library.previous_versions}
            </div>
            <button
              className="btn pri"
              style={{ padding: "5px 12px" }}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await syncRoom(view.room.id);
                  return result.downloaded === 0 && result.failed === 0
                    ? "Already current — nothing to download"
                    : `Checksum-verified sync: ${result.downloaded} downloaded, ${result.awaiting_ack} awaiting acknowledgment${result.failed > 0 ? `, ${result.failed} failed` : ""}`;
                })
              }
            >
              Manual sync
            </button>
          </div>

          <div
            style={{
              background: "var(--ink2)",
              border: "1px solid #2A3B46",
              borderRadius: 8,
              padding: "12px 14px",
            }}
          >
            <div
              className="mono"
              style={{ fontSize: 11, letterSpacing: ".1em", color: "var(--dim)", marginBottom: 8 }}
            >
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
                // The event's accent (set in the wizard) edges the slide, as it brands the
                // speaker and client surfaces; no accent, no edge.
                ...(view.event.accent ? { boxShadow: `inset 0 -4px 0 ${view.event.accent}` } : {}),
                padding: "0 12px",
                textAlign: "center",
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  color: "var(--white)",
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                }}
              >
                {view.event.name}
              </span>
            </div>
            <div className="note" style={{ color: "var(--dim)", marginTop: 8, fontSize: 11.5 }}>
              Shown whenever there is nothing safe to play. Driving PowerPoint itself is M5-3,
              pending the Windows PoC.
            </div>
          </div>
        </div>
      </div>

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </div>
  );
}

function describeState(state: string | null, acknowledged: boolean): string {
  switch (state) {
    case "active":
      return "current · ready";
    case "synced":
      return acknowledged ? "synced" : "update pending ack";
    case "acknowledged":
      return "acknowledged · activating";
    case "assigned":
      return "queued for download";
    case "syncing":
      return "downloading";
    case "sync_failed":
      return "sync failed — will retry";
    case "obsolete":
      return "previous version (kept for rollback)";
    default:
      return "not delivered to this room";
  }
}
