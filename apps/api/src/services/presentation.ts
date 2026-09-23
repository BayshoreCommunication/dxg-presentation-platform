import type pg from "pg";
import { appendAudit } from "@pmp/db";
import {
  deriveTalkStatus,
  TALK_STATUS_LABEL,
  reviewLifecycle,
  roomSyncLifecycle,
  transition,
  atLeast,
  hasAnyRole,
} from "@pmp/domain";
import type { Actor, DomainError, Result } from "@pmp/domain";
import { err, ok } from "@pmp/domain";

export type VersionRow = {
  file_version_id: string;
  version_number: number;
  size_bytes: string;
  sha256: string | null;
  source: string;
  processing_state: string;
  inspection_state: string;
  review_state: string;
  lock_version: number;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
  finding_counts: { info: number; warning: number; blocking: number };
  room_states: string[];
  /** The version's PDF copy for the archive (D-072); null until queued, which approval does. */
  pdf_state: "queued" | "converting" | "done" | "failed" | null;
  pdf_error: string | null;
};

export type PresentationDetail = {
  talk: {
    slot_id: string;
    title: string;
    room: string | null;
    starts_at: string;
    track: string | null;
    final_locked: boolean;
    restricted: boolean;
    status: string;
    status_label: string;
  };
  speaker: { id: string; name: string; organization: string | null } | null;
  versions: VersionRow[];
  retained_versions: number;
};

export async function presentationDetail(
  tx: pg.PoolClient,
  slotId: string,
): Promise<PresentationDetail | null> {
  const { rows } = await tx.query<{
    slot_id: string;
    title: string;
    room: string | null;
    starts_at: string;
    track: string | null;
    final_locked: boolean;
    restricted: boolean;
    session_state: string;
    speaker_id: string | null;
    speaker_name: string | null;
  }>(
    `SELECT s.id AS slot_id, s.title, r.name AS room, se.starts_at, t.name AS track,
            s.final_locked, s.restricted, se.session_state,
            sp.id AS speaker_id, sp.full_name AS speaker_name
       FROM pmp.slots s
       JOIN pmp.sessions se ON se.id = s.session_id
       LEFT JOIN pmp.rooms r ON r.id = se.room_id
       LEFT JOIN pmp.tracks t ON t.id = se.track_id
       LEFT JOIN pmp.speaker_assignments sa ON sa.slot_id = s.id
       LEFT JOIN pmp.speakers sp ON sp.id = sa.speaker_id
      WHERE s.id = $1
      LIMIT 1`,
    [slotId],
  );
  const row = rows[0];
  if (!row) return null;

  const { rows: versions } = await tx.query<VersionRow>(
    `SELECT fv.id AS file_version_id, fv.version_number, fv.size_bytes::text,
            encode(fv.sha256, 'hex') AS sha256, fv.source,
            fv.processing_state, fv.inspection_state, fv.review_state, fv.lock_version,
            fv.created_at, fv.approved_at, u.display_name AS approved_by,
            json_build_object(
              'info',     count(*) FILTER (WHERE inf.severity = 'info'     AND inf.waived_at IS NULL),
              'warning',  count(*) FILTER (WHERE inf.severity = 'warning'  AND inf.waived_at IS NULL),
              'blocking', count(*) FILTER (WHERE inf.severity = 'blocking' AND inf.waived_at IS NULL)
            ) AS finding_counts,
            COALESCE(array_agg(DISTINCT rf.sync_state) FILTER (WHERE rf.sync_state IS NOT NULL), '{}') AS room_states,
            pc.state AS pdf_state, pc.error AS pdf_error
       FROM pmp.file_versions fv
       JOIN pmp.files f ON f.id = fv.file_id
       LEFT JOIN pmp.users u ON u.id = fv.approved_by
       LEFT JOIN pmp.pdf_conversions pc ON pc.file_version_id = fv.id
       LEFT JOIN pmp.inspection_findings inf ON inf.file_version_id = fv.id
       LEFT JOIN pmp.room_files rf ON rf.file_version_id = fv.id
      WHERE f.slot_id = $1
      GROUP BY fv.id, u.display_name, pc.state, pc.error
      ORDER BY fv.version_number DESC`,
    [slotId],
  );

  const status = deriveTalkStatus({
    sessionState: row.session_state as never,
    eventArchived: false,
    versions: [...versions]
      .reverse()
      .map((version) => ({
        processing: version.processing_state,
        inspection: version.inspection_state,
        review: version.review_state,
      })) as never,
    roomCopies: versions
      .filter((version) => version.review_state === "approved")
      .flatMap((version) =>
        version.room_states.map((state) => ({
          state,
          requiresAck: state === "synced",
          acknowledged: state === "acknowledged" || state === "active",
        })),
      ) as never,
  });

  const { rows: org } = await tx.query<{ organization: string | null }>(
    `SELECT NULL::text AS organization`,
  );

  return {
    talk: {
      slot_id: row.slot_id,
      title: row.title,
      room: row.room,
      starts_at: row.starts_at,
      track: row.track,
      final_locked: row.final_locked,
      restricted: row.restricted,
      status,
      status_label: TALK_STATUS_LABEL[status],
    },
    speaker: row.speaker_id
      ? { id: row.speaker_id, name: row.speaker_name ?? "", organization: org[0]?.organization ?? null }
      : null,
    versions,
    retained_versions: versions.length,
  };
}

