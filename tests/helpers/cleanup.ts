import { withSystemScope } from "@pmp/db";

/**
 * Removes accounts a test suite created, so running the suites does not slowly fill
 * Staff accounts with `probe-…` and `roleless-…` rows that an administrator then has
 * to look past — or clear by wiping the whole database, taking real work with it.
 *
 * **Why the suites create accounts at all.** They deliberately do not mutate the
 * seeded fixtures: a test that changes `m.vega`'s password breaks whichever other
 * suite signs in as her. Creating and then removing is the right trade; only the
 * removing was missing.
 *
 * **Why some rows are deleted and others are not.** Twenty-one tables reference
 * `pmp.users`, and they are not alike. Sessions, challenges, recovery codes, reset
 * tokens and role grants are *state about* an account and go with it. Audit records,
 * comments and workflow transitions are *records of what happened*, and deleting
 * those to tidy a list would be erasing history to make a screen look neater. So this
 * removes the first kind and, if anything of the second kind still holds the row,
 * leaves the account and deactivates it instead of forcing the delete. An account
 * that did real work stays, visibly retired.
 */
export async function removeTestAccounts(emailPrefixes: readonly string[]): Promise<{
  deleted: string[];
  deactivated: string[];
}> {
  const database = process.env.PGDATABASE ?? "pmp_dev";
  /*
   * A guard, not a formality. This deletes user rows, and the only thing separating a
   * test run from someone's real data is which database the environment points at.
   * Refuse anything that is not recognisably a development one.
   */
  if (!/^pmp_(dev|test)/.test(database)) {
    throw new Error(
      `refusing to delete accounts from "${database}" — cleanup only runs against a development database`,
    );
  }

  const deleted: string[] = [];
  const deactivated: string[] = [];

  await withSystemScope(async (tx) => {
    const { rows } = await tx.query<{ id: string; email: string }>(
      `SELECT id, email::text AS email FROM pmp.users
        WHERE ${emailPrefixes.map((_, i) => `email::text LIKE $${i + 1}`).join(" OR ")}`,
      emailPrefixes.map((prefix) => `${prefix}%`),
    );

    for (const user of rows) {
      // State about the account, which has no meaning once the account is gone.
      for (const table of [
        "auth_sessions",
        "mfa_challenges",
        "mfa_recovery_codes",
        "password_reset_tokens",
        "event_roles",
        "client_grants",
      ]) {
        await tx.query(`DELETE FROM pmp.${table} WHERE user_id = $1`, [user.id]);
      }

      try {
        await tx.query("SAVEPOINT drop_user");
        await tx.query(`DELETE FROM pmp.users WHERE id = $1`, [user.id]);
        await tx.query("RELEASE SAVEPOINT drop_user");
        deleted.push(user.email);
      } catch {
        // Something durable still points at this account — it did work worth keeping.
        await tx.query("ROLLBACK TO SAVEPOINT drop_user");
        await tx.query(`UPDATE pmp.users SET is_active = false WHERE id = $1`, [user.id]);
        deactivated.push(user.email);
      }
    }
  });

  return { deleted, deactivated };
}
