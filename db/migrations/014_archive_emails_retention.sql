-- 014_archive_emails_retention.sql
-- The archive carries the event's emails (D-069).
--
-- `communications` recorded who was emailed, the subject and the delivery status, but
-- not what the email said: the rendered text only ever went onto the outbox payload.
-- The archive needs the text, so each communication now keeps it.
--
-- It keeps it with the speaker's personal upload link removed. That link signs the
-- speaker in for 30 days (`speaker_tokens`); a copy of it in a stored body — and so in
-- a client's archive — would be a working login in someone else's hands.
SET search_path TO pmp, public;

ALTER TABLE communications ADD COLUMN IF NOT EXISTS body text;

COMMENT ON COLUMN communications.body IS
  'The email as sent, with personal sign-in links replaced by a placeholder. NULL for mail sent before 014 whose outbox row is gone.';

-- Emails already sent: recover the text from their outbox rows, redacting the link the
-- same way (the token is the path segment after /t/).
UPDATE communications c
   SET body = regexp_replace(o.payload->>'body', '/t/[A-Za-z0-9_-]+', '/t/[personal link removed]', 'g')
  FROM outbox o
 WHERE o.topic = 'email.send'
   AND (o.payload->>'communication_id')::uuid = c.id
   AND c.body IS NULL;
