import type pg from "pg";
import { verifyAddress } from "@pmp/email";

/**
 * The last check before a message reaches the mail provider (D-097).
 *
 * Addresses are checked where they are typed, but mail can also be queued from data that
 * predates that (an older import, a seeded speaker) — so the dispatcher refuses, whatever
 * queued it, any message to:
 *   - an address that is not an address at all, a known typo of a mail provider, or on a
 *     domain that takes no mail (DNS; if DNS cannot answer, it is not held against the
 *     address);
 *   - an address that has **ever bounced or complained, on any event**. A hard bounce means
 *     the mailbox does not exist; a complaint means the person marked us as spam. Sending
 *     again to either is what mail providers punish a sender's reputation for, and the
 *     old check only looked at the one speaker record, not the address.
 * Returns why, or null to send.
 */
export async function suppressionReason(tx: pg.PoolClient, to: string): Promise<string | null> {
  const check = await verifyAddress(to);
  if (!check.ok) return `invalid address: ${check.reason}`;
  const { rows } = await tx.query<{ status: string }>(
    `SELECT status FROM pmp.communications
      WHERE lower(to_address::text) = lower($1) AND status IN ('bounced', 'complained')
      LIMIT 1`,
    [check.address],
  );
  if (rows[0]) return rows[0].status === "complained" ? "suppressed: marked as spam before" : "suppressed: bounced before";
  return null;
}
