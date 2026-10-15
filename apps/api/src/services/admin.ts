import type pg from "pg";
import { appendAudit } from "@pmp/db";
import { hashPassword, generateAccessCode, checkPassword } from "@pmp/auth";
import type { Actor, DomainError, EventRole, Result, StaffKind } from "@pmp/domain";
import { err, ok, hasAnyRole, EVENT_ROLES, ROLES_OF_KIND, STAFF_KINDS } from "@pmp/domain";
import { queueTemporaryPasswordEmail } from "./accountMail.ts";

/**
 * Account administration belongs to root admins alone (D-100). Staff — project managers
 * included — manage the events they are on; they do not see the list of people, root
 * admins or other staff. `platform_admin` in an actor's roles is how a root admin
 * arrives here (see `principalFor`).
 */
const ADMIN_ROLES: EventRole[] = ["platform_admin"];

const forbidden = (what: string): DomainError => ({
  code: "admin.forbidden",
  message: `${what} is for DXG Admins only.`,
});

/** DXG Admin, DXG Support staff or DXG Technician staff (D-151); "staff" is the old name for support. */
type AccountType = "root_admin" | "support" | "technician" | "client";

export type StaffRow = {
  id: string;
  email: string;
  display_name: string;
  account_type: AccountType;
  is_active: boolean;
  mfa_enrolled: boolean;
  must_change_password: boolean;
  locked_until: string | null;
  roles: { event_id: string; event_name: string; role: EventRole }[];
  last_sign_in: string | null;
  recovery_codes_left: number;
};

export async function listStaff(tx: pg.PoolClient, actor: Actor): Promise<Result<StaffRow[], DomainError>> {
  if (!hasAnyRole(actor, ADMIN_ROLES)) return err(forbidden("Viewing accounts"));

  const { rows } = await tx.query<StaffRow>(
    `SELECT u.id, u.email::text, u.display_name, u.account_kind,
            CASE WHEN u.is_root_admin THEN 'root_admin' ELSE u.staff_kind END AS account_type,
            u.is_active,
            (u.mfa_enrolled_at IS NOT NULL) AS mfa_enrolled,
            u.must_change_password, u.locked_until,
            COALESCE((SELECT json_agg(json_build_object(
                        'event_id', er.event_id, 'event_name', e.name, 'role', er.role)
                      ORDER BY e.name, er.role)
                        FROM pmp.event_roles er
                        JOIN pmp.events e ON e.id = er.event_id
                       WHERE er.user_id = u.id AND er.role <> 'platform_admin'), '[]'::json) AS roles,
            (SELECT max(a.occurred_at) FROM pmp.auth_attempts a
              WHERE a.identifier = u.email::text AND a.outcome = 'success') AS last_sign_in,
            (SELECT count(*)::int FROM pmp.mfa_recovery_codes r
              WHERE r.user_id = u.id AND r.used_at IS NULL) AS recovery_codes_left
       FROM pmp.users u
      WHERE u.deleted_at IS NULL
      ORDER BY u.is_root_admin DESC, u.display_name`,
  );
  // Speaker accounts (D-146) are not staff and have their own screen.
  return ok(rows.filter((row) => (row as StaffRow & { account_kind?: string }).account_kind !== "speaker"));
}

/** A display name is cosmetic: changing it keeps sign-in and access as they are. */
export async function setDisplayName(
  tx: pg.PoolClient,
  actor: Actor,
  userId: string,
  requested: unknown,
): Promise<Result<{ display_name: string }, DomainError>> {
  if (!hasAnyRole(actor, ADMIN_ROLES)) return err(forbidden("Changing an account name"));
  const displayName = typeof requested === "string" ? requested.trim() : "";
  if (!displayName || displayName.length > 200) {
    return err({ code: "admin.bad_name", message: "Enter a name between 1 and 200 characters." });
  }

  const { rows } = await tx.query<{ display_name: string }>(
    `SELECT display_name FROM pmp.users
      WHERE id = $1 AND deleted_at IS NULL AND account_kind <> 'speaker'
      FOR UPDATE`,
    [userId],
  );
  const target = rows[0];
  if (!target) return err({ code: "admin.not_found", message: "This account no longer exists — it may have been removed. Refresh the page." });

  await tx.query(`UPDATE pmp.users SET display_name = $1 WHERE id = $2`, [displayName, userId]);
  await audit(tx, actor, userId, "admin.name_changed", {
    before: { display_name: target.display_name },
    after: { display_name: displayName },
  });
  return ok({ display_name: displayName });
}

