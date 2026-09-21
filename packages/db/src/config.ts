/** Local development defaults match docker-compose.yml (D-009). Never a real secret. */
const host = process.env.PGHOST ?? "127.0.0.1";
const port = Number(process.env.PGPORT ?? 5434);
const database = process.env.PGDATABASE ?? "pmp_dev";

/**
 * How the application connects: as `pmp_app`, which owns nothing (D-035).
 *
 * It used to connect as `pmp`, the schema owner and a superuser — and a superuser
 * bypasses row security, so every policy migration 005 wrote had been dead since the
 * day it was written. Connecting as a role the policies actually apply to is the whole
 * of the fix; `pmp_app` cannot create, drop or alter anything, and cannot update or
 * delete the append-only tables at all.
 */
export const dbConfig = {
  host,
  port,
  user: process.env.PGUSER ?? "pmp_app",
  password: process.env.PGPASSWORD ?? "pmp_app_dev",
  database,
} as const;

/**
 * How migrations and the seed connect: as the schema owner, which is the only thing
 * that needs DDL. Kept separate so that raising the application's privileges requires
 * changing this file rather than setting an environment variable.
 */
export const ownerConfig = {
  host,
  port,
  user: process.env.PGOWNER ?? "pmp",
  password: process.env.PGOWNER_PASSWORD ?? "pmp_dev",
  database,
} as const;
