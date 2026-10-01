-- 029_formatted_email_templates.sql
-- Email templates can be formatted (D-139): the Communications editor writes HTML (bold,
-- colour, lists, links, images…), cleaned by the server before it is stored. `body` stays
-- the plain-text twin — the email's text part, the delivery log's and the archive's copy.
-- A template with no `body_html` is plain text, as every template was until now.
SET search_path TO pmp, public;

ALTER TABLE communication_templates ADD COLUMN IF NOT EXISTS body_html text;
