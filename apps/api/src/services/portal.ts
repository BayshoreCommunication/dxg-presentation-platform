import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import type { Finding } from "@pmp/files";
import { deriveTalkStatus, TALK_STATUS_LABEL } from "@pmp/domain";
import { appendAudit } from "@pmp/db";
import { ingestVersion, storage } from "./ingest.ts";

export { storage };

/** Speaker tokens are stored hashed and recipient-bound (BUILD_SPEC §13). */
export const hashToken = (token: string): Buffer => createHash("sha256").update(token).digest();

/**
 * When a speaker's personal link stops working (D-141): 30 days from now, or the end of
 * the seventh day after the event, whichever is later — on the event's clock. Speakers come
 * back on their presentation day to check and download their files, and a link sent six
 * weeks ahead used to have expired by then. SQL for `expires_at`; `$2` is the event's id
 * in every statement that uses it.
 */
export const SPEAKER_LINK_EXPIRES_SQL = `GREATEST(now() + interval '30 days',
  (SELECT (e.ends_on + 8)::timestamp AT TIME ZONE e.timezone FROM pmp.events e WHERE e.id = $2))`;

export type PortalSession = {
  speaker_id: string;
  speaker_name: string;
  event_id: string;
  client_id: string;
  event_name: string;
  timezone: string;
};