/* ── inspection findings and waivers (FR-INSP-003) ───────────────────────── */

export type FindingRow = {
  id: string;
  check_code: string;
  severity: string;
  detail: Record<string, unknown>;
  waived_by: string | null;
  waived_reason: string | null;
  waived_at: string | null;
};

export async function findingsFor(tx: pg.PoolClient, versionId: string): Promise<FindingRow[]> {
  const { rows } = await tx.query<FindingRow>(
    `SELECT inf.id, inf.check_code, inf.severity, inf.detail,
            u.display_name AS waived_by, inf.waived_reason, inf.waived_at
       FROM pmp.inspection_findings inf
       LEFT JOIN pmp.users u ON u.id = inf.waived_by
      WHERE inf.file_version_id = $1
      ORDER BY CASE inf.severity WHEN 'blocking' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END`,
    [versionId],
  );
  return rows;
}

/**
 * A waiver annotates a finding; it never changes a lifecycle state, it stays
 * visible forever, and it needs an authorised role and a reason (FR-INSP-003).
 */
export async function waiveFinding(
  tx: pg.PoolClient,
  actor: Actor,
  input: { findingId: string; reason: string },
): Promise<Result<{ waived: true }, DomainError>> {
  if (!hasAnyRole(actor, atLeast("presentation_manager"))) {
    return err({
      code: "inspection.forbidden",
      message: `Waiving a finding requires one of: ${atLeast("presentation_manager").join(", ")}.`,
    });
  }
  if (!input.reason.trim()) {
    return err({
      code: "inspection.reason_required",
      message: "A waiver needs a reason — nothing was recorded.",
    });
  }

  const { rows } = await tx.query<{ event_id: string; client_id: string; waived_at: string | null; check_code: string }>(
    `SELECT event_id, client_id, waived_at, check_code FROM pmp.inspection_findings WHERE id = $1`,
    [input.findingId],
  );
  const finding = rows[0];
  if (!finding) return err({ code: "inspection.not_found", message: "No such finding." });
  if (finding.waived_at) {
    return err({ code: "inspection.already_waived", message: "This finding is already waived." });
  }

  await tx.query(
    `UPDATE pmp.inspection_findings SET waived_by = $1, waived_reason = $2, waived_at = now() WHERE id = $3`,
    [actor.id, input.reason, input.findingId],
  );
  await appendAudit(tx, {
    partitionId: finding.event_id,
    clientId: finding.client_id,
    actorUserId: actor.id,
    action: "inspection.waived",
    subjectType: "inspection_finding",
    subjectId: input.findingId,
    detail: { check_code: finding.check_code },
    reason: input.reason,
  });
  return ok({ waived: true });
}

/* ── comments with enforced audiences (FR-REV-003) ───────────────────────── */

export type Lane = "internal" | "client_visible" | "speaker_visible";

export async function addComment(
  tx: pg.PoolClient,
  actor: Actor,
  input: { versionId: string; lane: Lane; body: string },
): Promise<Result<{ id: string }, DomainError>> {
  if (!input.body.trim()) {
    return err({ code: "comments.empty", message: "A comment needs a body." });
  }
  if (input.body.length > 5000) {
    return err({ code: "comments.too_long", message: "Keep a comment under 5,000 characters." });
  }
  const { rows: scope } = await tx.query<{ event_id: string; client_id: string }>(
    `SELECT event_id, client_id FROM pmp.file_versions WHERE id = $1`,
    [input.versionId],
  );
  if (!scope[0]) return err({ code: "comments.not_found", message: "No such version." });

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.comments (event_id, client_id, file_version_id, lane, author_user_id, body)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [scope[0].event_id, scope[0].client_id, input.versionId, input.lane, actor.id, input.body.trim()],
  );
  return ok({ id: rows[0]!.id });
}

