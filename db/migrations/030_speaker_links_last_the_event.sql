-- 030_speaker_links_last_the_event.sql
-- Speakers come back on their presentation day to check and download their files (D-141).
--
-- 1. Speaker links still valid now are extended to the end of the seventh day after their
--    event (on the event's clock), as new links are from now on. Expired or withdrawn links
--    stay as they are; access codes are left alone.
-- 2. An event's invitation or reminder still word for word the old default (and not
--    formatted) gets the new sentence saying the link keeps working on the day. Templates
--    staff have edited are not touched. Re-running changes nothing.
SET search_path TO pmp, public;

UPDATE speaker_tokens st
   SET expires_at = (e.ends_on + 8)::timestamp AT TIME ZONE e.timezone
  FROM events e
 WHERE e.id = st.event_id
   AND st.kind = 'magic_link'
   AND st.revoked_at IS NULL
   AND st.expires_at > now()
   AND st.expires_at < (e.ends_on + 8)::timestamp AT TIME ZONE e.timezone;

UPDATE communication_templates
   SET body = $new_inv$Hi {{speaker_first}},

You're presenting at {{event_name}}:

{{presentations}}

Please upload your presentation by {{deadline}} using your personal secure link. No account is needed.

{{upload_link}}

Keep this email. The same link works right up to and on the day of your presentation: come back any time to see your files, replace one with a new version, or download what you uploaded.

Requirements: 16:9 widescreen, PowerPoint (.pptx) preferred, PDF accepted. Embed all fonts and use H.264 .mp4 for video.

The DXG presentation team$new_inv$, updated_at = now(), lock_version = lock_version + 1
 WHERE name = 'Upload invitation' AND body_html IS NULL AND body = $old_inv$Hi {{speaker_first}},

You're presenting at {{event_name}}:

{{presentations}}

Please upload your presentation by {{deadline}} using your personal secure link. No account is needed.

{{upload_link}}

Requirements: 16:9 widescreen, PowerPoint (.pptx) preferred, PDF accepted. Embed all fonts and use H.264 .mp4 for video.

The DXG presentation team$old_inv$;

UPDATE communication_templates
   SET body = $new_rem$Hi {{speaker_first}},

We don't have your presentation yet for:

{{presentations}}

The deadline is {{deadline}}.

{{upload_link}}

The same link lets you manage your files and download them, up to and on the day of your presentation.

If you've already sent it another way, reply to this email and we'll check.

The DXG presentation team$new_rem$, updated_at = now(), lock_version = lock_version + 1
 WHERE name = 'Reminder — file still missing' AND body_html IS NULL AND body = $old_rem$Hi {{speaker_first}},

We don't have your presentation yet for:

{{presentations}}

The deadline is {{deadline}}.

{{upload_link}}

If you've already sent it another way, reply to this email and we'll check.

The DXG presentation team$old_rem$;
