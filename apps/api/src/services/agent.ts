import { createHash } from "node:crypto";
import type pg from "pg";
import { appendAudit } from "@pmp/db";
import {
  roomSyncLifecycle,
  transition,
  canLaunch,
  requiresAcknowledgment,
  type Actor,
  type DomainError,
  type Result,
  type RoomSyncAction,
  type RoomSyncState,
  err,
  ok,
} from "@pmp/domain";
import { storage } from "./portal.ts";

export type AgentScheduleRow = {
  slot_id: string;
  title: string;
  speaker: string | null;
  starts_at: string;
  file_version_id: string | null;
  version_number: number | null;
  room_file_id: string | null;
  sync_state: RoomSyncState | null;
  lock_version: number | null;
  acknowledged: boolean;
  requires_ack: boolean;
  launchable: boolean;
  presented_at: string | null;
};

export type AgentView = {
  room: { id: string; name: string };
  agent: { id: string | null; fingerprint: string | null; version: string | null; heartbeat_age: number | null };
  library: { files: number; bytes: string; previous_versions: number; updates_waiting: number };
  schedule: AgentScheduleRow[];
};

/** Everything the room view shows (screen 15), computed from the room's own rows. */
export async function agentView(tx: pg.PoolClient, roomId: string): Promise<AgentView | null> {
  const { rows: roomRows } = await tx.query<{
    id: string;
    name: string;
    agent_id: string | null;
    fingerprint: string | null;
    agent_version: string | null;
    heartbeat_age: number | null;
  }>(
    `SELECT r.id, r.name, ra.id AS agent_id, ra.device_fingerprint AS fingerprint,
            ra.agent_version, EXTRACT(EPOCH FROM (now() - ra.last_heartbeat_at))::int AS heartbeat_age
       FROM pmp.rooms r
       LEFT JOIN pmp.room_agents ra ON ra.room_id = r.id AND ra.revoked_at IS NULL
      WHERE r.id = $1`,
    [roomId],
  );
  const room = roomRows[0];
  if (!room) return null;

  const { rows: schedule } = await tx.query<AgentScheduleRow & { presented_at: string | null }>(
    `SELECT s.id AS slot_id, s.title, se.starts_at,
            (SELECT sp.full_name FROM pmp.speaker_assignments sa
               JOIN pmp.speakers sp ON sp.id = sa.speaker_id
              WHERE sa.slot_id = s.id LIMIT 1) AS speaker,
            rf.file_version_id, fv.version_number, rf.id AS room_file_id,
            rf.sync_state, rf.lock_version,
            (rf.acknowledged_at IS NOT NULL) AS acknowledged,
            (SELECT max(ll.occurred_at) FROM pmp.launch_logs ll
              WHERE ll.file_version_id = rf.file_version_id AND ll.action = 'launch') AS presented_at
       FROM pmp.slots s
       JOIN pmp.sessions se ON se.id = s.session_id
       LEFT JOIN pmp.files f ON f.slot_id = s.id
       LEFT JOIN pmp.file_versions fv ON fv.file_id = f.id
       LEFT JOIN pmp.room_files rf ON rf.file_version_id = fv.id AND rf.room_id = $1
                                   AND rf.sync_state <> 'obsolete'
      WHERE se.room_id = $1 AND (rf.id IS NOT NULL OR fv.id IS NULL
            OR fv.version_number = (SELECT max(v2.version_number) FROM pmp.file_versions v2 WHERE v2.file_id = f.id))
      ORDER BY se.starts_at`,
    [roomId],
  );

  const rows = schedule.map((row) => {
    const state = row.sync_state;
    const requiresAck = state === "synced" && !row.acknowledged;
    return {
      ...row,
      requires_ack: requiresAck,
      launchable: state
        ? canLaunch({ state, requiresAck: row.requires_ack ?? requiresAck, acknowledged: row.acknowledged })
        : false,
    };
  });

  const { rows: libraryRows } = await tx.query<{ files: string; bytes: string; previous: string }>(
    `SELECT count(*) FILTER (WHERE rf.sync_state IN ('synced','acknowledged','active'))::text AS files,
            COALESCE(sum(fv.size_bytes) FILTER (WHERE rf.sync_state = 'active'), 0)::text AS bytes,
            count(*) FILTER (WHERE rf.sync_state = 'obsolete')::text AS previous
       FROM pmp.room_files rf
       JOIN pmp.file_versions fv ON fv.id = rf.file_version_id
      WHERE rf.room_id = $1`,
    [roomId],
  );

  return {
    room: { id: room.id, name: room.name },
    agent: {
      id: room.agent_id,
      fingerprint: room.fingerprint,
      version: room.agent_version,
      heartbeat_age: room.heartbeat_age,
    },
    library: {
      files: Number(libraryRows[0]?.files ?? 0),
      bytes: libraryRows[0]?.bytes ?? "0",
      previous_versions: Number(libraryRows[0]?.previous ?? 0),
      updates_waiting: rows.filter((row) => row.sync_state === "synced" && !row.acknowledged).length,
    },
    schedule: rows,
  };
}