/**
 * Request a revision straight from an inspection finding: the speaker-visible
 * comment and the review transition happen together, so a speaker is never told
 * to fix something without the state moving (or the reverse).
 */
export async function requestRevisionFromFinding(
  tx: pg.PoolClient,
  actor: Actor,
  input: { versionId: string; findingId: string; note: string },
): Promise<Result<{ review_state: string }, DomainError>> {
  const { rows } = await tx.query<{ review_state: string; lock_version: number }>(
    `SELECT review_state, lock_version FROM pmp.file_versions WHERE id = $1 FOR UPDATE`,
    [input.versionId],
  );
  const version = rows[0];
  if (!version) return err({ code: "review.not_found", message: "No such version." });

  let from = version.review_state;
  if (from === "awaiting_review") {
    const claim = transition(reviewLifecycle, { from: from as never, action: "claim", actor });
    if (!claim.ok) return err(claim.error);
    await tx.query(
      `UPDATE pmp.file_versions SET review_state = 'in_review', lock_version = lock_version + 1 WHERE id = $1`,
      [input.versionId],
    );
    from = "in_review";
  }

  const decision = transition(reviewLifecycle, {
    from: from as never,
    action: "request_changes",
    actor,
  });
  if (!decision.ok) return err(decision.error);

  await tx.query(
    `UPDATE pmp.file_versions SET review_state = $1, lock_version = lock_version + 1 WHERE id = $2`,
    [decision.value.to, input.versionId],
  );
  const comment = await addComment(tx, actor, {
    versionId: input.versionId,
    lane: "speaker_visible",
    body: input.note,
  });
  if (!comment.ok) return err(comment.error);

  const { rows: scope } = await tx.query<{ event_id: string; client_id: string }>(
    `SELECT event_id, client_id FROM pmp.file_versions WHERE id = $1`,
    [input.versionId],
  );
  await appendAudit(tx, {
    partitionId: scope[0]!.event_id,
    clientId: scope[0]!.client_id,
    actorUserId: actor.id,
    action: "review.request_changes",
    subjectType: "file_version",
    subjectId: input.versionId,
    detail: { from, to: decision.value.to, finding_id: input.findingId, prefilled: true },
  });
  await tx.query(`INSERT INTO pmp.outbox (topic, payload) VALUES ('file_version.state_changed', $1)`, [
    JSON.stringify({ file_version_id: input.versionId, review_state: decision.value.to }),
  ]);

  return ok({ review_state: decision.value.to });
}

/* ── rollback (FR-REV-005) ───────────────────────────────────────────────── */

/**
 * Restores an earlier approved version byte-identically: the current approved
 * version is rolled back, the earlier version's room copies become active again,
 * and the rooms are notified. The bytes are never rebuilt — the earlier object
 * is still in storage under its own checksum.
 */
