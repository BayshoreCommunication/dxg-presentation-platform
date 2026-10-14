-- 045_staff_roles_follow_kind.sql
-- D-187, once: every support staff member and technician holds, on each event they are on, the
-- full set of roles their kind is given when Event assignments places them (D-151,
-- `ROLES_OF_KIND`): support → project manager + presentation manager; technician → SRR
-- technician + room technician + reviewer. Accounts given a single role by hand, or placed
-- before D-151, held only part of it — a technician with just "reviewer" could not tick Mark
-- loaded on Room sync. Only adds roles: nothing is taken away, so a hand-granted extra stays.
-- Archived events are left alone (their staff were freed, D-181). Re-running changes nothing.
SET search_path TO pmp, public;

WITH kind_roles (staff_kind, role) AS (
  VALUES ('support', 'project_manager'), ('support', 'presentation_manager'),
         ('technician', 'srr_technician'), ('technician', 'room_technician'),
         ('technician', 'content_reviewer')
), placed AS (
  SELECT DISTINCT er.user_id, er.event_id, u.staff_kind
    FROM event_roles er
    JOIN users u ON u.id = er.user_id
    JOIN events e ON e.id = er.event_id
   WHERE u.account_kind = 'staff' AND NOT u.is_root_admin AND u.deleted_at IS NULL
     AND u.staff_kind IN ('support', 'technician')
     AND er.role <> 'platform_admin'
     AND e.status <> 'archived'
)
INSERT INTO event_roles (user_id, event_id, role)
SELECT p.user_id, p.event_id, k.role
  FROM placed p JOIN kind_roles k ON k.staff_kind = p.staff_kind
ON CONFLICT DO NOTHING;