/**
 * What the agent's sync engine does, minus the network: fetch what is assigned,
 * "download" it, verify the whole-file checksum, and only then make it visible.
 * A file becomes `active` on its own only when nothing was there before — a
 * replacement waits for the room technician (I-1).
 */
export async function syncRoom(
  tx: pg.PoolClient,
  actor: Actor,
  roomId: string,
): Promise<{ downloaded: number; awaiting_ack: number; activated: number; failed: number }> {
  // Sync transitions are machine transitions: they are performed by the agent
  // under its device credential, not by whoever pressed the button. Passing the
  // human actor here made every transition fail the authority check.
  const agent: Actor = { id: actor.id, roles: actor.roles, isMachine: true };
  const { rows: pending } = await tx.query<{
    id: string;
    file_version_id: string;
    sync_state: RoomSyncState;
    lock_version: number;
    s3_key: string;
    sha256: Buffer | null;
    file_id: string;
    event_id: string;
    client_id: string;
  }>(
    `SELECT rf.id, rf.file_version_id, rf.sync_state, rf.lock_version,
            fv.s3_key, fv.sha256, fv.file_id, rf.event_id, rf.client_id
       FROM pmp.room_files rf
       JOIN pmp.file_versions fv ON fv.id = rf.file_version_id
      WHERE rf.room_id = $1 AND rf.sync_state IN ('assigned', 'sync_failed')
      FOR UPDATE OF rf`,
    [roomId],
  );

  let downloaded = 0;
  let awaitingAck = 0;
  let activated = 0;
  let failed = 0;

  for (const row of pending) {
    const started = await setSyncState(tx, agent, row.id, "start_download", row.sync_state, row.lock_version, roomId);
    if (!started.ok) {
      failed += 1;
      continue;
    }

    // Verify the bytes exactly as the agent would before making them visible (I-3).
    let verified = false;
    try {
      const body = await storage.read(row.s3_key);
      const digest = createHash("sha256").update(body).digest();
      verified = row.sha256 === null || digest.equals(row.sha256);
    } catch {
      verified = false;
    }

    const { rows: current } = await tx.query<{ sync_state: RoomSyncState; lock_version: number }>(
      `SELECT sync_state, lock_version FROM pmp.room_files WHERE id = $1`,
      [row.id],
    );
    const now = current[0]!;

    if (!verified) {
      await setSyncState(tx, agent, row.id, "fail", now.sync_state, now.lock_version, roomId);
      failed += 1;
      continue;
    }

    const stored = await setSyncState(tx, agent, row.id, "verify", now.sync_state, now.lock_version, roomId);
    if (!stored.ok) {
      failed += 1;
      continue;
    }
    downloaded += 1;

    // Was this room already playing a copy of this talk?
    const { rows: existing } = await tx.query<{ id: string; lock_version: number }>(
      `SELECT rf.id, rf.lock_version
         FROM pmp.room_files rf
         JOIN pmp.file_versions fv ON fv.id = rf.file_version_id
        WHERE rf.room_id = $1 AND fv.file_id = $2 AND rf.sync_state = 'active'`,
      [roomId, row.file_id],
    );

    if (requiresAcknowledgment(existing.length > 0)) {
      awaitingAck += 1; // stays `synced` until a room technician acknowledges
      continue;
    }

    const { rows: afterVerify } = await tx.query<{ sync_state: RoomSyncState; lock_version: number }>(
      `SELECT sync_state, lock_version FROM pmp.room_files WHERE id = $1`,
      [row.id],
    );
    const active = await setSyncState(
      tx,
      agent,
      row.id,
      "activate",
      afterVerify[0]!.sync_state,
      afterVerify[0]!.lock_version,
      roomId,
    );
    if (!active.ok) {
      failed += 1;
      continue;
    }
    activated += 1;
  }

  return { downloaded, awaiting_ack: awaitingAck, activated, failed };
}

