-- 024_drop_technician_review.sql
-- "Technician review" is gone (D-114): nothing ever put a file into it — inspection writes
-- passed, passed with warnings or failed — yet it would have blocked approval with no way
-- out. A file that needs a person's judgement is a warning a reviewer reads, or a failure.
-- Any row somehow in the state becomes `failed`, so it can never be approved unseen.
SET search_path TO pmp, public;

UPDATE file_versions SET inspection_state = 'failed' WHERE inspection_state = 'technician_review';

ALTER TABLE file_versions DROP CONSTRAINT IF EXISTS file_versions_inspection_state_check;
ALTER TABLE file_versions ADD CONSTRAINT file_versions_inspection_state_check
  CHECK (inspection_state IN ('pending','inspecting','passed','passed_with_warnings','failed'));
