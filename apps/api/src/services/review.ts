import type pg from "pg";
import { appendAudit } from "@pmp/db";
import { reviewLifecycle, transition, requiresAcknowledgment } from "@pmp/domain";
import type { Actor, DomainError, ReviewAction, ReviewState, Result } from "@pmp/domain";
import { err, ok } from "@pmp/domain";
import { noticeToSpeakers } from "./decisionNotice.ts";
import type { DecisionNoticeResult } from "./decisionNotice.ts";

export type DecideInput = {
  readonly versionId: string;
  readonly action: ReviewAction;
  readonly actor: Actor;
  readonly lockVersion: number;
  readonly reason?: string;
  /**
   * What the speaker is told (D-073). Required for `request_changes` and `reject`: a
   * file sent back with no reason cannot be fixed. Also the recorded reason for a reject.
   */
  readonly note?: string;
};

export type DecideOutput = {
  readonly file_version_id: string;
  readonly review_state: ReviewState;
  readonly lock_version: number;
  readonly rooms_queued: number;
  /** Who was told, for `request_changes` and `reject` (D-073). */
  readonly notice?: DecisionNoticeResult;
};

type VersionRow = {
  id: string;
  file_id: string;
  event_id: string;
  client_id: string;
  review_state: ReviewState;
  lock_version: number;
};

/**
 * The review decision, end to end: optimistic lock, domain transition, row
 * update, room fan-out, workflow transition, audit record and outbox event —
 * all inside the caller's transaction (BUILD_SPEC §6.2).
 */
export async function decide(
  tx: pg.PoolClient,
  input: DecideInput,
): Promise<Result<DecideOutput, DomainError>> {
  const { rows } = await tx.query<VersionRow>(
    `SELECT id, file_id, event_id, client_id, review_state, lock_version
       FROM pmp.file_versions WHERE id = $1 FOR UPDATE`,
    [input.versionId],
  );
  const version = rows[0];
  if (!version) {
    return err({ code: "review.not_found", message: "No such file version." });
  }

  if (version.lock_version !== input.lockVersion) {
    return err({
      code: "review.conflict",
      message:
        "This presentation changed while you were looking at it — someone else has already acted on it.",
      current_state: version.review_state,
      detail: { lock_version: version.lock_version },
    });
  }

  /*
   * Only a file that passed its virus scan and finished inspection can be reviewed or
   * approved (WORKFLOW_STATES §3: "Eligible when inspection is in a terminal non-failed
   * state, or failed fully waived"; §1: unscanned files never enter the library). This
   * was not enforced here: a quarantined upload sat in the queue and could be claimed,
   * approved and queued to its room without anyone waiving anything (D-105).
   */
  if (input.action === "claim" || input.action === "approve") {
    const ineligible = await reviewIneligibility(tx, version.id, input.action);
    if (ineligible) return err(ineligible);
  }

  const tellsSpeaker = input.action === "request_changes" || input.action === "reject";
  const note = input.note?.trim() ?? "";
  if (tellsSpeaker && !note) {
    return err({
      code: "review.reason_required",
      message: "Write a message to the speaker saying what to change — it is emailed to them and shown in their portal.",
    });
  }
  if (note.length > 5000) {
    return err({ code: "review.reason_required", message: "Keep the message to the speaker under 5,000 characters." });
  }
  const reason = input.reason ?? (input.action === "reject" ? note : undefined);

  const decision = transition(reviewLifecycle, {
    from: version.review_state,
    action: input.action,
    actor: input.actor,
    ...(reason === undefined ? {} : { reason }),
  });
  if (!decision.ok) return err(decision.error);

  const approved = decision.value.to === "approved";
  const nextLock = version.lock_version + 1;

  await tx.query(
    `UPDATE pmp.file_versions
        SET review_state = $1,
            lock_version = $2,
            approved_at  = CASE WHEN $3 THEN now() ELSE approved_at END,
            approved_by  = CASE WHEN $3 THEN $4::uuid ELSE approved_by END
      WHERE id = $5`,
    [decision.value.to, nextLock, approved, input.actor.id, version.id],
  );

  let roomsQueued = 0;
  if (approved) {
    // A newer approval supersedes the previous one (WORKFLOW_STATES §3).
    await tx.query(
      `UPDATE pmp.file_versions
          SET review_state = 'superseded', lock_version = lock_version + 1
        WHERE file_id = $1 AND id <> $2 AND review_state = 'approved'`,
      [version.file_id, version.id],
    );

    // I-1: the new version is queued for its rooms; the room keeps playing its
    // current copy until this one is delivered and — if it replaces an active
    // copy — acknowledged by the room technician.
    const { rows: roomRows } = await tx.query<{ room_id: string; has_active: boolean }>(
      `SELECT se.room_id,
              EXISTS (SELECT 1 FROM pmp.room_files rf
                       WHERE rf.room_id = se.room_id AND rf.sync_state = 'active') AS has_active
         FROM pmp.files f
         JOIN pmp.slots s     ON s.id = f.slot_id
         JOIN pmp.sessions se ON se.id = s.session_id
        WHERE f.id = $1 AND se.room_id IS NOT NULL`,
      [version.file_id],
    );

    for (const room of roomRows) {
      await tx.query(
        `INSERT INTO pmp.room_files (file_version_id, room_id, event_id, client_id, sync_state)
         VALUES ($1, $2, $3, $4, 'assigned')
         ON CONFLICT DO NOTHING`,
        [version.id, room.room_id, version.event_id, version.client_id],
      );
      roomsQueued += 1;
      await tx.query(
        `INSERT INTO pmp.outbox (topic, payload) VALUES ('sync.rebuild_manifest', $1)`,
        [
          JSON.stringify({
            room_id: room.room_id,
            file_version_id: version.id,
            requires_ack: requiresAcknowledgment(room.has_active),
          }),
        ],
      );
    }
  }

  await tx.query(
    `INSERT INTO pmp.workflow_transitions
       (event_id, client_id, subject_type, subject_id, from_state, to_state, action,
        actor_user_id, reason, is_override)
     VALUES ($1,$2,'file_version.review',$3,$4,$5,$6,$7,$8,$9)`,
    [
      version.event_id,
      version.client_id,
      version.id,
      version.review_state,
      decision.value.to,
      input.action,
      input.actor.id,
      decision.value.reason ?? null,
      decision.value.overridden,
    ],
  );

  await appendAudit(tx, {
    partitionId: version.event_id,
    clientId: version.client_id,
    actorUserId: input.actor.id,
    action: `review.${input.action}`,
    subjectType: "file_version",
    subjectId: version.id,
    detail: { from: version.review_state, to: decision.value.to, rooms_queued: roomsQueued },
    ...(decision.value.reason === undefined ? {} : { reason: decision.value.reason }),
  });

  await tx.query(`INSERT INTO pmp.outbox (topic, payload) VALUES ('file_version.state_changed', $1)`, [
    JSON.stringify({
      file_version_id: version.id,
      event_id: version.event_id,
      review_state: decision.value.to,
    }),
  ]);

  const notice = tellsSpeaker
    ? await noticeToSpeakers(tx, input.actor, {
        versionId: version.id,
        outcome: input.action === "reject" ? "rejected" : "changes_requested",
        message: note,
      })
    : undefined;

  return ok({
    file_version_id: version.id,
    review_state: decision.value.to,
    lock_version: nextLock,
    rooms_queued: roomsQueued,
    ...(notice ? { notice } : {}),
  });
}

