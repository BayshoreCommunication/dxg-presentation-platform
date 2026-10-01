-- 027_presentation_titles_follow_session.sql
-- Repairs titles left behind before D-130. Until then, renaming a session on the Agenda tab
-- left its presentation on the old title, so the Speakers tab, Files, review, check-in and
-- emails kept showing it. D-130 renames them going forward; this catches up the past.
--
-- A presentation is moved to its session's current title only when the audit history
-- shows it is a leftover: its title is one its own session was renamed *from*, and nobody
-- has given the presentation that title on purpose since (a `slot.updated` naming it).
-- A presentation with a title of its own is never touched. Re-running changes nothing.
SET search_path TO pmp, public;

UPDATE slots s
   SET title = se.title, updated_at = now()
  FROM sessions se
 WHERE s.session_id = se.id
   AND s.title <> se.title
   AND EXISTS (
         SELECT 1 FROM audit_records rename
          WHERE rename.action = 'session.updated'
            AND rename.subject_id = se.id::text
            AND rename.detail->'before'->>'title' = s.title
            AND rename.detail->'after'->>'title' IS DISTINCT FROM s.title
            AND NOT EXISTS (
                  SELECT 1 FROM audit_records own
                   WHERE own.action = 'slot.updated'
                     AND own.subject_id = s.id::text
                     AND own.detail->'after'->>'title' = s.title
                     AND own.created_at > rename.created_at));
