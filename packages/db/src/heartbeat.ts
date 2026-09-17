import { getPool, closePool } from "./pool.ts";

/**
 * Marks every registered agent as freshly checked in, so a demo or a local run
 * starts with rooms online. Production heartbeats come from the agents (M5-1).
 */
const { rowCount } = await getPool().query(
  `UPDATE pmp.room_agents SET last_heartbeat_at = now() WHERE revoked_at IS NULL`,
);
console.log(`refreshed ${rowCount ?? 0} agent heartbeats`);
await closePool();
