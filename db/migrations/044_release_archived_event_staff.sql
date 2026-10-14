-- 044_release_archived_event_staff.sql
-- D-181, once: events archived before staff were freed on archiving still list their support
-- staff and technicians. They are freed now, the same way archiving frees them (who worked each
-- event goes to event_staff_history, reason 'archived'). Clients and DXG Admins stay.
-- Re-running changes nothing: the second time there is nothing left to move.
SET search_path TO pmp, public;

WITH released AS (
  DELETE FROM event_roles er
   USING users u, events e
   WHERE u.id = er.user_id AND e.id = er.event_id
     AND e.status = 'archived'
     AND u.account_kind = 'staff' AND NOT u.is_root_admin
     AND u.staff_kind IN ('support', 'technician')
     AND er.role <> 'platform_admin'
  RETURNING er.event_id, e.client_id, er.user_id, er.role, er.created_at, e.archived_at
)
INSERT INTO event_staff_history (event_id, client_id, user_id, role, assigned_at, released_at, reason)
SELECT event_id, client_id, user_id, role, created_at, coalesce(archived_at, now()), 'archived'
  FROM released;
