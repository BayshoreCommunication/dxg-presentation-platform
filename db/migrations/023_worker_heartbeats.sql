-- 023_worker_heartbeats.sql
-- Background jobs run in their own process (D-103): PDF previews and automatic reminders
-- moved out of the API into `worker`. A worker that has stopped fails quietly — previews
-- stay "queued", reminders are simply not sent — so each worker records that it is alive,
-- and /ops/health reports it.
SET search_path TO pmp, public;

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  name       text PRIMARY KEY,               -- one row per worker process, "worker@<host>#<pid>"
  started_at timestamptz NOT NULL,
  beat_at    timestamptz NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}'     -- jobs this process runs, its version
);
