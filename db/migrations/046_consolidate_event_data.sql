-- 046_consolidate_event_data.sql
-- Remove accumulated test, probe and practice-event data while preserving every
-- user account and the complete Tech Summit event used for product walkthroughs.
-- Audit records intentionally remain append-only; they are not operational event data.
SET search_path TO pmp, public;

CREATE TEMP TABLE event_cleanup_ids ON COMMIT DROP AS
SELECT id
  FROM events
 WHERE id <> '4054f45f-7724-419f-bd89-b618176fe082'
   AND EXISTS (
     SELECT 1
       FROM events
      WHERE id = '4054f45f-7724-419f-bd89-b618176fe082'
        AND name = 'Tech Summit'
   );

-- Auth sessions are the only event-owned descendants without an event_id column.
DELETE FROM auth_sessions
 WHERE speaker_id IN (
   SELECT id FROM speakers WHERE event_id IN (SELECT id FROM event_cleanup_ids)
 );

-- Delete event-owned rows from the leaves inward so the deliberately restrictive
-- foreign keys keep protecting unrelated data throughout the migration.
DELETE FROM pdf_conversions        WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM comments               WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM inspection_findings    WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM launch_logs            WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM open_links             WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM room_files             WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM speaker_notifications  WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM usb_ingestions         WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM archive_downloads      WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM communication_events   WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM sync_manifests         WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM room_media_assignments WHERE event_id IN (SELECT id FROM event_cleanup_ids);

-- Sign-offs and receipts reference each other after a receipt is issued.
UPDATE sign_offs
   SET receipt_id = NULL
 WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM receipts               WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM sign_offs              WHERE event_id IN (SELECT id FROM event_cleanup_ids);

DELETE FROM derived_objects        WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM legal_holds            WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM file_versions          WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM files                  WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM speaker_assignments    WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM workflow_transitions   WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM communications         WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM communication_templates WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM room_assignments       WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM room_agents            WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM speaker_tokens         WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM srr_checkins           WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM slots                  WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM sessions               WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM archive_packages       WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM event_roles            WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM event_staff_history    WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM reminder_runs          WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM report_exports         WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM retention_policies     WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM schedule_imports       WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM speakers               WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM srr_stations           WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM rooms                  WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM tracks                 WHERE event_id IN (SELECT id FROM event_cleanup_ids);
DELETE FROM event_days             WHERE event_id IN (SELECT id FROM event_cleanup_ids);

-- A duplicated event may point at one of the rows being removed.
UPDATE events
   SET duplicated_from = NULL
 WHERE duplicated_from IN (SELECT id FROM event_cleanup_ids);

DELETE FROM events WHERE id IN (SELECT id FROM event_cleanup_ids);
