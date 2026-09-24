-- 015_supersede_stale_pending.sql
-- A version still waiting for review is superseded once a newer clean version of the
-- same talk exists (D-076, WORKFLOW_STATES §3 amended). `ingestVersion` does this for
-- every new upload from now on; this applies the same rule to versions uploaded before,
-- which otherwise stay in Review presentations beside their replacements.
SET search_path TO pmp, public;

WITH stale AS (
  SELECT old.id, old.event_id, old.client_id, old.review_state, old.version_number,
         (SELECT max(newer.version_number) FROM file_versions newer
           WHERE newer.file_id = old.file_id AND newer.version_number > old.version_number
             AND newer.processing_state = 'stored') AS newest
    FROM file_versions old
   WHERE old.review_state IN ('awaiting_review', 'in_review')
     AND EXISTS (SELECT 1 FROM file_versions newer
                  WHERE newer.file_id = old.file_id
                    AND newer.version_number > old.version_number
                    AND newer.processing_state = 'stored')
), recorded AS (
  INSERT INTO workflow_transitions
    (event_id, client_id, subject_type, subject_id, from_state, to_state, action, actor_user_id, reason)
  SELECT event_id, client_id, 'file_version.review', id, review_state, 'superseded', 'supersede', NULL,
         'v' || newest || ' was uploaded before v' || version_number || ' was reviewed (migration 015)'
    FROM stale
)
UPDATE file_versions fv
   SET review_state = 'superseded', lock_version = fv.lock_version + 1
  FROM stale
 WHERE fv.id = stale.id;
