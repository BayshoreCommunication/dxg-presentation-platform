import pg from "pg";
import { dbConfig } from "./config.ts";

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ ...dbConfig, max: 10 });
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export type Scope = {
  readonly userId: string;
  readonly clientId: string;
  readonly eventId?: string;
};

/**
 * The only way to touch tenant data (BUILD_SPEC §6.2). Opens a transaction and
 * sets the RLS session variables, so isolation is enforced by Postgres and not
 * by remembering to add a WHERE clause (I-4).
 */
export async function withScope<T>(
  scope: Scope,
  fn: (tx: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [scope.userId]);
    await client.query("SELECT set_config('app.client_id', $1, true)", [scope.clientId]);
    await client.query("SELECT set_config('app.event_id', $1, true)", [scope.eventId ?? ""]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Test helper: run against a real database and always roll back. */
export async function withRollback<T>(
  scope: Scope,
  fn: (tx: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [scope.userId]);
    await client.query("SELECT set_config('app.client_id', $1, true)", [scope.clientId]);
    await client.query("SELECT set_config('app.event_id', $1, true)", [scope.eventId ?? ""]);
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}
