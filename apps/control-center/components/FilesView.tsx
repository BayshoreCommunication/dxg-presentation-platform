"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes, VERSION_STATE, wordsFor } from "@pmp/format";
import { Icon } from "@/components/Icon";
import { WhyNot } from "@/components/WhyNot";
import { ApiError, downloadFilesZip, fileDownloadUrl, getEventFiles } from "@/lib/api";
import { FloatingMenu, useFloatingMenu } from "@/components/FloatingMenu";
import type { EventFiles, FileQuery, FileRow, FileStatus, FileVersionRow } from "@/lib/api";

type Row = FileRow & { history: FileVersionRow[] };

/**
 * Event files (FR-FILE-005, D-079), laid out like the reference "Project Files" screen:
 * rooms as folders, the latest uploads as cards, then every file in a searchable table,
 * with a side drawer for one file's details and version history.
 *
 * A row is a talk's file carrying its newest version. Downloads are of that exact version
 * and are logged by the API; a quarantined or unfinished file offers no download at all.
 */
export function FilesView({
  eventId,
  eventName,
  timeZone,
  initial,
}: {
  eventId: string;
  eventName: string;
  timeZone: string;
  initial: EventFiles;
}) {
  const [data, setData] = useState<EventFiles>(initial);
  const [query, setQuery] = useState<FileQuery>({ status: "all", sort: "uploaded", dir: "desc", page: 1, limit: 10 });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "grid">("list");
  const [selected, setSelected] = useState<Map<string, Row>>(new Map());
  const [open, setOpen] = useState<Row | null>(null);
  const [zipping, setZipping] = useState(false);
  const first = useRef(true);

  // Typing settles before it asks the server; every other change asks at once.
  useEffect(() => {
    const handle = setTimeout(() => {
      setQuery((current) => (current.q === (search || undefined) ? current : { ...current, q: search || undefined, page: 1 }));
    }, 250);
    return () => clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    getEventFiles(eventId, query)
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : "The files could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, query]);

  const set = (patch: Partial<FileQuery>) => setQuery((current) => ({ ...current, page: 1, ...patch }));

  const sortBy = (sort: NonNullable<FileQuery["sort"]>) =>
    setQuery((current) => ({
      ...current,
      sort,
      dir: current.sort === sort ? (current.dir === "asc" ? "desc" : "asc") : sort === "uploaded" || sort === "size" ? "desc" : "asc",
      page: 1,
    }));

  const pageRows = data.items;
  const selectable = pageRows.filter((row) => row.downloadable);
  const allOnPage = selectable.length > 0 && selectable.every((row) => selected.has(row.version_id));

  const toggle = (row: Row) =>
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(row.version_id)) next.delete(row.version_id);
      else next.set(row.version_id, row);
      return next;
    });

  const toggleAll = () =>
    setSelected((current) => {
      const next = new Map(current);
      for (const row of selectable) {
        if (allOnPage) next.delete(row.version_id);
        else next.set(row.version_id, row);
      }
      return next;
    });

  async function downloadSelected() {
    setZipping(true);
    setError(null);
    try {
      const { blob, filename } = await downloadFilesZip(eventId, [...selected.keys()]);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "The download could not be built.");
    } finally {
      setZipping(false);
    }
  }

  const roomName = data.rooms.find((room) => (room.room_id ?? "none") === query.room)?.room;

  const TABS: { key: FileStatus | "all"; label: string }[] = [
    { key: "all", label: "View all" },
    { key: "review", label: VERSION_STATE.awaiting_review!.label },
    { key: "approved", label: "Approved" },
    { key: "changes", label: "Changes requested" },
    { key: "blocked", label: "Held back or blocked" },
  ];

  return (
    <>
      <div className="files-head">
        <div>
          <h1 className="htitle" style={{ marginBottom: 6 }}>
            Event files
          </h1>
          <p className="note" style={{ margin: 0 }}>
            Every presentation uploaded for {eventName}, newest version first.
          </p>
        </div>
        <div>
          <button
            type="button"
            className="btn pri"
            disabled={selected.size === 0 || zipping}
            onClick={() => void downloadSelected()}
          >
            <Icon name="download" />
            {zipping ? "Preparing zip…" : selected.size > 0 ? `Download selected (${selected.size})` : "Download selected"}
          </button>
          {/* D-111: said under the button, not left for the operator to guess. */}
          <WhyNot reason={selected.size === 0 && pageRows.length > 0 ? "Tick the files you want first." : null} />
        </div>
      </div>

      {error && (
        <div className="err" role="alert">
          {error}
        </div>
      )}

      {/* Folders: the rooms the files will play in. */}
      <div className="folders">
        {data.rooms.length === 0 && <div className="note">No files have been uploaded for this event yet.</div>}
        {data.rooms.map((room) => {
          const key = room.room_id ?? "none";
          const active = query.room === key;
          return (
            <button
              key={key}
              type="button"
              className={active ? "folder on" : "folder"}
              aria-pressed={active}
              onClick={() => set({ room: active ? undefined : key })}
            >
              <span className="folder-art" aria-hidden="true">
                <FolderArt />
              </span>
              <span className="folder-name">{room.room}</span>
              <span className="folder-meta">
                {room.files} {room.files === 1 ? "file" : "files"} · {formatBytes(room.bytes)}
              </span>
            </button>
          );
        })}
      </div>

      {data.recent.length > 0 && (
        <>
          <h2 className="files-section">Recent files</h2>
          <div className="recent">
            {data.recent.map((row) => (
              <button key={row.file_id} type="button" className="recent-card" onClick={() => setOpen(row)}>
                <FileType name={row.filename} />
                <span className="recent-text">
                  <b>{row.filename}</b>
                  <small suppressHydrationWarning>{shortDate(row.uploaded_at, timeZone)}</small>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <h2 className="files-section">All files</h2>
      <div className="files-toolbar">
        <div className="seg-tabs" role="tablist" aria-label="Filter by status">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={(query.status ?? "all") === tab.key}
              onClick={() => set({ status: tab.key })}
            >
              {tab.label}
              <span className="count">{data.counts[tab.key]}</span>
            </button>
          ))}
        </div>
        <div className="files-tools">
          <label className="search">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Search file, talk or speaker…"
              aria-label="Search files"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <RoomFilter rooms={data.rooms} value={query.room} onChange={(room) => set({ room })} />
          <div className="viewtoggle" role="group" aria-label="Layout">
            <button type="button" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
              <Icon name="grid" />
            </button>
            <button type="button" aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")}>
              <Icon name="list" />
            </button>
          </div>
        </div>
      </div>
      {roomName && (
        <div className="note" style={{ margin: "-4px 0 10px" }}>
          Showing {roomName} only ·{" "}
          <button type="button" className="linkish" onClick={() => set({ room: undefined })}>
            show every room
          </button>
        </div>
      )}

      <div className={loading ? "files-panel loading" : "files-panel"}>
        {pageRows.length === 0 ? (
          <div className="empty">{query.q || query.room || query.status !== "all" ? "No files match." : "No files yet."}</div>
        ) : view === "list" ? (
          <div className="files-scroll">
            <table className="files-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>
                    <Check
                      checked={allOnPage}
                      disabled={selectable.length === 0}
                      reason="None of the files on this page can be downloaded yet — see Status."
                      label="Select every file on this page"
                      onChange={toggleAll}
                    />
                  </th>
                  <SortHead label="Filename" sort="name" query={query} onSort={sortBy} />
                  <SortHead label="Uploaded" sort="uploaded" query={query} onSort={sortBy} />
                  <SortHead label="Speaker" sort="speaker" query={query} onSort={sortBy} />
                  <SortHead label="Location" sort="location" query={query} onSort={sortBy} />
                  <th>Status</th>
                  <SortHead label="Size" sort="size" query={query} onSort={sortBy} />
                  <th style={{ width: 44 }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.file_id} className={selected.has(row.version_id) ? "sel" : undefined}>
                    <td>
                      <Check
                        checked={selected.has(row.version_id)}
                        disabled={!row.downloadable}
                        reason={cantDownload(row)}
                        label={`Select ${row.filename}`}
                        onChange={() => toggle(row)}
                      />
                    </td>
                    <td>
                      <button type="button" className="fname" onClick={() => setOpen(row)}>
                        <FileType name={row.filename} small />
                        <span>
                          <b>{row.filename}</b>
                          <small>
                            v{row.version_number}
                            {row.versions > 1 ? ` · ${row.versions} versions` : ""}
                          </small>
                        </span>
                      </button>
                    </td>
                    <td className="muted" suppressHydrationWarning>
                      {relativeTime(row.uploaded_at, timeZone)}
                    </td>
                    <td>
                      <span className="owner">
                        <span className="avatar sm">{initials(row.speakers)}</span>
                        <span className="ellipsis">{row.speakers ?? "No speaker"}</span>
                      </span>
                    </td>
                    <td>
                      <Link href={`/events/${eventId}/talks/${row.slot_id}`} className="loc" title={row.talk}>
                        {row.room ?? "No room"} / {row.talk}
                      </Link>
                    </td>
                    <td>
                      <StatusChip row={row} />
                    </td>
                    <td className="muted num">{formatBytes(row.size_bytes)}</td>
                    <td>
                      <RowMenu row={row} eventId={eventId} onDetails={() => setOpen(row)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="files-grid">
            {pageRows.map((row) => (
              <div key={row.file_id} className={selected.has(row.version_id) ? "fcard sel" : "fcard"}>
                <div className="fcard-top">
                  <Check
                    checked={selected.has(row.version_id)}
                    disabled={!row.downloadable}
                    reason={cantDownload(row)}
                    label={`Select ${row.filename}`}
                    onChange={() => toggle(row)}
                  />
                  <RowMenu row={row} eventId={eventId} onDetails={() => setOpen(row)} />
                </div>
                <button type="button" className="fcard-body" onClick={() => setOpen(row)}>
                  <FileType name={row.filename} large />
                  <b>{row.filename}</b>
                  <small>
                    {row.room ?? "No room"} · {row.speakers ?? "No speaker"}
                  </small>
                  <small suppressHydrationWarning>
                    v{row.version_number} · {formatBytes(row.size_bytes)} · {relativeTime(row.uploaded_at, timeZone)}
                  </small>
                </button>
                <StatusChip row={row} />
              </div>
            ))}
          </div>
        )}

        <div className="files-foot">
          <span>
            {selected.size} of {data.total} {data.total === 1 ? "file" : "files"} selected.
          </span>
          <span className="pager">
            <span>
              Page {data.page} of {data.pages}
            </span>
            <PagerButton label="First page" disabled={data.page <= 1} onClick={() => setQuery((q) => ({ ...q, page: 1 }))}>
              «
            </PagerButton>
            <PagerButton label="Previous page" disabled={data.page <= 1} onClick={() => setQuery((q) => ({ ...q, page: data.page - 1 }))}>
              ‹
            </PagerButton>
            <PagerButton label="Next page" disabled={data.page >= data.pages} onClick={() => setQuery((q) => ({ ...q, page: data.page + 1 }))}>
              ›
            </PagerButton>
            <PagerButton label="Last page" disabled={data.page >= data.pages} onClick={() => setQuery((q) => ({ ...q, page: data.pages }))}>
              »
            </PagerButton>
          </span>
        </div>
      </div>

      {open && <FileDrawer row={open} eventId={eventId} timeZone={timeZone} onClose={() => setOpen(null)} />}
    </>
  );
}

/* ── pieces ─────────────────────────────────────────────────────────────── */

/**
 * One version's state in the shared vocabulary (S38, D-110): a processing stop (held back,
 * damaged, still checking) wins over the review state, and a failed check reads "Blocked".
 */
function versionCode(version: { processing_state: string; review_state: string; inspection_state?: string }): string {
  if (version.processing_state !== "stored") return version.processing_state;
  if (version.inspection_state === "failed") return "blocked";
  return version.review_state;
}

/** Why a version can't be downloaded, as a sentence with a next step (S37, D-110). */
function cantDownload(version: { processing_state: string; downloadable: boolean }): string | undefined {
  if (version.downloadable) return undefined;
  const words = wordsFor(VERSION_STATE, version.processing_state);
  if (version.processing_state === "quarantined" || version.processing_state === "checksum_failed") {
    return `${words.label} — ${words.meaning} ${words.next ?? ""}`.trim();
  }
  return "Still being checked — it can be downloaded in a minute or two.";
}

const SOURCE_LABEL: Record<string, string> = {
  portal: "Speaker portal",
  srr_usb: "Speaker Ready Room · USB",
  srr_manual: "Speaker Ready Room",
  system: "System",
};

const CHIP: Record<FileStatus, string> = {
  review: "chip c-info",
  approved: "chip c-ok",
  changes: "chip c-warn",
  blocked: "chip c-bad",
  other: "chip c-mut",
};

function StatusChip({ row }: { row: FileRow }) {
  return (
    <span className="status-cell">
      <span className={CHIP[row.status]} title={wordsFor(VERSION_STATE, versionCode(row)).meaning}>
        {wordsFor(VERSION_STATE, versionCode(row)).label}
      </span>
      {row.open_findings > 0 && (
        <span className="findings" title="Inspection findings nobody has fixed or waived">
          {row.open_findings} {row.open_findings === 1 ? "warning" : "warnings"}
        </span>
      )}
    </span>
  );
}

function versionState(version: FileVersionRow): { label: string; className: string } {
  const label = wordsFor(VERSION_STATE, versionCode(version)).label;
  if (version.processing_state === "quarantined" || version.processing_state === "checksum_failed") return { label, className: "chip c-bad" };
  if (version.processing_state !== "stored") return { label, className: "chip c-mut" };
  const className =
    version.review_state === "approved"
      ? "chip c-ok"
      : version.review_state === "changes_requested" || version.review_state === "rejected"
        ? "chip c-warn"
        : version.review_state === "superseded" || version.review_state === "rolled_back"
          ? "chip c-mut"
          : "chip c-info";
  return { label, className };
}

const EXT_TONE: Record<string, { label: string; tone: string }> = {
  pptx: { label: "PPT", tone: "ppt" },
  ppt: { label: "PPT", tone: "ppt" },
  pptm: { label: "PPT", tone: "ppt" },
  key: { label: "KEY", tone: "key" },
  pdf: { label: "PDF", tone: "pdf" },
  mp4: { label: "MP4", tone: "vid" },
  mov: { label: "MOV", tone: "vid" },
};

/** A file-type tile, tinted by kind like the reference's Word/Excel/AI tiles. */
function FileType({ name, small, large }: { name: string; small?: boolean; large?: boolean }) {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const kind = EXT_TONE[ext] ?? { label: ext.slice(0, 4).toUpperCase() || "FILE", tone: "other" };
  return (
    <span className={`ftype ${kind.tone}${small ? " small" : ""}${large ? " large" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 16 16" fill="none">
        <path
          d="M9.5 1.667H5.333c-1.1 0-1.65 0-1.991.341C3 2.35 3 2.9 3 4v8c0 1.1 0 1.65.342 1.992.341.341.891.341 1.991.341h5.334c1.1 0 1.65 0 1.991-.341C13 13.65 13 13.1 13 12V5.167L9.5 1.667Z"
          className="sheet"
        />
        <path d="M9.5 1.667v2.166c0 .472 0 .708.146.855.147.146.383.146.854.146H13" className="fold" />
      </svg>
      <span className="ext">{kind.label}</span>
    </span>
  );
}

function FolderArt() {
  return (
    <svg viewBox="0 0 48 36" width="48" height="36" fill="none">
      <path d="M3 7c0-2.2 1.8-4 4-4h9.3c1.1 0 2.1.4 2.8 1.2L22 7h19c2.2 0 4 1.8 4 4v18c0 2.2-1.8 4-4 4H7c-2.2 0-4-1.8-4-4Z" fill="#E5E7EB" />
      <path d="M3 13c0-2.2 1.8-4 4-4h34c2.2 0 4 1.8 4 4v16c0 2.2-1.8 4-4 4H7c-2.2 0-4-1.8-4-4Z" fill="#D9D9D9" />
      <rect x="20" y="17" width="8" height="8" rx="2" fill="#F7F7F7" />
    </svg>
  );
}

function Check({
  checked,
  disabled,
  reason,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  reason?: string;
  label: string;
  onChange: () => void;
}) {
  return (
    <label className={disabled ? "cb disabled" : "cb"} title={disabled ? reason ?? "Can't be downloaded yet" : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} aria-label={label} onChange={onChange} />
      <span className="track" />
      <span className="knob">
        <svg viewBox="0 0 10 10" fill="none">
          <path d="M2.1 5.8 3.5 7.3 7.9 2.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </label>
  );
}

function SortHead({
  label,
  sort,
  query,
  onSort,
}: {
  label: string;
  sort: NonNullable<FileQuery["sort"]>;
  query: FileQuery;
  onSort: (sort: NonNullable<FileQuery["sort"]>) => void;
}) {
  const active = query.sort === sort;
  return (
    <th aria-sort={active ? (query.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className={active ? "sorthead on" : "sorthead"} onClick={() => onSort(sort)}>
        {label}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="M4 2v8M4 2 2.2 3.8M4 2l1.8 1.8M8 10V2M8 10l1.8-1.8M8 10 6.2 8.2"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </th>
  );
}

function PagerButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className="pagerbtn" aria-label={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** Closes on Escape and on a click anywhere else. */

function RowMenu({ row, eventId, onDetails }: { row: FileRow; eventId: string; onDetails: () => void }) {
  const { open, setOpen, trigger, menu } = useFloatingMenu();
  return (
    <div className="rowmenu">
      <button
        ref={trigger}
        type="button"
        className="ibtn"
        aria-label={`Actions for ${row.filename}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-state={open ? "open" : "closed"}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more" />
      </button>
      <FloatingMenu open={open} trigger={trigger} menu={menu}>
          {row.downloadable ? (
            <a className="item" role="menuitem" href={fileDownloadUrl(row.version_id)} onClick={() => setOpen(false)}>
              <Icon name="download" /> Download v{row.version_number}
            </a>
          ) : (
            <span className="item" aria-disabled="true" style={{ opacity: 0.5 }} title={cantDownload(row)}>
              <Icon name="download" /> {wordsFor(VERSION_STATE, row.processing_state).label} — can't download
            </span>
          )}
          <button
            type="button"
            className="item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDetails();
            }}
          >
            <Icon name="clock" /> Version history
          </button>
          <Link href={`/events/${eventId}/talks/${row.slot_id}`} className="item" role="menuitem">
            <Icon name="review" /> Open talk
          </Link>
      </FloatingMenu>
    </div>
  );
}

function FileDrawer({
  row,
  eventId,
  timeZone,
  onClose,
}: {
  row: Row;
  eventId: string;
  timeZone: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const facts: [string, React.ReactNode][] = [
    ["Talk", row.talk],
    ["Speaker", row.speakers ?? "No speaker assigned"],
    ["Room", row.room ?? "No room yet"],
    ["Session", sessionTime(row.starts_at, timeZone)],
    ["Uploaded", `${fullDate(row.uploaded_at, timeZone)} · ${row.uploaded_by ?? SOURCE_LABEL[row.source] ?? row.source}`],
    // "room PC", the one name staff are given for it (D-112).
    ["Loaded on room PCs", row.rooms_synced > 0 ? `${row.rooms_synced} room${row.rooms_synced === 1 ? "" : "s"}` : "Not loaded on a room PC yet"],
  ];
  if (row.restricted) facts.push(["Distribution", "Restricted — left out of client figures and the archive"]);

  return (
    <div className="drawer-layer">
      <button type="button" className="drawer-backdrop" aria-label="Close file details" onClick={onClose} />
      {/* A div, not an <aside>: the sidebar's rules target `aside` and would collapse it. */}
      <div className="drawer" role="dialog" aria-modal="true" aria-label={`File details: ${row.filename}`}>
        <div className="drawer-head">
          <h2>File details</h2>
          <button type="button" className="ibtn" aria-label="Close" onClick={onClose}>
            <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>
              ×
            </span>
          </button>
        </div>

        <div className="drawer-file">
          <FileType name={row.filename} large />
          <div>
            <b>{row.filename}</b>
            <small>
              v{row.version_number} of {row.versions} · {formatBytes(row.size_bytes)}
            </small>
            <StatusChip row={row} />
          </div>
        </div>

        <div className="drawer-actions">
          {row.downloadable ? (
            <a className="btn pri" href={fileDownloadUrl(row.version_id)}>
              <Icon name="download" /> Download v{row.version_number}
            </a>
          ) : (
            <span className="btn" aria-disabled="true" style={{ opacity: 0.5 }}>
              Can't download
            </span>
          )}
          <Link className="btn" href={`/events/${eventId}/talks/${row.slot_id}`}>
            Open talk
          </Link>
        </div>

        {!row.downloadable && <p className="note">{cantDownload(row)}</p>}

        <dl className="drawer-facts">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        <h3 className="drawer-sub">Versions</h3>
        <ul className="versions">
          {row.history.map((version) => {
            const state = versionState(version);
            return (
              <li key={version.id}>
                <FileType name={version.filename} small />
                <div className="vtext">
                  <b>
                    v{version.version_number} · {version.filename}
                  </b>
                  <small>
                    {formatBytes(version.size_bytes)} · {fullDate(version.uploaded_at, timeZone)}
                  </small>
                  {/* The file's checksum is no longer shown: staff never need it (S36, D-112). */}
                  <small>{version.uploaded_by ?? SOURCE_LABEL[version.source] ?? version.source}</small>
                  <span className={state.className} title={wordsFor(VERSION_STATE, versionCode(version)).meaning}>
                    {state.label}
                  </span>
                  {!version.downloadable && <small>{cantDownload(version)}</small>}
                </div>
                {version.downloadable ? (
                  <a className="ibtn" href={fileDownloadUrl(version.id)} aria-label={`Download v${version.version_number}`}>
                    <Icon name="download" />
                  </a>
                ) : (
                  <span className="ibtn" title={cantDownload(version)} style={{ opacity: 0.3 }}>
                    <Icon name="download" />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function RoomFilter({
  rooms,
  value,
  onChange,
}: {
  rooms: EventFiles["rooms"];
  value: string | undefined;
  onChange: (room: string | undefined) => void;
}) {
  const { open, setOpen, trigger, menu } = useFloatingMenu();
  const options = useMemo(() => rooms.map((room) => ({ key: room.room_id ?? "none", label: room.room })), [rooms]);
  return (
    <div className="rowmenu">
      <button
        ref={trigger}
        type="button"
        className={value ? "ibtn bordered on" : "ibtn bordered"}
        aria-label="Filter by room"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="filter" />
      </button>
      <FloatingMenu open={open} trigger={trigger} menu={menu}>
          <div className="label">Room</div>
          <button
            type="button"
            className="item"
            role="menuitemradio"
            aria-checked={!value}
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
          >
            Every room {!value && <span className="tick">✓</span>}
          </button>
          {options.map((option) => (
            <button
              key={option.key}
              type="button"
              className="item"
              role="menuitemradio"
              aria-checked={value === option.key}
              onClick={() => {
                onChange(option.key);
                setOpen(false);
              }}
            >
              {option.label} {value === option.key && <span className="tick">✓</span>}
            </button>
          ))}
      </FloatingMenu>
    </div>
  );
}

/* ── formatting ─────────────────────────────────────────────────────────── */

function initials(name: string | null): string {
  if (!name) return "–";
  const parts = name.split(",")[0]!.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** "10 min ago" within the day, a date on the event's clock after that. */
function relativeTime(iso: string, timeZone: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) {
    const hours = Math.floor(seconds / 3600);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  return shortDate(iso, timeZone);
}

function shortDate(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone });
}

function fullDate(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

function sessionTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  });
}
