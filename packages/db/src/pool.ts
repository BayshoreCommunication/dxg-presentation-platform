import pg from "pg";
import { dbConfig, ownerConfig } from "./config.ts";

let pool: pg.Pool | undefined;
let ownerPool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  pool ??= new pg.Pool({ ...dbConfig, max: 10 });
  return pool;
}

/**
 * The schema owner's pool, for the two things that genuinely need DDL: applying
 * migrations and seeding. Everything else goes through `getPool`, which connects as a
 * role row security applies to.
 */
export function getOwnerPool(): pg.Pool {
  ownerPool ??= new pg.Pool({ ...ownerConfig, max: 4 });
  return ownerPool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = undefined;
  await ownerPool?.end();
  ownerPool = undefined;
}

export type Scope = {
  /** Absent for pre-authentication work (sign-in, webhooks, session lookup). */
  readonly userId?: string;
  /** Absent when the caller works across clients (DXG staff, system tasks). */
  readonly clientId?: string;
  readonly eventId?: string;
  /**
   * DXG staff and system tasks work across every client. RLS honours this via
   * pmp.is_platform_context(); client-scoped callers must never set it.
   */
  readonly allClients?: boolean;
};

async function applyScope(client: pg.PoolClient, scope: Scope): Promise<void> {
  await client.query("SELECT set_config('app.user_id', $1, true)", [scope.userId ?? ""]);
  await client.query("SELECT set_config('app.client_id', $1, true)", [scope.clientId ?? ""]);
  await client.query("SELECT set_config('app.event_id', $1, true)", [scope.eventId ?? ""]);
  await client.query("SELECT set_config('app.all_clients', $1, true)", [scope.allClients ? "on" : "off"]);
}

/**
 * For work that happens before anyone is authenticated — verifying a password,
 * resolving a session cookie, recording a delivery webhook. It runs in platform
 * context because it cannot yet know whose data it is looking at.
 */
export function withSystemScope<T>(fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  return withScope({ allClients: true }, fn);
}

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
    await applyScope(client, scope);
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
    await applyScope(client, scope);
    return await fn(client);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}
