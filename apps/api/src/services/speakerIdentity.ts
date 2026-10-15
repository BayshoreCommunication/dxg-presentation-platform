import type pg from "pg";
import type { DomainError } from "@pmp/domain";

/**
 * A DXG staff account and a speaker account are deliberately separate identities
 * (D-146). Deactivation does not release an account's email; deletion does, by moving
 * the old address to `deleted_email`.
 */
export async function isStaffAccountAddress(tx: pg.PoolClient, email: string): Promise<boolean> {
  const { rows } = await tx.query(
    `SELECT 1 FROM pmp.users
      WHERE lower(email::text) = lower($1)
        AND deleted_at IS NULL
        AND account_kind <> 'speaker'
      LIMIT 1`,
    [email],
  );
  return rows.length > 0;
}

/** One lookup for import previews, where a sheet may contain hundreds of addresses. */
export async function staffAccountAddresses(tx: pg.PoolClient): Promise<Set<string>> {
  const { rows } = await tx.query<{ email: string }>(
    `SELECT lower(email::text) AS email FROM pmp.users
      WHERE deleted_at IS NULL AND account_kind <> 'speaker'`,
  );
  return new Set(rows.map((row) => row.email));
}

export function staffSpeakerConflict(email: string): DomainError {
  return {
    code: "speakers.staff_address_conflict",
    message: `${email} belongs to a DXG staff account, so it can't be used for a speaker. Use a different email address.`,
  };
}