/** A temporary password is shown once and must be changed on first use. */
export async function resetPassword(
  tx: pg.PoolClient,
  actor: Actor,
  userId: string,
): Promise<Result<{ emailed_to: string }, DomainError>> {
  if (!hasAnyRole(actor, ADMIN_ROLES)) return err(forbidden("Resetting a password"));
  const target = await accountOf(tx, userId);
  if (!target) return err({ code: "admin.not_found", message: "This account no longer exists — it may have been removed. Refresh the page." });

  const temporary = generateAccessCode(4, 4);
  const problem = checkPassword(temporary);
  if (problem) return err({ code: `admin.${problem.code}`, message: problem.message });

  const { rowCount } = await tx.query(
    `UPDATE pmp.users
        SET password_hash = $1, password_set_at = now(), must_change_password = true,
            failed_logins = 0, locked_until = NULL
      WHERE id = $2 AND deleted_at IS NULL`,
    [await hashPassword(temporary), userId],
  );
  if (rowCount === 0) return err({ code: "admin.not_found", message: "This account no longer exists — it may have been removed. Refresh the page." });

  // A reset password ends every session that account had open.
  await tx.query(`UPDATE pmp.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
    userId,
  ]);
  // Emailed to the account's own address, never shown to the administrator (D-100).
  await queueTemporaryPasswordEmail(tx, {
    to: target.email,
    displayName: target.display_name,
    temporaryPassword: temporary,
    reason: "reset",
    accountType: kindOf(target),
  });
  await audit(tx, actor, userId, "admin.password_reset", { emailed: true });
  return ok({ emailed_to: target.email });
}

/**
 * Clearing someone's authenticator is the strongest thing an admin can do to
 * another account: it turns a lost phone back into an open door until the next
 * enrolment. It revokes every session, forces re-enrolment, destroys the
 * remaining recovery codes, and is audited with the reason.
 */
export async function resetMfa(
  tx: pg.PoolClient,
  actor: Actor,
  userId: string,
  reason: string,
): Promise<Result<{ reset: true }, DomainError>> {
  if (!hasAnyRole(actor, ADMIN_ROLES)) return err(forbidden("Resetting a sign-in app"));
  if (!reason.trim()) {
    return err({
      code: "admin.reason_required",
      message: "Say why you are resetting their sign-in app — who asked, and how you checked it was them.",
    });
  }

  const { rowCount } = await tx.query(
    `UPDATE pmp.users SET mfa_secret = NULL, mfa_enrolled_at = NULL, mfa_last_counter = NULL WHERE id = $1`,
    [userId],
  );
  if (rowCount === 0) return err({ code: "admin.not_found", message: "This account no longer exists — it may have been removed. Refresh the page." });

  await tx.query(`DELETE FROM pmp.mfa_recovery_codes WHERE user_id = $1`, [userId]);
  await tx.query(`UPDATE pmp.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
    userId,
  ]);
  await audit(tx, actor, userId, "admin.mfa_reset", {}, reason);
  return ok({ reset: true });
}