export async function resolveToken(tx: pg.PoolClient, token: string): Promise<PortalSession | null> {
  const { rows } = await tx.query<PortalSession>(
    `SELECT sp.id AS speaker_id, sp.full_name AS speaker_name, e.id AS event_id,
            e.client_id, e.name AS event_name, e.timezone
       FROM pmp.speaker_tokens st
       JOIN pmp.speakers sp ON sp.id = st.speaker_id
       JOIN pmp.events e ON e.id = st.event_id
      WHERE st.token_hash = $1
        AND sp.removed_at IS NULL
        AND st.revoked_at IS NULL
        AND st.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] ?? null;
}

/** One upload, as its speaker sees it (D-140). */
export type PortalVersion = {
  id: string;
  version_number: number;
  file_name: string;
  size_bytes: string;
  created_at: string;
  /** processing_state: stored, quarantined, checking… */
  state: string;
  review_state: string;
  /** A clean, stored file — the only kind that can be downloaded. */
  downloadable: boolean;
};

export type PortalTalk = {
  slot_id: string;
  title: string;
  /** The session this presentation is in — its own title, which can differ from the talk's. */
  session_title: string;
  room: string | null;
  starts_at: string;
  /** The talk's end, or its session's (D-140: Preseria shows the duration). */
  ends_at: string | null;
  final_locked: boolean;
  status: string;
  status_label: string;
  versions: PortalVersion[];
  /**
   * What the room will show (D-140): the approved version, and whether DXG has loaded it
   * onto the room's PC (D-125). Null until a version is approved.
   */
  room_copy: { version_number: number; loaded: boolean } | null;
  findings: Finding[];
  /** Notes the DXG team wrote to the speaker, newest first (D-070). Never internal or client-lane notes. */
  feedback: { body: string; created_at: string; version_number: number }[];
};

/** A speaker sees only their own assignments, and only speaker-visible detail. */
export async function portalTalks(tx: pg.PoolClient, session: PortalSession): Promise<PortalTalk[]> {
  const { rows } = await tx.query<{
    slot_id: string;
    title: string;
    session_title: string;
    room: string | null;
    starts_at: string;
    ends_at: string | null;
    final_locked: boolean;
    session_state: string;
    versions: { processing: string; inspection: string; review: string }[] | null;
    version_rows: Omit<PortalVersion, "downloadable">[] | null;
    room_copy: { version_number: number; loaded: boolean } | null;
    findings: Finding[] | null;
    feedback: { body: string; created_at: string; version_number: number }[] | null;
  }>(
    `SELECT s.id AS slot_id, s.title, se.title AS session_title, r.name AS room, se.starts_at, COALESCE(s.ends_at, se.ends_at) AS ends_at,
            s.final_locked, se.session_state,
            (SELECT json_agg(json_build_object('processing', fv.processing_state,
                                               'inspection', fv.inspection_state,
                                               'review', fv.review_state)
                             ORDER BY fv.version_number)
               FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
              WHERE f.slot_id = s.id) AS versions,
            (SELECT json_agg(json_build_object('id', fv.id,
                                               'version_number', fv.version_number,
                                               'file_name', fv.original_filename,
                                               'size_bytes', fv.size_bytes::text,
                                               'created_at', fv.created_at,
                                               'state', fv.processing_state,
                                               'review_state', fv.review_state)
                             ORDER BY fv.version_number DESC)
               FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
              WHERE f.slot_id = s.id) AS version_rows,
            -- What the room will show (D-140): the approved version, and whether it is ticked
            -- loaded on the room's PC (D-125) in the talk's current room.
            (SELECT json_build_object('version_number', fv.version_number,
                                      'loaded', EXISTS (SELECT 1 FROM pmp.room_files rf
                                                         WHERE rf.file_version_id = fv.id
                                                           AND rf.room_id = se.room_id
                                                           AND rf.sync_state = 'active'))
               FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
              WHERE f.slot_id = s.id AND fv.review_state = 'approved'
              ORDER BY fv.version_number DESC LIMIT 1) AS room_copy,
            (SELECT json_agg(json_build_object('check_code', inf.check_code,
                                               'severity', inf.severity, 'detail', inf.detail))
               FROM pmp.inspection_findings inf
               JOIN pmp.file_versions fv ON fv.id = inf.file_version_id
               JOIN pmp.files f ON f.id = fv.file_id
              WHERE f.slot_id = s.id AND inf.waived_at IS NULL
                AND fv.version_number = (SELECT max(fv2.version_number) FROM pmp.file_versions fv2
                                           JOIN pmp.files f2 ON f2.id = fv2.file_id
                                          WHERE f2.slot_id = s.id)) AS findings,
            -- The speaker lane only (FR-REV-003, D-070): internal notes and client-lane
            -- comments never reach a speaker, whichever version they were left on.
            (SELECT json_agg(json_build_object('body', c.body, 'created_at', c.created_at,
                                               'version_number', fv.version_number)
                             ORDER BY c.created_at DESC)
               FROM pmp.comments c
               JOIN pmp.file_versions fv ON fv.id = c.file_version_id
               JOIN pmp.files f ON f.id = fv.file_id
              WHERE f.slot_id = s.id AND c.lane = 'speaker_visible') AS feedback
       FROM pmp.speaker_assignments sa
       JOIN pmp.slots s ON s.id = sa.slot_id
       JOIN pmp.sessions se ON se.id = s.session_id
       LEFT JOIN pmp.rooms r ON r.id = se.room_id
      WHERE sa.speaker_id = $1 AND sa.replaced_by IS NULL
      ORDER BY se.starts_at`,
    [session.speaker_id],
  );

  return rows.map((row) => {
    const status = deriveTalkStatus({
      sessionState: row.session_state as never,
      eventArchived: false,
      versions: (row.versions ?? []) as never,
      roomCopies: [],
    });
    return {
      slot_id: row.slot_id,
      title: row.title,
      session_title: row.session_title,
      room: row.room,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      final_locked: row.final_locked,
      status,
      status_label: TALK_STATUS_LABEL[status],
      // Only the approved version (D-144): the one the room will show is the one a speaker takes away.
      versions: (row.version_rows ?? []).map((version) => ({
        ...version,
        downloadable: version.state === "stored" && version.review_state === "approved",
      })),
      room_copy: row.room_copy,
      findings: row.findings ?? [],
      feedback: row.feedback ?? [],
    };
  });
}

export type UploadSession = {
  upload_id: string;
  slot_id: string;
  file_name: string;
  total_bytes: number;
  part_size: number;
};

const PART_SIZE = 5 * 1024 * 1024;

/** FR-FILE-002/003: resumable multipart upload, ≤10 GB, originals preserved. */
export async function beginUpload(
  tx: pg.PoolClient,
  session: PortalSession,
  input: { slotId: string; fileName: string; totalBytes: number },
): Promise<{ ok: true; value: UploadSession } | { ok: false; code: string; message: string }> {
  const allowed = [".pptx", ".ppt", ".pdf", ".key"];
  if (!allowed.some((extension) => input.fileName.toLowerCase().endsWith(extension))) {
    return {
      ok: false,
      code: "file.type_not_allowed",
      message: "Only PowerPoint (.pptx or .ppt), Keynote (.key) or PDF files can be uploaded. Save your presentation in one of these and try again.",
    };
  }
  if (input.totalBytes > 10 * 1024 * 1024 * 1024) {
    return { ok: false, code: "file.too_large", message: "That file is larger than 10 GB, the most we can accept. Make it smaller (for example, compress the videos) and try again." };
  }

  const { rows: locked } = await tx.query<{ final_locked: boolean }>(
    `SELECT s.final_locked FROM pmp.slots s
       JOIN pmp.speaker_assignments sa ON sa.slot_id = s.id
      WHERE s.id = $1 AND sa.speaker_id = $2`,
    [input.slotId, session.speaker_id],
  );
  if (!locked[0]) {
    return { ok: false, code: "portal.not_your_talk", message: "That talk is not assigned to you." };
  }
  if (locked[0].final_locked) {
    return {
      ok: false,
      code: "file.final_locked",
      message:
        "This presentation has been confirmed as the final onsite version in the Speaker Ready Room, so it can no longer be replaced here. Please speak to the team onsite.",
    };
  }

  const uploadId = randomUUID();
  await tx.query(
    `INSERT INTO pmp.idempotency_keys (key, request_hash, response_body, status_code)
     VALUES ($1, $2, $3, 201)`,
    [
      uploadId,
      `upload:${input.slotId}`,
      JSON.stringify({ slot_id: input.slotId, file_name: input.fileName, total_bytes: input.totalBytes }),
    ],
  );

  return {
    ok: true,
    value: {
      upload_id: uploadId,
      slot_id: input.slotId,
      file_name: input.fileName,
      total_bytes: input.totalBytes,
      part_size: PART_SIZE,
    },
  };
}

export async function uploadState(uploadId: string): Promise<{ received: number[]; bytes: number }> {
  const parts = await storage.listParts(uploadId);
  return {
    received: parts.map((part) => part.partNumber),
    bytes: parts.reduce((sum, part) => sum + part.size, 0),
  };
}

export type CompleteResult = {
  file_version_id: string;
  version_number: number;
  sha256: string;
  processing_state: string;
  inspection_state: string;
  findings: Finding[];
};

/**
 * Completion runs the real pipeline in order: assemble → whole-file checksum →
 * scan (fail closed) → store → inspect. `stored` is unreachable without a clean
 * scan, so invariant I-2 holds here exactly as it does in the domain package.
 */
export async function completeUpload(
  tx: pg.PoolClient,
  session: PortalSession,
  input: { uploadId: string; slotId: string; fileName: string; expectedSha256?: string },
): Promise<{ ok: true; value: CompleteResult } | { ok: false; code: string; message: string }> {
  const result = await ingestVersion(tx, {
    eventId: session.event_id,
    clientId: session.client_id,
    slotId: input.slotId,
    fileName: input.fileName,
    uploadId: input.uploadId,
    source: "portal",
    speakerId: session.speaker_id,
    ...(input.expectedSha256 === undefined ? {} : { expectedSha256: input.expectedSha256 }),
  });
  if (!result.ok) return { ok: false, code: result.error.code, message: result.error.message };
  return { ok: true, value: result.value };
}

/**
 * A speaker downloads one of their own uploads (D-140, after Preseria's presenter
 * dashboard). The portal runs without row-level security, so ownership is checked here:
 * the version must belong to a presentation this speaker is currently assigned to, on this
 * event. Anyone else's file — a co-presenter's included (D-137) — is "not found". Only a
 * clean, stored file leaves; every download is in the audit chain.
 */
export async function portalDownload(
  tx: pg.PoolClient,
  session: PortalSession,
  versionId: string,
): Promise<{ ok: true; filename: string; body: Buffer } | { ok: false; status: number; code: string; message: string }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(versionId)) {
    return { ok: false, status: 404, code: "file_version.not_found", message: "That file isn't one of yours." };
  }
  const { rows } = await tx.query<{
    id: string;
    filename: string;
    s3_key: string;
    processing_state: string;
    review_state: string;
    version_number: number;
  }>(
    `SELECT fv.id, fv.original_filename AS filename, fv.s3_key, fv.processing_state, fv.review_state, fv.version_number
       FROM pmp.file_versions fv
       JOIN pmp.files f ON f.id = fv.file_id
       JOIN pmp.speaker_assignments sa ON sa.slot_id = f.slot_id
      WHERE fv.id = $1 AND fv.event_id = $2 AND sa.speaker_id = $3 AND sa.replaced_by IS NULL
      LIMIT 1`,
    [versionId, session.event_id, session.speaker_id],
  );
  const version = rows[0];
  if (!version) return { ok: false, status: 404, code: "file_version.not_found", message: "That file isn't one of yours." };
  if (version.processing_state !== "stored") {
    return {
      ok: false,
      status: 409,
      code: "file.not_downloadable",
      message:
        version.processing_state === "quarantined"
          ? "This file failed the security check, so it was not kept and can't be downloaded."
          : "This file is still being checked. Try again in a minute.",
    };
  }
  /*
   * Only the approved version (D-144). A speaker's earlier uploads, and one still in
   * review, stay with the DXG team: the version a speaker takes away is the one the
   * room will show, so there is never a question of which copy is "the" presentation.
   */
  if (version.review_state !== "approved") {
    return {
      ok: false,
      status: 403,
      code: "file.not_approved",
      message: "Only your approved presentation can be downloaded. This version hasn't been approved.",
    };
  }
  const body = await storage.read(version.s3_key);
  await appendAudit(tx, {
    partitionId: session.event_id,
    clientId: session.client_id,
    action: "file.downloaded",
    subjectType: "file_version",
    subjectId: version.id,
    detail: { filename: version.filename, bytes: body.length, by_speaker: session.speaker_id, via: "speaker_portal" },
  });
  return { ok: true, filename: version.filename, body };
}
