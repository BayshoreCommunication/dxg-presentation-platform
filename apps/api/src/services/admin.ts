import type pg from "pg";
import { appendAudit } from "@pmp/db";
import { hashPassword, generateAccessCode, checkPassword } from "@pmp/auth";
import type { Actor, DomainError, EventRole, Result } from "@pmp/domain";
import { err, ok, hasAnyRole, EVENT_ROLES } from "@pmp/domain";

const ADMIN_ROLES: EventRole[] = ["platform_admin", "project_manager"];

const forbidden = (what: string): DomainError => ({
  code: "admin.forbidden",
  message: `${what} requires a platform admin or project manager.`,
});

export type StaffRow = {
  id: string;
  email: string;
  display_name: string;
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
    `SELECT u.id, u.email::text, u.display_name, u.is_active,
            (u.mfa_enrolled_at IS NOT NULL) AS mfa_enrolled,
            u.must_change_password, u.locked_until,
            COALESCE((SELECT json_agg(json_build_object(
                        'event_id', er.event_id, 'event_name', e.name, 'role', er.role)
                      ORDER BY e.name, er.role)
                        FROM pmp.event_roles er
                        JOIN pmp.events e ON e.id = er.event_id
                       WHERE er.user_id = u.id), '[]'::json) AS roles,
            (SELECT max(a.occurred_at) FROM pmp.auth_attempts a
              WHERE a.identifier = u.email::text AND a.outcome = 'success') AS last_sign_in,
            (SELECT count(*)::int FROM pmp.mfa_recovery_codes r
              WHERE r.user_id = u.id AND r.used_at IS NULL) AS recovery_codes_left
       FROM pmp.users u
      ORDER BY u.display_name`,
  );
  return ok(rows);
}

/** A temporary password is shown once and must be changed on first use. */
export async function resetPassword(
  tx: pg.PoolClient,
  actor: Actor,
  userId: string,
): Promise<Result<{ temporary_password: string }, DomainError>> {
  if (!hasAnyRole(actor, ADMIN_ROLES)) return err(forbidden("Resetting a password"));

  const temporary = generateAccessCode(4, 4);
  const problem = checkPassword(temporary);
  if (problem) return err({ code: `admin.${problem.code}`, message: problem.message });

  const { rowCount } = await tx.query(
    `UPDATE pmp.users
        SET password_hash = $1, password_set_at = now(), must_change_password = true,
            failed_logins = 0, locked_until = NULL
      WHERE id = $2`,
    [await hashPassword(temporary), userId],
  );
  if (rowCount === 0) return err({ code: "admin.not_found", message: "No such account." });

  // A reset password ends every session that account had open.
  await tx.query(`UPDATE pmp.auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [
    userId,
  ]);
  await audit(tx, actor, userId, "admin.password_reset", {});
  return ok({ temporary_password: temporary });
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

  const { rowCount } = await tx.query(`UPDATE pmp.users SET is_active = $1 WHERE id = $2`, [active, userId]);
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

  // Removing the last platform admin from an event would leave nobody able to
  // put one back.
  if (input.role === "platform_admin") {
    const { rows } = await tx.query<{ count: string }>(
      `SELECT count(*)::text FROM pmp.event_roles
        WHERE event_id = $1 AND role = 'platform_admin' AND user_id <> $2`,
      [input.eventId, input.userId],
    );
    if (Number(rows[0]?.count ?? 0) === 0) {
      return err({
        code: "admin.last_admin",
        message: "This is the only platform admin on that event. Grant the role to someone else first.",
      });
    }
  }

  await tx.query(`DELETE FROM pmp.event_roles WHERE user_id = $1 AND event_id = $2 AND role = $3`, [
    input.userId,
    input.eventId,
    input.role,
  ]);
  await audit(tx, actor, input.userId, "admin.role_revoked", { event_id: input.eventId, role: input.role });
  return ok({ revoked: true });
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