async function setSyncState(
  tx: pg.PoolClient,
  actor: Actor,
  roomFileId: string,
  action: RoomSyncAction,
  from: RoomSyncState,
  lockVersion: number,
  roomId: string,
): Promise<Result<RoomSyncState, DomainError>> {
  const decision = transition(roomSyncLifecycle, { from, action, actor });
  if (!decision.ok) return err(decision.error);

  const { rowCount } = await tx.query(
    `UPDATE pmp.room_files
        SET sync_state = $1, lock_version = lock_version + 1,
            acknowledged_by = CASE WHEN $2 THEN $3::uuid ELSE acknowledged_by END,
            acknowledged_at = CASE WHEN $2 THEN now() ELSE acknowledged_at END
      WHERE id = $4 AND lock_version = $5`,
    [decision.value.to, action === "acknowledge", actor.id, roomFileId, lockVersion],
  );
  if (rowCount === 0) {
    return err({
      code: "room_sync.conflict",
      message: "This room copy changed while you were looking at it.",
      current_state: from,
    });
  }

  const { rows } = await tx.query<{ event_id: string; client_id: string }>(
    `SELECT event_id, client_id FROM pmp.room_files WHERE id = $1`,
    [roomFileId],
  );
  await tx.query(
    `INSERT INTO pmp.workflow_transitions
       (event_id, client_id, subject_type, subject_id, room_id, from_state, to_state, action, actor_user_id)
     VALUES ($1,$2,'room_file.sync',$3,$4,$5,$6,$7,$8)`,
    [rows[0]!.event_id, rows[0]!.client_id, roomFileId, roomId, from, decision.value.to, action, actor.id],
  );
  await appendAudit(tx, {
    partitionId: rows[0]!.event_id,
    clientId: rows[0]!.client_id,
    actorUserId: actor.id,
    action: `room_sync.${action}`,
    subjectType: "room_file",
    subjectId: roomFileId,
    detail: { room_id: roomId, from, to: decision.value.to },
  });
  return ok(decision.value.to);
}

/** Room-technician acknowledgment of a change that landed after delivery (FR-SYNC-002). */
export async function acknowledge(
  tx: pg.PoolClient,
  actor: Actor,
  roomFileId: string,
  lockVersion: number,
): Promise<Result<{ sync_state: RoomSyncState }, DomainError>> {
  const { rows } = await tx.query<{ sync_state: RoomSyncState; lock_version: number; room_id: string }>(
    `SELECT sync_state, lock_version, room_id FROM pmp.room_files WHERE id = $1 FOR UPDATE`,
    [roomFileId],
  );
  const row = rows[0];
  if (!row) return err({ code: "room_sync.not_found", message: "No such room copy." });

  // Authority first: "you may not do this" is more useful than "someone else
  // changed it", and a forbidden action should say so regardless of staleness.
  const permitted = transition(roomSyncLifecycle, {
    from: row.sync_state,
    action: "acknowledge",
    actor,
  });
  if (!permitted.ok) return err(permitted.error);

  if (row.lock_version !== lockVersion) {
    return err({
      code: "room_sync.conflict",
      message: "This room copy changed while you were looking at it.",
      current_state: row.sync_state,
    });
  }

  const acknowledged = await setSyncState(tx, actor, roomFileId, "acknowledge", row.sync_state, row.lock_version, row.room_id);
  if (!acknowledged.ok) return err(acknowledged.error);

  // Everything after the acknowledgment is the agent acting on it.
  const agent: Actor = { id: actor.id, roles: actor.roles, isMachine: true };

  // The previous copy of this talk steps aside only now, never before.
  const { rows: after } = await tx.query<{ sync_state: RoomSyncState; lock_version: number; file_id: string }>(
    `SELECT rf.sync_state, rf.lock_version, fv.file_id
       FROM pmp.room_files rf JOIN pmp.file_versions fv ON fv.id = rf.file_version_id
      WHERE rf.id = $1`,
    [roomFileId],
  );
  const { rows: previous } = await tx.query<{ id: string; sync_state: RoomSyncState; lock_version: number }>(
    `SELECT rf.id, rf.sync_state, rf.lock_version
       FROM pmp.room_files rf JOIN pmp.file_versions fv ON fv.id = rf.file_version_id
      WHERE rf.room_id = $1 AND fv.file_id = $2 AND rf.sync_state = 'active' AND rf.id <> $3`,
    [row.room_id, after[0]!.file_id, roomFileId],
  );
  for (const old of previous) {
    const retired = await setSyncState(tx, agent, old.id, "obsolete", old.sync_state, old.lock_version, row.room_id);
    if (!retired.ok) return err(retired.error);
  }

  const activated = await setSyncState(
    tx,
    agent,
    roomFileId,
    "activate",
    after[0]!.sync_state,
    after[0]!.lock_version,
    row.room_id,
  );
  if (!activated.ok) return err(activated.error);
  return ok({ sync_state: activated.value });
}

