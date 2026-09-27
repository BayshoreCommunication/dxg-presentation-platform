-- 022_root_admins_and_account_removal.sql
-- Root admin is a property of the account, not of an event (D-100).
--
-- Until now "platform admin" was an event role that happened to reach every event, so
-- the only way to make someone an administrator was to put them on some event first,
-- and anyone who could grant roles on an event could mint one. A root admin is now a
-- flag on the account; every other staff member holds roles on the events they work
-- and nothing else.
--
-- Accounts can also be deleted. A deleted account keeps its row — audit records,
-- grants and uploads point at it — but loses its sign-in, its sessions and its event
-- roles, and gives up its email address so the same person can be invited again.
SET search_path TO pmp, public;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_root_admin boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at    timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_email text;

COMMENT ON COLUMN users.is_root_admin IS
  'Root admin (D-100): sees and manages every event and every account. There may be several.';
COMMENT ON COLUMN users.deleted_email IS
  'The address a deleted account had; `email` is replaced so the address can be reused.';

-- Everyone who held the old platform-wide role becomes a root admin, and the event
-- rows that used to confer it go: holding it on one event no longer means anything.
UPDATE users SET is_root_admin = true
 WHERE id IN (SELECT user_id FROM event_roles WHERE role = 'platform_admin');
DELETE FROM event_roles WHERE role = 'platform_admin';
