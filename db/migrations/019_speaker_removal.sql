-- 019_speaker_removal.sql
-- A speaker can be removed from an event (D-095).
--
-- A speaker row cannot be deleted once anything refers to it: sent emails, uploads,
-- comments, sign-in records and the audit chain are history. So removal is a mark:
-- the speaker is taken off every presentation, their links, access codes and portal
-- sessions are revoked, and every list that hides merged duplicates hides them too.
SET search_path TO pmp, public;

ALTER TABLE speakers ADD COLUMN IF NOT EXISTS removed_at timestamptz;
ALTER TABLE speakers ADD COLUMN IF NOT EXISTS removed_by uuid REFERENCES users(id);