export type LaunchOutcome =
  | { launched: true; at: string; version_number: number | null }
  | { launched: false; reason: string };

/**
 * The launch guard (BUILD_SPEC §6.9): a room may only play its `active`,
 * acknowledged copy. Anything else falls back to the holding screen and is
 * reported — the agent never resolves a "closest matching" file.
 * Driving PowerPoint itself is M5-3, gated on the G0-1 PoC.
 */
export async function launch(
  tx: pg.PoolClient,
  actor: Actor,
  input: { roomId: string; slotId: string },
): Promise<Result<LaunchOutcome, DomainError>> {
  const { rows } = await tx.query<{
    room_file_id: string | null;
    file_version_id: string | null;
    sync_state: RoomSyncState | null;
    acknowledged: boolean;
    agent_id: string | null;
    event_id: string;
    client_id: string;
    version_number: number | null;
  }>(
    // One room may hold several copies of the same talk (the active one plus a
    // newer one waiting to be acknowledged). Pick the active copy first, then a
    // delivered-but-unacknowledged one, so the refusal can explain which it is.
    `SELECT rf.id AS room_file_id, rf.file_version_id, rf.sync_state,
            (rf.acknowledged_at IS NOT NULL) AS acknowledged,
            ra.id AS agent_id, r.event_id, r.client_id, rf.version_number
       FROM pmp.rooms r
       LEFT JOIN pmp.room_agents ra ON ra.room_id = r.id AND ra.revoked_at IS NULL
       LEFT JOIN LATERAL (
         SELECT rf2.id, rf2.file_version_id, rf2.sync_state, rf2.acknowledged_at,
                fv2.version_number
           FROM pmp.room_files rf2
           JOIN pmp.file_versions fv2 ON fv2.id = rf2.file_version_id
           JOIN pmp.files f2 ON f2.id = fv2.file_id
          WHERE rf2.room_id = r.id AND f2.slot_id = $2 AND rf2.sync_state <> 'obsolete'
          ORDER BY CASE rf2.sync_state
                     WHEN 'active' THEN 0 WHEN 'acknowledged' THEN 1
                     WHEN 'synced' THEN 2 ELSE 3 END
          LIMIT 1
       ) rf ON true
      WHERE r.id = $1`,
    [input.roomId, input.slotId],
  );
  const row = rows[0];
  if (!row) return err({ code: "agent.room_not_found", message: "No such room." });

  // A copy only *awaits* acknowledgment while it is `synced`; reaching `active`
  // means that gate was already passed (or never applied). Treating "not
  // acknowledged" as "awaiting acknowledgment" would block every first delivery.
  const awaitingAck = row.sync_state === "synced" && !row.acknowledged;
  const allowed =
    row.sync_state !== null &&
    canLaunch({ state: row.sync_state, requiresAck: awaitingAck, acknowledged: row.acknowledged });

  const { rows: seqRows } = await tx.query<{ next: string }>(
    `SELECT COALESCE(max(agent_seq), 0) + 1 AS next FROM pmp.launch_logs WHERE room_id = $1`,
    [input.roomId],
  );

  if (row.agent_id) {
    await tx.query(
      `INSERT INTO pmp.launch_logs (agent_id, room_id, event_id, client_id, file_version_id,
                                    agent_seq, action, occurred_at, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8)`,
      [
        row.agent_id,
        input.roomId,
        row.event_id,
        row.client_id,
        row.file_version_id,
        seqRows[0]!.next,
        allowed ? "launch" : "holding_screen",
        JSON.stringify({ slot_id: input.slotId, sync_state: row.sync_state, allowed }),
      ],
    );
  }

  if (!allowed) {
    return ok({
      launched: false,
      reason:
        row.sync_state === null
          ? "There is no approved copy of this presentation in this room. Holding screen shown."
          : row.sync_state === "synced"
            ? "A newer approved version is waiting to be acknowledged. Acknowledge it first — the room will not swap files on its own."
            : `The room copy is "${row.sync_state}", not the current playable copy. Holding screen shown.`,
    });
  }

  return ok({ launched: true, at: new Date().toISOString(), version_number: row.version_number });
}
