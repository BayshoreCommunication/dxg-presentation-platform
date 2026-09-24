import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { appendAudit } from "@pmp/db";
import type { Actor, DomainError, Result } from "@pmp/domain";
import { atLeast, err, hasAnyRole, ok } from "@pmp/domain";

/**
 * Device keys for room computers (D-077).
 *
 * A key is `<agent id>.<secret>`: the id says which agent is claiming, the secret proves
 * it. Only the secret's SHA-256 is stored — a key cannot be read back, only replaced —
 * and it is compared in constant time. The room a check-in counts for is the agent's own
 * room, never a room named in the request, so one room's key cannot vouch for another.
 */
const ISSUERS = atLeast("presentation_manager");

const hash = (secret: string) => createHash("sha256").update(secret).digest();

export async function issueDeviceKey(
  tx: pg.PoolClient,
  actor: Actor,
  roomId: string,
): Promise<Result<{ agent_id: string; device_key: string; issued_at: string }, DomainError>> {
  if (!hasAnyRole(actor, ISSUERS)) {
    return err({ code: "agent.forbidden", message: "Issuing a device key needs a presentation manager or above." });
  }
  const { rows: rooms } = await tx.query<{ id: string; name: string; event_id: string; client_id: string }>(
    `SELECT id, name, event_id, client_id FROM pmp.rooms WHERE id = $1`,
    [roomId],
  );
  const room = rooms[0];
  if (!room) return err({ code: "agent.room_not_found", message: "No such room." });

  // The room's agent, or a new one if the room has never had a computer registered.
  const { rows: existing } = await tx.query<{ id: string }>(
    `SELECT id FROM pmp.room_agents WHERE room_id = $1 AND revoked_at IS NULL ORDER BY registered_at DESC LIMIT 1 FOR UPDATE`,
    [roomId],
  );
  let agentId = existing[0]?.id;
  if (!agentId) {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO pmp.room_agents (room_id, event_id, client_id, device_fingerprint, public_key)
       VALUES ($1, $2, $3, $4, '\\x00'::bytea) RETURNING id`,
      [roomId, room.event_id, room.client_id, `${room.name.replace(/\s+/g, "-").toUpperCase()}-KEY`],
    );
    agentId = rows[0]!.id;
  }

  const secret = randomBytes(24).toString("base64url");
  const { rows: issued } = await tx.query<{ key_issued_at: string }>(
    `UPDATE pmp.room_agents
        SET key_hash = $2, key_issued_at = now(), key_issued_by = $3, lock_version = lock_version + 1
      WHERE id = $1 RETURNING key_issued_at`,
    [agentId, hash(secret), actor.id],
  );
  await appendAudit(tx, {
    partitionId: room.event_id,
    clientId: room.client_id,
    actorUserId: actor.id,
    action: "agent.key_issued",
    subjectType: "room_agent",
    subjectId: agentId,
    detail: { room: room.name, replaced_previous: Boolean(existing[0]) },
  });
  return ok({ agent_id: agentId, device_key: `${agentId}.${secret}`, issued_at: issued[0]!.key_issued_at });
}

/**
 * The agent a key belongs to, or null — for a malformed key, an unknown agent, a revoked
 * one, one never issued a key, or a wrong secret alike. The caller answers all of them
 * the same way, so a guess learns nothing about which part was wrong.
 */
export async function agentForKey(
  tx: pg.PoolClient,
  key: string | undefined,
): Promise<{ id: string; room_id: string } | null> {
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{16,})$/i.exec(key ?? "");
  if (!match) return null;
  const [, agentId, secret] = match;
  const { rows } = await tx.query<{ id: string; room_id: string; key_hash: Buffer | null }>(
    `SELECT id, room_id, key_hash FROM pmp.room_agents WHERE id = $1 AND revoked_at IS NULL`,
    [agentId],
  );
  const agent = rows[0];
  if (!agent?.key_hash) return null;
  const offered = hash(secret!);
  if (offered.length !== agent.key_hash.length || !timingSafeEqual(offered, agent.key_hash)) return null;
  return { id: agent.id, room_id: agent.room_id };
}