export async function setActive(
  tx: pg.PoolClient,
  actor: Actor,
  userId: string,
  active: boolean,
): Promise<Result<{ is_active: boolean }, DomainError>> {
  if (!hasAnyRole(actor, ADMIN_ROLES)) return err(forbidden("Changing an account"));
  // Nobody locks themselves out of the platform by accident.
  if (userId === actor.id && !active) {
    return err({ code: "admin.self_lockout", message: "You cannot deactivate your own account." });
  }
  if (!active) {
    const refusal = await lastRootAdminRefusal(tx, userId, "deactivate");
    if (refusal) return err(refusal);
  }

  const { rowCount } = await tx.query(
    `UPDATE pmp.users SET is_active = $1 WHERE id = $2 AND deleted_at IS NULL`,
    [active, userId],
  );
  if (rowCount === 0) return err({ code: "admin.not_found", message: "This account no longer exists — it may have been removed. Refresh the page." });

  if (!active) {
    await tx.query(`UPDATE pmp.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
      userId,
    ]);
  }
  await audit(tx, actor, userId, active ? "admin.reactivated" : "admin.deactivated", {});
  return ok({ is_active: active });
}

export async function unlock(
  tx: pg.PoolClient,
  actor: Actor,
  userId: string,
): Promise<Result<{ unlocked: true }, DomainError>> {
  if (!hasAnyRole(actor, ADMIN_ROLES)) return err(forbidden("Unlocking an account"));
  await tx.query(`UPDATE pmp.users SET failed_logins = 0, locked_until = NULL WHERE id = $1`, [userId]);
  await audit(tx, actor, userId, "admin.unlocked", {});
  return ok({ unlocked: true });
}

export async function grantRole(
  tx: pg.PoolClient,
  actor: Actor,
  input: { userId: string; eventId: string; role: EventRole },
): Promise<Result<{ granted: true }, DomainError>> {
  if (!hasAnyRole(actor, ADMIN_ROLES)) return err(forbidden("Granting a role"));
  if (!EVENT_ROLES.includes(input.role)) {
    return err({ code: "admin.unknown_role", message: "That isn't a role on an event. Choose one from the list." });
  }
  // Root admin is set on the account, not handed out per event (D-100).
  if (input.role === "platform_admin") {
    return err({
      code: "admin.unknown_role",
      message: "DXG Admin isn't an event role. Change the access level on Staff accounts instead.",
    });
  }
  const target = await accountOf(tx, input.userId, true);
  if (!target) return err({ code: "admin.not_found", message: "This account no longer exists — it may have been removed. Refresh the page." });

  const [event] = await lockStaffingEvents(tx, [input.eventId]);
  if (!event) return err({ code: "admin.event_not_found", message: "This event no longer exists — it may have been removed. Refresh the page." });
  if (event.status === "archived" && !target.is_root_admin && target.staff_kind !== "client") {
    return err(archivedStaffingRefusal(event));
  }
  if (isTechnician(target)) {
    const conflict = await technicianRefusal(tx, target, event);
    if (conflict) return err(conflict);
  }

  await tx.query(
    `INSERT INTO pmp.event_roles (user_id, event_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [input.userId, input.eventId, input.role],
  );
  await audit(tx, actor, input.userId, "admin.role_granted", { event_id: input.eventId, role: input.role });
  return ok({ granted: true });
}

export async function revokeRole(
  tx: pg.PoolClient,
  actor: Actor,
  input: { userId: string; eventId: string; role: EventRole },
): Promise<Result<{ revoked: true }, DomainError>> {
  if (!hasAnyRole(actor, ADMIN_ROLES)) return err(forbidden("Revoking a role"));
  // Membership changes share the target → sorted events lock order with conversions.
  await accountOf(tx, input.userId, true);
  await lockStaffingEvents(tx, [input.eventId]);

  await tx.query(`DELETE FROM pmp.event_roles WHERE user_id = $1 AND event_id = $2 AND role = $3`, [
    input.userId,
    input.eventId,
    input.role,
  ]);
  await audit(tx, actor, input.userId, "admin.role_revoked", { event_id: input.eventId, role: input.role });
  return ok({ revoked: true });
}

/**
 * DXG Admin, support staff or technician (D-100, D-151). Promoting is an admin's call;
 * demoting the last active admin is refused, since nobody would be left to promote anyone
 * back. Changing between support and technician keeps the account's events and swaps the
 * roles it holds there for the new kind's.
 */
export async function setAccountType(
  tx: pg.PoolClient,
  actor: Actor,
  userId: string,
  requested: AccountType | "staff",
): Promise<Result<{ account_type: AccountType }, DomainError>> {
  if (!hasAnyRole(actor, ADMIN_ROLES)) return err(forbidden("Changing an account type"));
  const accountType: AccountType = requested === "staff" ? "support" : requested;
  if (accountType !== "root_admin" && !STAFF_KINDS.includes(accountType as StaffKind)) {
    return err({ code: "admin.bad_account_type", message: "Choose an access level: DXG Admin, DXG Support staff, DXG Technician staff or Client access." });
  }
  const target = await accountOf(tx, userId, true);
  if (!target) return err({ code: "admin.not_found", message: "This account no longer exists — it may have been removed. Refresh the page." });
  if (accountType !== "root_admin" && target.is_root_admin) {
    if (userId === actor.id) {
      return err({ code: "admin.self_lockout", message: "You can't remove your own DXG Admin access. Ask another DXG Admin." });
    }
    const refusal = await lastRootAdminRefusal(tx, userId, "change");
    if (refusal) return err(refusal);
  }

  const memberships = await staffingEventsOf(tx, userId);
  const lockedEvents = await lockStaffingEvents(tx, memberships);
  // Archiving/releasing can remove memberships while we wait for an event lock.
  // Do not re-create the roles that were just released.
  const stillAssigned = new Set(await staffingEventsOf(tx, userId));
  const events = lockedEvents.filter((event) => stillAssigned.has(event.id));
  if (accountType === "technician") {
    // A returned error is committed by withScope, so every event must pass before any write.
    for (const event of events) {
      if (event.status === "archived") return err(archivedStaffingRefusal(event));
      const conflict = await technicianRefusal(tx, target, event);
      if (conflict) return err(conflict);
    }
  }

  await tx.query(`UPDATE pmp.users SET is_root_admin = $1, staff_kind = $2 WHERE id = $3`, [
    accountType === "root_admin",
    accountType === "root_admin" ? target.staff_kind : accountType,
    userId,
  ]);
  // The roles held on each event follow the kind (D-151): a technician made support staff
  // keeps their events, as support staff.
  if (accountType !== "root_admin") {
    for (const event of events) await placeOnEvent(tx, userId, event.id, accountType);
  }
  // New powers, or fewer, take effect at the next sign-in rather than mid-session.
  await tx.query(`UPDATE pmp.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
    userId,
  ]);
  await audit(tx, actor, userId, "admin.account_type_changed", { from: kindOf(target), to: accountType });
  return ok({ account_type: accountType });
}

/** The roles a kind holds on an event, and nothing else of the kind-bundled ones. */
async function placeOnEvent(tx: pg.PoolClient, userId: string, eventId: string, kind: StaffKind): Promise<void> {
  const bundled = [...new Set(Object.values(ROLES_OF_KIND).flat())];
  await tx.query(`DELETE FROM pmp.event_roles WHERE user_id = $1 AND event_id = $2 AND role = ANY($3::text[])`, [
    userId,
    eventId,
    bundled,
  ]);
  for (const role of ROLES_OF_KIND[kind]) {
    await tx.query(`INSERT INTO pmp.event_roles (user_id, event_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [
      userId,
      eventId,
      role,
    ]);
  }
}

/**
 * Puts a support staff member or technician on an event, or takes them off it (D-151).
 * The roles follow the account's kind; an administrator no longer ticks them.
 */
export async function assignToEvent(
  tx: pg.PoolClient,
  actor: Actor,
  input: { userId: string; eventId: string; assign: boolean },
): Promise<Result<{ assigned: boolean; roles: readonly EventRole[] }, DomainError>> {
  if (!hasAnyRole(actor, ADMIN_ROLES)) return err(forbidden("Assigning staff"));
  const target = await accountOf(tx, input.userId, true);
  if (!target) return err({ code: "admin.not_found", message: "This account no longer exists — it may have been removed. Refresh the page." });
  if (target.is_root_admin) {
    return err({ code: "admin.not_assignable", message: "A DXG Admin reaches every event already." });
  }
  const [event] = await lockStaffingEvents(tx, [input.eventId]);
  if (!event) return err({ code: "admin.event_not_found", message: "This event no longer exists — it may have been removed. Refresh the page." });

  // An archived event's staff were freed from it (D-181); restore it first to staff it again.
  if (input.assign && event.status === "archived") return err(archivedStaffingRefusal(event));
  if (input.assign) {
    if (isTechnician(target)) {
      const conflict = await technicianRefusal(tx, target, event);
      if (conflict) return err(conflict);
    }
    await placeOnEvent(tx, input.userId, input.eventId, target.staff_kind);
    await audit(tx, actor, input.userId, "admin.assigned", { event_id: input.eventId, kind: target.staff_kind });
    return ok({ assigned: true, roles: ROLES_OF_KIND[target.staff_kind] });
  }
  await tx.query(`DELETE FROM pmp.event_roles WHERE user_id = $1 AND event_id = $2 AND role <> 'platform_admin'`, [
    input.userId,
    input.eventId,
  ]);
  await audit(tx, actor, input.userId, "admin.unassigned", { event_id: input.eventId });
  return ok({ assigned: false, roles: [] });
}

/**
 * Deleting an account (D-100). The row stays, because audit records, role grants and
 * uploads name it; everything that lets it act goes — sign-in, sessions, authenticator,
 * recovery codes and every event role — and the email address is released so the same
 * person can be invited again later. The old address is kept in `deleted_email`.
 */
export async function deleteAccount(
  tx: pg.PoolClient,
  actor: Actor,
  userId: string,
): Promise<Result<{ deleted: true }, DomainError>> {
  if (!hasAnyRole(actor, ADMIN_ROLES)) return err(forbidden("Deleting an account"));
  if (userId === actor.id) {
    return err({ code: "admin.self_lockout", message: "You cannot delete your own account." });
  }
  const target = await accountOf(tx, userId);
  if (!target) return err({ code: "admin.not_found", message: "This account no longer exists — it may have been removed. Refresh the page." });
  const refusal = await lastRootAdminRefusal(tx, userId, "delete");
  if (refusal) return err(refusal);

  await tx.query(
    `UPDATE pmp.users
        SET deleted_at = now(), deleted_email = email::text,
            email = ('deleted-' || id::text || '@deleted.invalid')::citext,
            is_active = false, is_root_admin = false,
            password_hash = NULL, mfa_secret = NULL, mfa_enrolled_at = NULL, mfa_last_counter = NULL,
            failed_logins = 0, locked_until = NULL
      WHERE id = $1`,
    [userId],
  );
  await tx.query(`DELETE FROM pmp.mfa_recovery_codes WHERE user_id = $1`, [userId]);
  await tx.query(`DELETE FROM pmp.event_roles WHERE user_id = $1`, [userId]);
  await tx.query(`UPDATE pmp.password_reset_tokens SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL`, [
    userId,
  ]);
  await tx.query(`UPDATE pmp.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
    userId,
  ]);
  await audit(tx, actor, userId, "admin.account_deleted", {
    email: target.email,
    was: kindOf(target),
  });
  return ok({ deleted: true });
}

type Account = { id: string; email: string; display_name: string; is_root_admin: boolean; is_active: boolean; staff_kind: StaffKind; account_kind: string };

type StaffingEvent = { id: string; name: string; status: string };

const isTechnician = (account: Account): boolean =>
  account.account_kind === "staff" && !account.is_root_admin && account.staff_kind === "technician";

/** Lock the target user first, then events in UUID order; never lock competing users. */
async function lockStaffingEvents(tx: pg.PoolClient, eventIds: readonly string[]): Promise<StaffingEvent[]> {
  if (eventIds.length === 0) return [];
  return (await tx.query<StaffingEvent>(
    `SELECT id, name, status FROM pmp.events WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [eventIds],
  )).rows;
}

async function staffingEventsOf(tx: pg.PoolClient, userId: string): Promise<string[]> {
  return (await tx.query<{ event_id: string }>(
    `SELECT DISTINCT event_id FROM pmp.event_roles WHERE user_id = $1 AND role <> 'platform_admin' ORDER BY event_id`, [userId],
  )).rows.map((row) => row.event_id);
}

const archivedStaffingRefusal = (event: StaffingEvent): DomainError => ({
  code: "admin.event_archived_conflict",
  message: `“${event.name}” is archived, so its staff have been freed. Restore the event first to assign staff to it again.`,
});

/** An inactive but undeleted technician still reserves the event's one technician slot. */
async function technicianRefusal(tx: pg.PoolClient, target: Account, event: StaffingEvent): Promise<DomainError | undefined> {
  // Reassigning an existing technician adds no person, even if historical duplicates remain.
  if (isTechnician(target)) {
    const ownMembership = await tx.query(
      `SELECT 1 FROM pmp.event_roles WHERE user_id = $1 AND event_id = $2 AND role <> 'platform_admin' LIMIT 1`,
      [target.id, event.id],
    );
    if (ownMembership.rows.length > 0) return undefined;
  }
  const { rows } = await tx.query<{ id: string; display_name: string }>(
    `SELECT u.id, u.display_name FROM pmp.users u
      WHERE u.id <> $2 AND u.deleted_at IS NULL AND u.account_kind = 'staff'
        AND NOT u.is_root_admin AND u.staff_kind = 'technician'
        AND EXISTS (SELECT 1 FROM pmp.event_roles er
                     WHERE er.user_id = u.id AND er.event_id = $1 AND er.role <> 'platform_admin')
      ORDER BY u.display_name, u.id LIMIT 1`,
    [event.id, target.id],
  );
  const occupant = rows[0];
  return occupant ? {
    code: "admin.event_technician_conflict",
    message: `“${event.name}” already has ${occupant.display_name} as its DXG Technician staff. Only one technician can be assigned to an event. Remove the current technician first.`,
    detail: { event_id: event.id, event_name: event.name, technician_id: occupant.id, technician_name: occupant.display_name },
  } : undefined;
}

const kindOf = (account: Account): AccountType => (account.is_root_admin ? "root_admin" : account.staff_kind);

/** A live (not deleted) account, or nothing. */
async function accountOf(tx: pg.PoolClient, userId: string, lock = false): Promise<Account | undefined> {
  const { rows } = await tx.query<Account>(
    `SELECT id, email::text, display_name, is_root_admin, is_active, staff_kind, account_kind
       FROM pmp.users WHERE id = $1 AND deleted_at IS NULL ${lock ? "FOR NO KEY UPDATE" : ""}`,
    [userId],
  );
  return rows[0];
}

/** Refuses anything that would leave the platform with no active root admin. */
async function lastRootAdminRefusal(
  tx: pg.PoolClient,
  userId: string,
  what: string,
): Promise<DomainError | undefined> {
  const { rows } = await tx.query<{ is_root_admin: boolean; others: number }>(
    `SELECT u.is_root_admin,
            (SELECT count(*)::int FROM pmp.users o
              WHERE o.is_root_admin AND o.is_active AND o.deleted_at IS NULL AND o.id <> u.id) AS others
       FROM pmp.users u WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0];
  if (row?.is_root_admin && row.others === 0) {
    return {
      code: "admin.last_admin",
      message: `This is the only active DXG Admin, so you can't ${what} it. Make someone else a DXG Admin first.`,
    };
  }
  return undefined;
}

/**
 * Account administration is not scoped to one event, so it is audited against
 * the affected account rather than an event partition.
 */
async function audit(
  tx: pg.PoolClient,
  actor: Actor,
  subjectId: string,
  action: string,
  detail: Record<string, unknown>,
  reason?: string,
): Promise<void> {
  await appendAudit(tx, {
    partitionId: subjectId,
    clientId: subjectId,
    actorUserId: actor.id,
    action,
    subjectType: "user",
    subjectId,
    detail,
    ...(reason ? { reason } : {}),
  });
}
