-- 042_new_version_reminder.sql
-- D-178: a second reminder, "Reminder — new version needed", for speakers asked for changes or
-- whose file failed the virus check — they have uploaded, so the missing-file reminder ("We don't
-- have your presentation yet") was the wrong thing to tell them. New events get it from
-- DEFAULT_TEMPLATES (services/comms.ts); this gives it to every event that already has its
-- templates. Events that already have a template of that name are left alone, so re-running
-- changes nothing. The text is DEFAULT_TEMPLATES' word for word.
SET search_path TO pmp, public;

INSERT INTO communication_templates (client_id, event_id, name, subject, body, created_at)
SELECT e.client_id, e.id,
       'Reminder — new version needed',
       '{{event_name}}: please send a new version of your presentation by {{deadline}}',
       $body$Hi {{speaker_first}},

We need a new version of your presentation for:

{{presentations}}

Please upload it by {{deadline}}. Your sign-in details are below.

{{sign_in}}

Once signed in, Manage presentations shows our note on what to change, and is where you upload the new version.

If you've already sent it another way, reply to this email and we'll check.

The DXG presentation team$body$,
       -- After the event's existing templates, so the list keeps the invitation first.
       (SELECT max(t.created_at) FROM communication_templates t WHERE t.event_id = e.id) + interval '1 millisecond'
  FROM events e
 WHERE EXISTS (SELECT 1 FROM communication_templates t WHERE t.event_id = e.id)
   AND NOT EXISTS (SELECT 1 FROM communication_templates t
                    WHERE t.event_id = e.id AND t.name = 'Reminder — new version needed');
