-- 018_presentations_merge_field.sql
-- One email per speaker, naming every presentation (D-087).
--
-- A speaker on two presentations was two recipients, so a batch emailed them twice with
-- two links. Recipients are now grouped by speaker, and the templates gain a
-- `{{presentations}}` merge field: one line per presentation, title, room and time.
--
-- The seeded wording named one talk in a sentence ("… — {{talk_title}} in {{room}} on
-- {{session_time}}."). Where an event still has that exact sentence, it becomes the list.
-- A template someone has reworded is left as they wrote it; its single-value fields still
-- work and read as a list for a speaker with several presentations.
SET search_path TO pmp, public;

UPDATE communication_templates
   SET body = replace(
         body,
         'You''re presenting at {{event_name}} — {{talk_title}} in {{room}} on {{session_time}}.',
         E'You''re presenting at {{event_name}}:\n\n{{presentations}}'
       ),
       updated_at = now(),
       lock_version = lock_version + 1
 WHERE body LIKE '%You''re presenting at {{event_name}} — {{talk_title}} in {{room}} on {{session_time}}.%';

UPDATE communication_templates
   SET body = replace(
         body,
         'We don''t have your presentation for {{talk_title}} yet. The deadline is {{deadline}}.',
         E'We don''t have your presentation yet for:\n\n{{presentations}}\n\nThe deadline is {{deadline}}.'
       ),
       updated_at = now(),
       lock_version = lock_version + 1
 WHERE body LIKE '%We don''t have your presentation for {{talk_title}} yet. The deadline is {{deadline}}.%';
