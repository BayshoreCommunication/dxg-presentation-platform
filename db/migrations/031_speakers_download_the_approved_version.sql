-- 031_speakers_download_the_approved_version.sql
-- A speaker downloads only their approved presentation (D-144), so the emails stop promising
-- "download what you uploaded". An event's invitation or reminder still word for word the 030
-- default (and not formatted) gets the corrected sentence; templates staff have edited are not
-- touched. Re-running changes nothing.
SET search_path TO pmp, public;

UPDATE communication_templates
   SET body = $new_inv$Hi {{speaker_first}},

You're presenting at {{event_name}}:

{{presentations}}

Please upload your presentation by {{deadline}} using your personal secure link. No account is needed.

{{upload_link}}

Keep this email. The same link works right up to and on the day of your presentation: come back any time to see your files, replace one with a new version, or download your presentation once it's approved.

Requirements: 16:9 widescreen, PowerPoint (.pptx) preferred, PDF accepted. Embed all fonts and use H.264 .mp4 for video.

The DXG presentation team$new_inv$, updated_at = now(), lock_version = lock_version + 1
 WHERE name = 'Upload invitation' AND body_html IS NULL AND body = $old_inv$Hi {{speaker_first}},

You're presenting at {{event_name}}:

{{presentations}}

Please upload your presentation by {{deadline}} using your personal secure link. No account is needed.

{{upload_link}}

Keep this email. The same link works right up to and on the day of your presentation: come back any time to see your files, replace one with a new version, or download what you uploaded.

Requirements: 16:9 widescreen, PowerPoint (.pptx) preferred, PDF accepted. Embed all fonts and use H.264 .mp4 for video.

The DXG presentation team$old_inv$;

UPDATE communication_templates
   SET body = $new_rem$Hi {{speaker_first}},

We don't have your presentation yet for:

{{presentations}}

The deadline is {{deadline}}.

{{upload_link}}

The same link lets you manage your files, and download your presentation once it's approved, up to and on the day of your presentation.

If you've already sent it another way, reply to this email and we'll check.

The DXG presentation team$new_rem$, updated_at = now(), lock_version = lock_version + 1
 WHERE name = 'Reminder — file still missing' AND body_html IS NULL AND body = $old_rem$Hi {{speaker_first}},

We don't have your presentation yet for:

{{presentations}}

The deadline is {{deadline}}.

{{upload_link}}

The same link lets you manage your files and download them, up to and on the day of your presentation.

If you've already sent it another way, reply to this email and we'll check.

The DXG presentation team$old_rem$;
