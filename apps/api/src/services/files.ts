import type pg from "pg";
import { appendAudit } from "@pmp/db";
import { writeZip } from "@pmp/files";
import { storage } from "./ingest.ts";

/**
 * Event files (FR-FILE-005, D-079): every presentation file of one event in one place.
 *
 * A *file* is a talk's presentation; each upload to it is a numbered *version*. The list
 * shows one row per file, carrying its newest version, because that is the one anybody is
 * asking about — earlier versions are one click away in the row's history.
 *
 * The whole event is read in one query and filtered here. An event has hundreds of talks,
 * not hundreds of thousands, and doing it in one place keeps the tab counts, the room
 * folders and the page provably drawn from the same rows.
 */

export type FileStatus = "review" | "approved" | "changes" | "blocked" | "other";

export const FILE_STATUS_LABEL: Record<FileStatus, string> = {
  review: "Awaiting review",
  approved: "Approved",
  changes: "Changes requested",
  blocked: "Blocked",
  other: "Other",
};

export type FileRow = {
  file_id: string;
  slot_id: string;
  talk: string;
  restricted: boolean;
  session: string;
  starts_at: string;
  room_id: string | null;
  room: string | null;
  speakers: string | null;
  version_id: string;
  version_number: number;
  versions: number;
  filename: string;
  size_bytes: number;
  total_bytes: number;
  uploaded_at: string;
  uploaded_by: string | null;
  source: string;
  review_state: string;
  processing_state: string;
  inspection_state: string;
  open_findings: number;
  rooms_synced: number;
  status: FileStatus;
  status_label: string;
  downloadable: boolean;
};

export type FileVersionRow = {
  id: string;
  file_id: string;
  version_number: number;
  filename: string;
  size_bytes: number;
  uploaded_at: string;
  uploaded_by: string | null;
  source: string;
  review_state: string;
  processing_state: string;
  sha256: string | null;
  downloadable: boolean;
};

export type FileQuery = {
  q?: string;
  status?: FileStatus | "all";
  roomId?: string;
  sort?: "uploaded" | "name" | "speaker" | "location" | "size";
  dir?: "asc" | "desc";
  page?: number;
  limit?: number;
};

type RawRow = Omit<FileRow, "status" | "status_label" | "downloadable" | "size_bytes" | "total_bytes"> & {
  size_bytes: string;
  total_bytes: string;
};

function statusOf(row: { processing_state: string; inspection_state: string; review_state: string }): FileStatus {
  if (["quarantined", "checksum_failed"].includes(row.processing_state) || row.inspection_state === "failed") {
    return "blocked";
  }
  if (row.review_state === "approved") return "approved";
  if (row.review_state === "changes_requested" || row.review_state === "rejected") return "changes";
  if (row.review_state === "awaiting_review" || row.review_state === "in_review") return "review";
  return "other";
}

/** Only a scanned, clean, stored file can leave the platform; a quarantined one never can. */
const canDownload = (processingState: string): boolean => processingState === "stored";

const FILES_SQL = `
  WITH v AS (
    SELECT fv.*,
           row_number() OVER (PARTITION BY fv.file_id ORDER BY fv.version_number DESC) AS rn,
           count(*)     OVER (PARTITION BY fv.file_id) AS versions,
           sum(fv.size_bytes) OVER (PARTITION BY fv.file_id) AS total_bytes
      FROM pmp.file_versions fv
     WHERE fv.event_id = $1
  )
  SELECT f.id AS file_id, s.id AS slot_id, s.title AS talk, s.restricted,
         se.title AS session, se.starts_at, r.id AS room_id, r.name AS room,
         (SELECT string_agg(sp.full_name, ', ' ORDER BY sp.full_name)
            FROM pmp.speaker_assignments sa
            JOIN pmp.speakers sp ON sp.id = sa.speaker_id
           WHERE sa.slot_id = s.id AND sa.replaced_by IS NULL) AS speakers,
         v.id AS version_id, v.version_number, v.versions::int AS versions,
         v.original_filename AS filename, v.size_bytes::text, v.total_bytes::text,
         v.created_at AS uploaded_at,
         COALESCE(usp.full_name, uu.display_name) AS uploaded_by, v.source,
         v.review_state, v.processing_state, v.inspection_state,
         (SELECT count(*)::int FROM pmp.inspection_findings inf
           WHERE inf.file_version_id = v.id AND inf.waived_at IS NULL
             AND inf.severity IN ('warning', 'blocking')) AS open_findings,
         (SELECT count(*)::int FROM pmp.room_files rf
           WHERE rf.file_version_id = v.id
             AND rf.sync_state IN ('synced', 'acknowledged', 'active')) AS rooms_synced
    FROM v
    JOIN pmp.files f ON f.id = v.file_id
    JOIN pmp.slots s ON s.id = f.slot_id
    JOIN pmp.sessions se ON se.id = s.session_id
    LEFT JOIN pmp.rooms r ON r.id = se.room_id
    LEFT JOIN pmp.speakers usp ON usp.id = v.uploaded_by_speaker
    LEFT JOIN pmp.users uu ON uu.id = v.uploaded_by_user
   WHERE v.rn = 1`;

