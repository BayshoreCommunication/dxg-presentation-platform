import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getPool, closePool } from "./pool.ts";

/**
 * Ordered, forward-only migrations. Idempotent: already-applied files are
 * skipped. A database whose schema was applied by the docker entrypoint is
 * baselined on first run rather than re-applied.
 */
const migrationsDir = path.resolve(import.meta.dirname, "../../../db/migrations");

async function run(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS pmp;
    CREATE TABLE IF NOT EXISTS pmp.schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set(
    (await pool.query<{ filename: string }>("SELECT filename FROM pmp.schema_migrations")).rows.map(
      (row) => row.filename,
    ),
  );

  if (applied.size === 0) {
    const { rows } = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'pmp'",
    );
    if (Number(rows[0]?.count ?? 0) > 1) {
      for (const file of files) {
        await pool.query("INSERT INTO pmp.schema_migrations (filename) VALUES ($1)", [file]);
        applied.add(file);
      }
      console.log(`baselined ${files.length} migrations already present in the database`);
    }
  }

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO pmp.schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`migration ${file} failed: ${String(error)}`);
    } finally {
      client.release();
    }
  }

  // Dev-only: the migrations create pmp_app NOLOGIN. Give it a login so tests can
  // connect as the application role and prove RLS actually bites (I-4).
  if (process.env.NODE_ENV !== "production") {
    await pool.query("ALTER ROLE pmp_app LOGIN PASSWORD 'pmp_dev'");
    await pool.query("GRANT USAGE ON SCHEMA pmp TO pmp_app");
    await pool.query("GRANT CONNECT ON DATABASE pmp_dev TO pmp_app");
  }

  console.log("migrations up to date");
  await closePool();
}

await run();