/** Why this version may not be claimed or approved, or nothing when it may (D-105). */
async function reviewIneligibility(
  tx: pg.PoolClient,
  versionId: string,
  action: ReviewAction,
): Promise<DomainError | undefined> {
  const { rows } = await tx.query<{ processing_state: string; inspection_state: string; open_blocking: number }>(
    `SELECT fv.processing_state, fv.inspection_state,
            (SELECT count(*)::int FROM pmp.inspection_findings f
              WHERE f.file_version_id = fv.id AND f.severity = 'blocking' AND f.waived_at IS NULL) AS open_blocking
       FROM pmp.file_versions fv WHERE fv.id = $1`,
    [versionId],
  );
  const version = rows[0];
  if (!version) return undefined;
  if (version.processing_state !== "stored") {
    return {
      code: "review.ineligible_conflict",
      message:
        version.processing_state === "quarantined"
          ? "This file failed its virus scan and is quarantined. It can never be approved — ask the speaker for a new file."
          : `This file has not finished its virus scan (${version.processing_state}), so it cannot be reviewed yet.`,
    };
  }
  if (action !== "approve") return undefined;
  if (["pending", "inspecting", "technician_review"].includes(version.inspection_state)) {
    return {
      code: "review.ineligible_conflict",
      message: "This file is still being inspected. It can be approved once inspection finishes.",
    };
  }
  if (version.open_blocking > 0) {
    return {
      code: "review.ineligible_conflict",
      message: `This file has ${version.open_blocking} blocking finding${version.open_blocking === 1 ? "" : "s"}. Waive ${version.open_blocking === 1 ? "it" : "them"} with a reason, or ask the speaker for a new version.`,
    };
  }
  return undefined;
}