async function allFiles(tx: pg.PoolClient, eventId: string): Promise<FileRow[]> {
  const { rows } = await tx.query<RawRow>(FILES_SQL, [eventId]);
  return rows.map((row) => {
    const status = statusOf(row);
    return {
      ...row,
      size_bytes: Number(row.size_bytes),
      total_bytes: Number(row.total_bytes),
      status,
      status_label: FILE_STATUS_LABEL[status],
      downloadable: canDownload(row.processing_state),
    };
  });
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function sortRows(rows: FileRow[], sort: NonNullable<FileQuery["sort"]>, dir: "asc" | "desc"): FileRow[] {
  const key = (row: FileRow): string | number => {
    switch (sort) {
      case "name":
        return row.filename;
      case "speaker":
        return row.speakers ?? "";
      case "location":
        return `${row.room ?? "~"} ${row.starts_at}`;
      case "size":
        return row.size_bytes;
      default:
        return Date.parse(row.uploaded_at);
    }
  };
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    const order =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : collator.compare(String(left), String(right));
    return order * sign || collator.compare(a.filename, b.filename);
  });
}

export type EventFiles = {
  rooms: { room_id: string | null; room: string; files: number; bytes: number }[];
  recent: (FileRow & { history: FileVersionRow[] })[];
  counts: Record<FileStatus | "all", number>;
  items: (FileRow & { history: FileVersionRow[] })[];
  total: number;
  page: number;
  pages: number;
  limit: number;
};

export async function eventFiles(tx: pg.PoolClient, eventId: string, query: FileQuery): Promise<EventFiles> {
  const rows = await allFiles(tx, eventId);

  // Folders are the event's rooms — where a file will be played — plus one for talks
  // whose session has no room yet, so nothing silently drops out of the totals. The size is
  // of the current versions, the same files the count and the table describe (D-081);
  // earlier versions are in each file's history.
  const byRoom = new Map<string, { room_id: string | null; room: string; files: number; bytes: number }>();
  for (const row of rows) {
    const id = row.room_id ?? "none";
    const folder = byRoom.get(id) ?? { room_id: row.room_id, room: row.room ?? "No room yet", files: 0, bytes: 0 };
    folder.files += 1;
    folder.bytes += row.size_bytes;
    byRoom.set(id, folder);
  }
  const rooms = [...byRoom.values()].sort((a, b) =>
    a.room_id === null ? 1 : b.room_id === null ? -1 : collator.compare(a.room, b.room),
  );

  const recent = sortRows(rows, "uploaded", "desc").slice(0, 8);

  const counts: EventFiles["counts"] = { all: rows.length, review: 0, approved: 0, changes: 0, blocked: 0, other: 0 };
  for (const row of rows) counts[row.status] += 1;

  const needle = (query.q ?? "").trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (query.status && query.status !== "all" && row.status !== query.status) return false;
    if (query.roomId && (row.room_id ?? "none") !== query.roomId) return false;
    if (!needle) return true;
    return [row.filename, row.talk, row.speakers, row.room, row.session, row.uploaded_by]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  });

  const sorted = sortRows(filtered, query.sort ?? "uploaded", query.dir ?? "desc");
  const limit = Math.min(Math.max(query.limit ?? 10, 1), 100);
  const pages = Math.max(1, Math.ceil(sorted.length / limit));
  const page = Math.min(Math.max(query.page ?? 1, 1), pages);
  const slice = sorted.slice((page - 1) * limit, page * limit);

  // History for the rows on this page and the recent cards: both open the same drawer.
  const history = await versionHistory(tx, [...new Set([...slice, ...recent].map((row) => row.file_id))]);
  const withHistory = (row: FileRow) => ({
    ...row,
    history: history.filter((version) => version.file_id === row.file_id),
  });

  return {
    rooms,
    recent: recent.map(withHistory),
    counts,
    items: slice.map(withHistory),
    total: sorted.length,
    page,
    pages,
    limit,
  };
}

async function versionHistory(tx: pg.PoolClient, fileIds: string[]): Promise<FileVersionRow[]> {
  if (fileIds.length === 0) return [];
  const { rows } = await tx.query<Omit<FileVersionRow, "downloadable" | "size_bytes"> & { size_bytes: string }>(
    `SELECT fv.id, fv.file_id, fv.version_number, fv.original_filename AS filename, fv.size_bytes::text,
            fv.created_at AS uploaded_at, COALESCE(sp.full_name, u.display_name) AS uploaded_by, fv.source,
            fv.review_state, fv.processing_state, encode(fv.sha256, 'hex') AS sha256
       FROM pmp.file_versions fv
       LEFT JOIN pmp.speakers sp ON sp.id = fv.uploaded_by_speaker
       LEFT JOIN pmp.users u ON u.id = fv.uploaded_by_user
      WHERE fv.file_id = ANY($1::uuid[])
      ORDER BY fv.version_number DESC`,
    [fileIds],
  );
  return rows.map((row) => ({ ...row, size_bytes: Number(row.size_bytes), downloadable: canDownload(row.processing_state) }));
}

