-- 040_open_links.sql
-- "Open in PowerPoint" (client review, D-157): PowerPoint on the desk's computer fetches the
-- file itself and carries no sign-in, so it is handed a short-lived link to exactly one
-- version. Only the token's hash is kept. Re-running changes nothing.
SET search_path TO pmp, public;

CREATE TABLE IF NOT EXISTS open_links (
  token_hash      bytea PRIMARY KEY,
  file_version_id uuid NOT NULL REFERENCES file_versions(id),
  event_id        uuid NOT NULL REFERENCES events(id),
  client_id       uuid NOT NULL REFERENCES clients(id),
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  opened_count    int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS open_links_expiry_idx ON open_links (expires_at);

ALTER TABLE open_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON open_links;
CREATE POLICY tenant_isolation ON open_links
  FOR ALL TO pmp_app
  USING (pmp.is_platform_context() OR client_id = pmp.current_client_id())
  WITH CHECK (pmp.is_platform_context() OR client_id = pmp.current_client_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON open_links TO pmp_app;