export async function rollBack(
  tx: pg.PoolClient,
  actor: Actor,
  input: { slotId: string; targetVersionId: string; reason: string },
): Promise<Result<{ restored_version: number; rooms_notified: number }, DomainError>> {
  const { rows: current } = await tx.query<{
    id: string;
    review_state: string;
    event_id: string;
    client_id: string;
  }>(
    `SELECT fv.id, fv.review_state, fv.event_id, fv.client_id
       FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
      WHERE f.slot_id = $1 AND fv.review_state = 'approved'
      ORDER BY fv.version_number DESC LIMIT 1
      FOR UPDATE OF fv`,
    [input.slotId],
  );
  if (!current[0]) {
    return err({ code: "review.nothing_to_roll_back", message: "There is no approved version to roll back." });
  }

  const decision = transition(reviewLifecycle, {
    from: current[0].review_state as never,
    action: "roll_back",
    actor,
    reason: input.reason,
  });
  if (!decision.ok) return err(decision.error);

  const { rows: target } = await tx.query<{ id: string; version_number: number; sha256: string | null }>(
    `SELECT fv.id, fv.version_number, encode(fv.sha256, 'hex') AS sha256
       FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
      WHERE fv.id = $1 AND f.slot_id = $2 AND fv.processing_state = 'stored'`,
    [input.targetVersionId, input.slotId],
  );
  if (!target[0]) {
    return err({
      code: "review.target_not_restorable",
      message: "That version cannot be restored — it is not a stored version of this talk.",
    });
  }

  await tx.query(
    `UPDATE pmp.file_versions SET review_state = $1, lock_version = lock_version + 1 WHERE id = $2`,
    [decision.value.to, current[0].id],
  );

  // The restored version becomes approved again (WORKFLOW_STATES §3, amended):
  // one audited transition, so it then reaches rooms by the ordinary approval
  // path rather than through a second, special delivery route.
  const { rows: targetState } = await tx.query<{ review_state: string }>(
    `SELECT review_state FROM pmp.file_versions WHERE id = $1 FOR UPDATE`,
    [target[0].id],
  );
  const restore = transition(reviewLifecycle, {
    from: targetState[0]!.review_state as never,
    action: "restore",
    actor,
    reason: input.reason,
  });
  if (!restore.ok) return err(restore.error);
  await tx.query(
    `UPDATE pmp.file_versions
        SET review_state = $1, approved_at = now(), approved_by = $2, lock_version = lock_version + 1
      WHERE id = $3`,
    [restore.value.to, actor.id, target[0].id],
  );

  // The rolled-back copy steps aside in every room that holds it.
  const { rows: currentCopies } = await tx.query<{ id: string; room_id: string }>(
    `SELECT id, room_id FROM pmp.room_files WHERE file_version_id = $1 AND sync_state = 'active'`,
    [current[0].id],
  );
  for (const copy of currentCopies) {
    await tx.query(
      `UPDATE pmp.room_files SET sync_state = 'obsolete', lock_version = lock_version + 1 WHERE id = $1`,
      [copy.id],
    );
  }

  // The restored version returns to those rooms. A copy that is still on the
  // machine is reactivated byte-identically; one that is not is queued for the
  // agent, which will verify the same checksum before it becomes visible.
  const rooms = new Set(currentCopies.map((copy) => copy.room_id));
  const { rows: sessionRooms } = await tx.query<{ room_id: string }>(
    `SELECT DISTINCT se.room_id FROM pmp.sessions se
       JOIN pmp.slots s ON s.session_id = se.id
      WHERE s.id = $1 AND se.room_id IS NOT NULL`,
    [input.slotId],
  );
  for (const room of sessionRooms) rooms.add(room.room_id);

  let notified = 0;
  for (const roomId of rooms) {
    const { rows: existing } = await tx.query<{ id: string; sync_state: string }>(
      `SELECT id, sync_state FROM pmp.room_files WHERE file_version_id = $1 AND room_id = $2`,
      [target[0].id, roomId],
    );

    if (existing[0] && existing[0].sync_state === "obsolete") {
      const back = transition(roomSyncLifecycle, {
        from: existing[0].sync_state as never,
        action: "restore",
        actor,
        reason: input.reason,
      });
      if (!back.ok) return err(back.error);
      await tx.query(
        `UPDATE pmp.room_files SET sync_state = $1, lock_version = lock_version + 1 WHERE id = $2`,
        [back.value.to, existing[0].id],
      );
    } else if (!existing[0]) {
      await tx.query(
        `INSERT INTO pmp.room_files (file_version_id, room_id, event_id, client_id, sync_state)
         VALUES ($1, $2, $3, $4, 'assigned')`,
        [target[0].id, roomId, current[0].event_id, current[0].client_id],
      );
    }

    await tx.query(`INSERT INTO pmp.outbox (topic, payload) VALUES ('room_file.rolled_back', $1)`, [
      JSON.stringify({ room_id: roomId, file_version_id: target[0].id, sha256: target[0].sha256 }),
    ]);
    notified += 1;
  }

  await tx.query(
    `INSERT INTO pmp.workflow_transitions
       (event_id, client_id, subject_type, subject_id, from_state, to_state, action, actor_user_id, reason)
     VALUES ($1,$2,'file_version.review',$3,$4,$5,'roll_back',$6,$7)`,
    [
      current[0].event_id,
      current[0].client_id,
      current[0].id,
      current[0].review_state,
      decision.value.to,
      actor.id,
      input.reason,
    ],
  );
  await appendAudit(tx, {
    partitionId: current[0].event_id,
    clientId: current[0].client_id,
    actorUserId: actor.id,
    action: "review.rolled_back",
    subjectType: "file_version",
    subjectId: current[0].id,
    detail: {
      restored_version: target[0].version_number,
      restored_sha256: target[0].sha256,
      rooms_notified: notified,
    },
    reason: input.reason,
  });

  return ok({ restored_version: target[0].version_number, rooms_notified: notified });
}
