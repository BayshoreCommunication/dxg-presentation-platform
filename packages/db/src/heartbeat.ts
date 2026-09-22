import { withSystemScope, closePool } from "./pool.ts";

/**
 * Marks every registered agent as freshly checked in, so a demo or a local run
 * starts with rooms online. Production heartbeats come from the agents (M5-1).
 *
 * Runs in platform context: `room_agents` is under forced row security, so an
 * unscoped connection matches nothing and the update silently affects no rows.
 */
const rowCount = await withSystemScope(async (tx) => {
  const { rowCount } = await tx.query(
    `UPDATE pmp.room_agents SET last_heartbeat_at = now() WHERE revoked_at IS NULL`,
  );
  return rowCount ?? 0;
});
console.log(`refreshed ${rowCount} agent heartbeats`);
await closePool();
