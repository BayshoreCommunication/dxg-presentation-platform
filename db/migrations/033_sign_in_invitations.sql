-- 033_sign_in_invitations.sql
-- Invitations and reminders carry the speaker's sign-in (D-147) instead of a personal
-- portal link. An event's invitation or reminder still word for word the 031 default (and
-- not formatted) gets the new default; templates staff have edited are not touched.
-- Re-running changes nothing.
SET search_path TO pmp, public;

UPDATE communication_templates
   SET body = $new_inv$Hi {{speaker_first}},

You're presenting at {{event_name}}:

{{presentations}}

Please upload your presentation by {{deadline}}. Your sign-in details are below — the same sign-in works for every event you speak at.

{{sign_in}}

Once signed in, Manage presentations is where you upload, replace a file with a new version, and download your presentation once it's approved — right up to and on the day you present.

Requirements: 16:9 widescreen, PowerPoint (.pptx) preferred, PDF accepted. Embed all fonts and use H.264 .mp4 for video.

The DXG presentation team$new_inv$
 WHERE name = 'Upload invitation'
   AND body_html IS NULL
   AND body LIKE '%using your personal secure link. No account is needed.%';

UPDATE communication_templates
   SET body = $new_rem$Hi {{speaker_first}},

We don't have your presentation yet for:

{{presentations}}

The deadline is {{deadline}}.

{{sign_in}}

Once signed in, Manage presentations is where you upload your file, and later download it once it's approved — up to and on the day of your presentation.

If you've already sent it another way, reply to this email and we'll check.

The DXG presentation team$new_rem$
 WHERE name = 'Reminder — file still missing'
   AND body_html IS NULL
   AND body LIKE '%The same link lets you manage your files%';
