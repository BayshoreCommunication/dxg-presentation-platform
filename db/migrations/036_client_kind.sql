-- 036_client_kind.sql
-- A client's account is its own kind (D-151): "Client admin", never DXG Support staff. Accounts whose
-- every event role is a client role become clients. Re-running changes nothing.
SET search_path TO pmp, public;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_staff_kind_check;
ALTER TABLE users ADD CONSTRAINT users_staff_kind_check CHECK (staff_kind IN ('support', 'technician', 'client'));

UPDATE users u
   SET staff_kind = 'client'
 WHERE u.staff_kind = 'support' AND NOT u.is_root_admin AND u.account_kind = 'staff'
   AND EXISTS (SELECT 1 FROM event_roles er WHERE er.user_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM event_roles er WHERE er.user_id = u.id
                     AND er.role NOT IN ('client_event_admin', 'scoped_reviewer'));
