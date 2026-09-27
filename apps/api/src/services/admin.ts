import type pg from "pg";
import { appendAudit } from "@pmp/db";
import { hashPassword, generateAccessCode, checkPassword } from "@pmp/auth";
import type { Actor, DomainError, EventRole, Result } from "@pmp/domain";
import { err, ok, hasAnyRole, EVENT_ROLES } from "@pmp/domain";
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
  message: `${what} is for root admins only.`,
});

type AccountType = "root_admin" | "staff";

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
    `SELECT u.id, u.email::text, u.display_name,
            CASE WHEN u.is_root_admin THEN 'root_admin' ELSE 'staff' END AS account_type,
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
  return ok(rows);
}

/** A temporary password is shown once and must be changed on first use. */
export async function resetPassword(
  tx: pg.PoolClient,
  actor: Actor,
  userId: string,
): Promise<Result<{ emailed_to: string }, DomainError>> {
  if (!hasAnyRole(actor, ADMIN_ROLES)) return err(forbidden("Resetting a password"));
  const target = await accountOf(tx, userId);
  if (!target) return err({ code: "admin.not_found", message: "No such account." });

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
  if (rowCount === 0) return err({ code: "admin.not_found", message: "No such account." });

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
    accountType: target.is_root_admin ? "root_admin" : "staff",
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
  if (!hasAnyRole(actor, ADMIN_ROLES)) return err(forbidden("Resetting an authenticator"));
  if (!reason.trim()) {
    return err({
      code: "admin.reason_required",
      message: "Resetting an authenticator needs a reason — who asked, and how you verified them.",
    });
  }

  const { rowCount } = await tx.query(
    `UPDATE pmp.users SET mfa_secret = NULL, mfa_enrolled_at = NULL, mfa_last_counter = NULL WHERE id = $1`,
    [userId],
  );
  if (rowCount === 0) return err({ code: "admin.not_found", message: "No such account." });

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
  if (rowCount === 0) return err({ code: "admin.not_found", message: "No such account." });

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
    return err({ code: "admin.unknown_role", message: `"${input.role}" is not a role.` });
  }
  // Root admin is set on the account, not handed out per event (D-100).
  if (input.role === "platform_admin") {
    return err({
      code: "admin.unknown_role",
      message: "Root admin is not an event role. Change the account type on Staff accounts instead.",
    });
  }
  const target = await accountOf(tx, input.userId);
  if (!target) return err({ code: "admin.not_found", message: "No such account." });

  const { rows } = await tx.query(`SELECT id FROM pmp.events WHERE id = $1`, [input.eventId]);
  if (!rows[0]) return err({ code: "admin.event_not_found", message: "No such event." });

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

  await tx.query(`DELETE FROM pmp.event_roles WHERE user_id = $1 AND event_id = $2 AND role = $3`, [
    input.userId,
    input.eventId,
    input.role,
  ]);
  await audit(tx, actor, input.userId, "admin.role_revoked", { event_id: input.eventId, role: input.role });
  return ok({ revoked: true });
}

/**
 * Root admin or staff (D-100). Promoting is a root admin's call; demoting the last active
 * root admin is refused, since nobody would be left to promote anyone back.
 */
export async function setAccountType(
  tx: pg.PoolClient,
  actor: Actor,
  userId: string,
  accountType: AccountType,
): Promise<Result<{ account_type: AccountType }, DomainError>> {
  if (!hasAnyRole(actor, ADMIN_ROLES)) return err(forbidden("Changing an account type"));
  if (accountType !== "root_admin" && accountType !== "staff") {
    return err({ code: "admin.bad_account_type", message: "An account is either staff or a root admin." });
  }
  const target = await accountOf(tx, userId);
  if (!target) return err({ code: "admin.not_found", message: "No such account." });
  if (accountType === "staff") {
    if (userId === actor.id) {
      return err({ code: "admin.self_lockout", message: "You cannot remove your own root admin access." });
    }
    const refusal = await lastRootAdminRefusal(tx, userId, "make staff");
    if (refusal) return err(refusal);
  }

  await tx.query(`UPDATE pmp.users SET is_root_admin = $1 WHERE id = $2`, [accountType === "root_admin", userId]);
  // New powers, or fewer, take effect at the next sign-in rather than mid-session.
  await tx.query(`UPDATE pmp.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
    userId,
  ]);
  await audit(tx, actor, userId, "admin.account_type_changed", {
    from: target.is_root_admin ? "root_admin" : "staff",
    to: accountType,
  });
  return ok({ account_type: accountType });
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
  if (!target) return err({ code: "admin.not_found", message: "No such account." });
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
    was: target.is_root_admin ? "root_admin" : "staff",
  });
  return ok({ deleted: true });
}

type Account = { id: string; email: string; display_name: string; is_root_admin: boolean; is_active: boolean };

/** A live (not deleted) account, or nothing. */
async function accountOf(tx: pg.PoolClient, userId: string): Promise<Account | undefined> {
  const { rows } = await tx.query<Account>(
    `SELECT id, email::text, display_name, is_root_admin, is_active
       FROM pmp.users WHERE id = $1 AND deleted_at IS NULL`,
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
      message: `This is the only active root admin, so you cannot ${what} it. Make someone else a root admin first.`,
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
