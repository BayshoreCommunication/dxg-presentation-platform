/**
 * Gives `pmp_app` the password the application is configured to use.
 *
 * Kept out of the migrations on purpose. A role is cluster-wide and a migration is
 * per-database, so an `ALTER ROLE … PASSWORD` in a migration rotates the credential
 * for every database in the cluster the moment a second one is migrated — which is how
 * this was discovered. A migration is also a file in the repository, which is not
 * where a deployed installation's application password belongs.
 *
 * Reads the password the app itself will use (`PGPASSWORD`, defaulting to the local
 * development value), and connects as the owner, which is the only role allowed to
 * change it. Idempotent: run it whenever the two have drifted apart.
 */
import { getOwnerPool, closePool, dbConfig } from "@pmp/db";

async function run(): Promise<void> {
  const password = dbConfig.password;
  if (!password) {
    throw new Error("PGPASSWORD is empty — refusing to give the application role a blank password");
  }

  const pool = getOwnerPool();
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pmp_app') AS exists`,
  );
  if (!rows[0]?.exists) {
    throw new Error("role pmp_app does not exist — run `npm run db:migrate` first");
  }

  // A literal, not a bind parameter: ALTER ROLE does not take one. The value comes
  // from this machine's own configuration, never from a request.
  await pool.query(`ALTER ROLE pmp_app WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}'`);
  console.log(`pmp_app can sign in as ${dbConfig.user}@${dbConfig.database}`);
}

await run();
await closePool();
