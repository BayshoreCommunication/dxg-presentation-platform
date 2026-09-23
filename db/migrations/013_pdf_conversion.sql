-- 013_pdf_conversion.sql
-- PDF copies of approved presentations, made with LibreOffice (D-067).
--
-- The archive ships two packages: the PowerPoint originals, and PDFs. A PDF is a
-- derivative, so the file itself is recorded in `derived_objects` (kind 'pdf'), which
-- is what certified deletion enumerates (SECURITY_MODEL §6.3). This table tracks the
-- *work*: whether a version is waiting, converting, done or failed and why — so the
-- archive builder can say "141 of 187 converted" and name the ones that failed.
SET search_path TO pmp, public;

CREATE TABLE IF NOT EXISTS pdf_conversions (
  file_version_id   uuid PRIMARY KEY REFERENCES file_versions(id),
  event_id          uuid NOT NULL REFERENCES events(id),
  client_id         uuid NOT NULL REFERENCES clients(id),
  state             text NOT NULL DEFAULT 'queued'
                    CHECK (state IN ('queued','converting','done','failed')),
  error             text,
  derived_object_id uuid REFERENCES derived_objects(id),
  attempts          int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pdf_conversions_event_idx ON pdf_conversions (event_id, state);

ALTER TABLE pdf_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_conversions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pdf_conversions;
CREATE POLICY tenant_isolation ON pdf_conversions
  FOR ALL TO pmp_app
  USING (pmp.is_platform_context() OR client_id = pmp.current_client_id())
  WITH CHECK (pmp.is_platform_context() OR client_id = pmp.current_client_id());
GRANT SELECT, INSERT, UPDATE ON pdf_conversions TO pmp_app;

-- A package is now two zips. `s3_key` stays the PowerPoint package.
ALTER TABLE archive_packages ADD COLUMN IF NOT EXISTS pdf_s3_key text;

-- Which of the two a download was, so the log can say.
ALTER TABLE archive_downloads ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'pptx';
ALTER TABLE archive_downloads DROP CONSTRAINT IF EXISTS archive_downloads_format_check;
ALTER TABLE archive_downloads ADD CONSTRAINT archive_downloads_format_check CHECK (format IN ('pptx','pdf'));