type DomainError = { code: string; message: string };
type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

type Downloadable = {
  id: string;
  event_id: string;
  client_id: string;
  version_number: number;
  filename: string;
  s3_key: string;
  processing_state: string;
  talk: string;
};

async function loadVersions(tx: pg.PoolClient, ids: string[]): Promise<Downloadable[]> {
  const { rows } = await tx.query<Downloadable>(
    `SELECT fv.id, fv.event_id, fv.client_id, fv.version_number, fv.original_filename AS filename,
            fv.s3_key, fv.processing_state, s.title AS talk
       FROM pmp.file_versions fv
       JOIN pmp.files f ON f.id = fv.file_id
       JOIN pmp.slots s ON s.id = f.slot_id
      WHERE fv.id = ANY($1::uuid[])`,
    [ids],
  );
  return rows;
}

/**
 * One version's original file. Every download is written to the event's audit chain
 * (BUILD_SPEC §12: downloads logged), with who took which bytes.
 */
export async function downloadVersion(
  tx: pg.PoolClient,
  actorUserId: string,
  versionId: string,
): Promise<Result<{ filename: string; body: Buffer }>> {
  const [version] = await loadVersions(tx, [versionId]);
  if (!version) return { ok: false, error: { code: "file_version.not_found", message: "No such file." } };
  if (!canDownload(version.processing_state)) {
    return {
      ok: false,
      error: {
        code: "file.not_downloadable",
        message:
          version.processing_state === "quarantined"
            ? "This file was quarantined by the virus scan and cannot be downloaded."
            : "This file has not finished processing yet.",
      },
    };
  }
  const body = await storage.read(version.s3_key);
  await appendAudit(tx, {
    partitionId: version.event_id,
    clientId: version.client_id,
    actorUserId,
    action: "file.downloaded",
    subjectType: "file_version",
    subjectId: version.id,
    detail: { filename: version.filename, bytes: body.length },
  });
  return { ok: true, value: { filename: version.filename, body } };
}

/** Enough for "the files for this room"; a whole-event bundle is what the archive is for. */
export const BULK_MAX_FILES = 50;
export const BULK_MAX_BYTES = 1024 * 1024 * 1024;

/**
 * Several versions as one zip, built on request. The OpenAPI contract describes an async
 * job with a signed link; that waits for the S3 driver (M2-2), because a signed link needs
 * somewhere to sign. Until then the zip is capped so it stays a request, not a job (D-079).
 */
export async function bulkDownload(
  tx: pg.PoolClient,
  actorUserId: string,
  eventId: string,
  versionIds: string[],
): Promise<Result<{ filename: string; body: Buffer; count: number }>> {
  const ids = [...new Set(versionIds.filter((id) => typeof id === "string"))];
  if (ids.length === 0) return { ok: false, error: { code: "file.bulk_empty", message: "Choose at least one file." } };
  if (ids.length > BULK_MAX_FILES) {
    return {
      ok: false,
      error: { code: "file.bulk_too_many", message: `Choose at most ${BULK_MAX_FILES} files at a time.` },
    };
  }
  const versions = await loadVersions(tx, ids);
  // A version from another event is refused, not skipped: the caller asked for it by id.
  if (versions.length !== ids.length || versions.some((version) => version.event_id !== eventId)) {
    return { ok: false, error: { code: "file_version.not_found", message: "One of those files is not on this event." } };
  }
  const blocked = versions.filter((version) => !canDownload(version.processing_state));
  if (blocked.length > 0) {
    return {
      ok: false,
      error: {
        code: "file.not_downloadable",
        message: `${blocked.length} of the chosen files cannot be downloaded (quarantined or still processing). Deselect them and try again.`,
      },
    };
  }

  const used = new Set<string>();
  const entries: { name: string; body: Buffer }[] = [];
  let bytes = 0;
  for (const version of versions) {
    const body = await storage.read(version.s3_key);
    bytes += body.length;
    if (bytes > BULK_MAX_BYTES) {
      return {
        ok: false,
        error: { code: "file.bulk_too_large", message: "Those files add up to more than 1 GB. Download fewer at a time." },
      };
    }
    // Two talks can share a filename ("final.pptx"); the zip must hold both.
    let name = version.filename.replace(/[\\/:*?"<>|]+/g, "_");
    if (used.has(name.toLowerCase())) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : "";
      name = `${stem} (v${version.version_number}, ${version.id.slice(0, 8)})${ext}`;
    }
    used.add(name.toLowerCase());
    entries.push({ name, body });
  }

  for (const version of versions) {
    await appendAudit(tx, {
      partitionId: version.event_id,
      clientId: version.client_id,
      actorUserId,
      action: "file.downloaded",
      subjectType: "file_version",
      subjectId: version.id,
      detail: { filename: version.filename, bulk: true, files_in_bundle: versions.length },
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return { ok: true, value: { filename: `event-files-${stamp}.zip`, body: writeZip(entries), count: entries.length } };
}
