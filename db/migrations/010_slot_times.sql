-- 010_slot_times.sql
-- A presentation's own time within its session (FR-IMP-001, D-031).
--
-- DXG's agenda template carries `Presentation Start`, `Presentation End` and
-- `Presentation Duration` alongside the session's times: a session can hold several
-- presentations, and each has its own slot in it. `slots` had only `position`, so
-- those three columns had nowhere to land and were imported as nothing.
--
-- Nullable and additive: every existing slot keeps its meaning, and a slot with no
-- time of its own is simply one that runs with its session, which is the common case
-- and the only case before this migration.
SET search_path TO pmp, public;

ALTER TABLE slots ADD COLUMN IF NOT EXISTS starts_at timestamptz;
ALTER TABLE slots ADD COLUMN IF NOT EXISTS ends_at   timestamptz;

-- A slot that claims a time must claim a coherent one. Both-or-neither is not
-- required: a start with no end is a presentation whose finish was not published.
ALTER TABLE slots DROP CONSTRAINT IF EXISTS slots_time_order;
ALTER TABLE slots ADD CONSTRAINT slots_time_order
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at >= starts_at);

COMMENT ON COLUMN slots.starts_at IS
  'The presentation''s own start within its session; NULL means it runs with the session.';
COMMENT ON COLUMN slots.ends_at IS
  'The presentation''s own end within its session; NULL means it runs with the session.';
