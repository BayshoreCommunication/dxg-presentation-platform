-- 047_complete_walkthrough_event.sql
-- The retained Tech Summit fixture had accumulated incomplete talks from local
-- test runs. Keep only presentation-bearing slots and their speakers so the one
-- remaining walkthrough event is complete. User accounts remain untouched.
SET search_path TO pmp, public;

CREATE TEMP TABLE incomplete_walkthrough_slots ON COMMIT DROP AS
SELECT s.id
  FROM slots s
 WHERE s.event_id = '4054f45f-7724-419f-bd89-b618176fe082'
   AND NOT EXISTS (SELECT 1 FROM files f WHERE f.slot_id = s.id);

CREATE TEMP TABLE incomplete_walkthrough_assignments ON COMMIT DROP AS
SELECT id
  FROM speaker_assignments
 WHERE slot_id IN (SELECT id FROM incomplete_walkthrough_slots);

UPDATE speaker_assignments
   SET replaced_by = NULL
 WHERE replaced_by IN (SELECT id FROM incomplete_walkthrough_assignments);

DELETE FROM speaker_notifications
 WHERE slot_id IN (SELECT id FROM incomplete_walkthrough_slots);
DELETE FROM speaker_assignments
 WHERE id IN (SELECT id FROM incomplete_walkthrough_assignments);
DELETE FROM slots
 WHERE id IN (SELECT id FROM incomplete_walkthrough_slots);
DELETE FROM sessions se
 WHERE se.event_id = '4054f45f-7724-419f-bd89-b618176fe082'
   AND NOT EXISTS (SELECT 1 FROM slots s WHERE s.session_id = se.id);

CREATE TEMP TABLE orphan_walkthrough_speakers ON COMMIT DROP AS
SELECT sp.id
  FROM speakers sp
 WHERE sp.event_id = '4054f45f-7724-419f-bd89-b618176fe082'
   AND NOT EXISTS (
     SELECT 1 FROM speaker_assignments sa WHERE sa.speaker_id = sp.id
   );

DELETE FROM auth_sessions
 WHERE speaker_id IN (SELECT id FROM orphan_walkthrough_speakers);
DELETE FROM communication_events
 WHERE communication_id IN (
   SELECT id FROM communications
    WHERE speaker_id IN (SELECT id FROM orphan_walkthrough_speakers)
 );
DELETE FROM communications
 WHERE speaker_id IN (SELECT id FROM orphan_walkthrough_speakers);
DELETE FROM comments
 WHERE author_speaker_id IN (SELECT id FROM orphan_walkthrough_speakers);
DELETE FROM speaker_notifications
 WHERE speaker_id IN (SELECT id FROM orphan_walkthrough_speakers);
DELETE FROM speaker_tokens
 WHERE speaker_id IN (SELECT id FROM orphan_walkthrough_speakers);

UPDATE sign_offs
   SET receipt_id = NULL
 WHERE speaker_id IN (SELECT id FROM orphan_walkthrough_speakers);
DELETE FROM receipts
 WHERE sign_off_id IN (
   SELECT id FROM sign_offs
    WHERE speaker_id IN (SELECT id FROM orphan_walkthrough_speakers)
 );
DELETE FROM sign_offs
 WHERE speaker_id IN (SELECT id FROM orphan_walkthrough_speakers);
DELETE FROM usb_ingestions
 WHERE checkin_id IN (
   SELECT id FROM srr_checkins
    WHERE speaker_id IN (SELECT id FROM orphan_walkthrough_speakers)
 );
DELETE FROM srr_checkins
 WHERE speaker_id IN (SELECT id FROM orphan_walkthrough_speakers);

UPDATE file_versions
   SET uploaded_by_speaker = NULL
 WHERE uploaded_by_speaker IN (SELECT id FROM orphan_walkthrough_speakers);
UPDATE speakers
   SET merged_into = NULL
 WHERE merged_into IN (SELECT id FROM orphan_walkthrough_speakers);
DELETE FROM speakers
 WHERE id IN (SELECT id FROM orphan_walkthrough_speakers);
