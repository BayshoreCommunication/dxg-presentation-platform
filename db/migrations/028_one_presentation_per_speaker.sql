-- 028_one_presentation_per_speaker.sql
-- Co-presenters get a presentation each (D-137). Until now everyone in a session shared one
-- presentation and so one file: whoever uploaded last replaced the others' decks.
--
-- For every presentation with two or more current speakers, one keeps it — and with it the
-- file and its whole history — and each other speaker moves to a new presentation of their
-- own in the same session (same title, times and distribution flag), with nothing uploaded
-- yet. The keeper is whoever uploaded the newest version, when that person is still on it;
-- otherwise the first person assigned. Earlier versions others uploaded stay in the kept
-- file's history, downloadable from Files. Re-running changes nothing.
SET search_path TO pmp, public;

DO $$
DECLARE
  shared record;
  mover record;
  keeper uuid;
  fresh uuid;
BEGIN
  FOR shared IN
    SELECT s.id
      FROM slots s
      JOIN speaker_assignments sa ON sa.slot_id = s.id AND sa.replaced_by IS NULL
     GROUP BY s.id
    HAVING count(DISTINCT sa.speaker_id) > 1
  LOOP
    SELECT fv.uploaded_by_speaker INTO keeper
      FROM files f JOIN file_versions fv ON fv.file_id = f.id
     WHERE f.slot_id = shared.id
       AND fv.uploaded_by_speaker IN (SELECT speaker_id FROM speaker_assignments
                                       WHERE slot_id = shared.id AND replaced_by IS NULL)
     ORDER BY fv.version_number DESC LIMIT 1;

    IF keeper IS NULL THEN
      SELECT speaker_id INTO keeper FROM speaker_assignments
       WHERE slot_id = shared.id AND replaced_by IS NULL
       ORDER BY created_at, id LIMIT 1;
    END IF;

    FOR mover IN
      SELECT DISTINCT ON (speaker_id) id, speaker_id FROM speaker_assignments
       WHERE slot_id = shared.id AND replaced_by IS NULL AND speaker_id <> keeper
       ORDER BY speaker_id, created_at
    LOOP
      INSERT INTO slots (session_id, event_id, client_id, title, position, starts_at, ends_at, restricted)
      SELECT s.session_id, s.event_id, s.client_id, s.title,
             (SELECT COALESCE(max(position), 0) + 1 FROM slots WHERE session_id = s.session_id),
             s.starts_at, s.ends_at, s.restricted
        FROM slots s WHERE s.id = shared.id
      RETURNING id INTO fresh;

      UPDATE speaker_assignments SET slot_id = fresh
       WHERE slot_id = shared.id AND speaker_id = mover.speaker_id AND replaced_by IS NULL;
    END LOOP;

    keeper := NULL;
  END LOOP;
END $$;
