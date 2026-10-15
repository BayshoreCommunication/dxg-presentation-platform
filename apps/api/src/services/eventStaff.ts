import type pg from "pg";
import { appendAudit } from "@pmp/db";

/**
 * Freeing staff from a finished event (D-181, Travis): "when an event moves to archive or the
 * event has been done, we should free the staff and technician from the events".
 *
 * Support staff and technicians lose their roles on the event — it stops being theirs, and they
 * stop reaching it — and who worked it is kept in `event_staff_history`, shown as "Worked this
 * event" on Event assignments. Clients (their own event) and DXG Admins (every event) are not
 * released. Restoring an archived event does not put anyone back: assign them again.
 */
export type ReleaseReason = "archived" | "ended";

export async function releaseEventStaff(
  tx: pg.PoolClient,
  input: { eventId: string; reason: ReleaseReason; actorUserId?: string | undefined },
): Promise<{ released: number }> {
  // Use the same event lock as assignments/conversions before recording and removing roles.
  await tx.query(`SELECT id FROM pmp.events WHERE id = $1 FOR UPDATE`, [input.eventId]);
  const { rows } = await tx.query<{ user_id: string; role: string; created_at: string; client_id: string }>(
    `SELECT er.user_id, er.role, er.created_at, e.client_id
       FROM pmp.event_roles er
       JOIN pmp.users u ON u.id = er.user_id
       JOIN pmp.events e ON e.id = er.event_id
      WHERE er.event_id = $1
        AND u.account_kind = 'staff' AND NOT u.is_root_admin
        AND u.staff_kind IN ('support', 'technician')
        AND er.role <> 'platform_admin'`,
    [input.eventId],
  );
  if (rows.length === 0) return { released: 0 };

  for (const row of rows) {
    await tx.query(
      `INSERT INTO pmp.event_staff_history (event_id, client_id, user_id, role, assigned_at, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.eventId, row.client_id, row.user_id, row.role, row.created_at, input.reason],
    );
  }
  await tx.query(
    `DELETE FROM pmp.event_roles er
      USING pmp.users u
      WHERE er.event_id = $1 AND u.id = er.user_id
        AND u.account_kind = 'staff' AND NOT u.is_root_admin
        AND u.staff_kind IN ('support', 'technician')
        AND er.role <> 'platform_admin'`,
    [input.eventId],
  );
  const people = [...new Set(rows.map((row) => row.user_id))];
  await appendAudit(tx, {
    partitionId: input.eventId,
    clientId: rows[0]!.client_id,
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    action: "events.staff_released",
    subjectType: "event",
    subjectId: input.eventId,
    detail: { reason: input.reason, users: people, roles: rows.length },
  });
  return { released: people.length };
}

/**
 * The day after an event's last day — on the event's own clock — its staff are freed, whether
 * or not anyone has archived it yet. Run by the worker; returns what it did.
 */
export async function releaseEndedEvents(
  tx: pg.PoolClient,
  /** Only these events — a test checks one event without touching the seed's (which has ended). */
  only?: readonly string[],
): Promise<{ event_id: string; released: number }[]> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT e.id
       FROM pmp.events e
      WHERE e.status <> 'archived'
        AND ($1::uuid[] IS NULL OR e.id = ANY($1::uuid[]))
        AND e.ends_on < (now() AT TIME ZONE e.timezone)::date
        AND EXISTS (SELECT 1 FROM pmp.event_roles er JOIN pmp.users u ON u.id = er.user_id
                     WHERE er.event_id = e.id AND u.account_kind = 'staff' AND NOT u.is_root_admin
                       AND u.staff_kind IN ('support', 'technician') AND er.role <> 'platform_admin')
      ORDER BY e.id`,
    [only ? [...only] : null],
  );
  const done: { event_id: string; released: number }[] = [];
  for (const row of rows) {
    const { released } = await releaseEventStaff(tx, { eventId: row.id, reason: "ended" });
    done.push({ event_id: row.id, released });
  }
  return done;
}

/** Whether the worker frees staff from ended events: on in production, opt-in elsewhere (D-181). */
export function releasingEndedEvents(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.RELEASE_ENDED_EVENTS === "0") return false;
  return env.RELEASE_ENDED_EVENTS === "1" || env.NODE_ENV === "production";
}

/** Who worked each event, once freed from it — for Event assignments (D-181). */
export type WorkedRow = { event_id: string; user_id: string; display_name: string; role: string; released_at: string; reason: ReleaseReason };

export async function eventStaffHistory(tx: pg.PoolClient): Promise<WorkedRow[]> {
  const { rows } = await tx.query<WorkedRow>(
    `SELECT DISTINCT ON (h.event_id, h.user_id, h.role)
            h.event_id, h.user_id, u.display_name, h.role, h.released_at::text, h.reason
       FROM pmp.event_staff_history h
       JOIN pmp.users u ON u.id = h.user_id
      ORDER BY h.event_id, h.user_id, h.role, h.released_at DESC`,
  );
  return rows;
}
