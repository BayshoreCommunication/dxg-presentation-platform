-- 035_staff_kinds.sql
-- Three kinds of DXG account (Travis, 2026-10-11, from the client's review): DXG Admin (is_root_admin),
-- DXG Support staff and DXG Technician staff. The kind is on the account; the event roles it
-- implies are granted per event as before. Existing staff are support staff. Re-running changes nothing.
SET search_path TO pmp, public;

ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_kind text NOT NULL DEFAULT 'support';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_staff_kind_check;
ALTER TABLE users ADD CONSTRAINT users_staff_kind_check CHECK (staff_kind IN ('support', 'technician'));
