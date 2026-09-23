import type pg from "pg";
import { listTalks } from "./talks.ts";

/**
 * The event's agenda as the details tabs show it (D-063): every session in time
 * order, each with the presentations in it and who gives them.
 *
 * A presentation's status is taken from `listTalks`, which derives it in the domain
 * package — it is not re-derived here, so the Agenda tab, the risk list and the review
 * queue cannot disagree about the same talk (BUILD_SPEC §5).
 */
export type AgendaSpeaker = {
  id: string;
  name: string;
  organization: string | null;
  role: string;
};

export type AgendaPresentation = {
  slot_id: string;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  speakers: AgendaSpeaker[];
  version_count: number;
  status: string;
  status_label: string;
};

export type AgendaSession = {
  id: string;
  title: string;
  kind: string;
  state: string;
  day: string | null;
  room: string | null;
  track: string | null;
  starts_at: string;
  ends_at: string;
  presentations: AgendaPresentation[];
};

export async function eventAgenda(tx: pg.PoolClient, eventId: string): Promise<AgendaSession[]> {
  const { rows } = await tx.query<{
    id: string;
    title: string;
    kind: string;
    state: string;
    day: string | null;
    room: string | null;
    track: string | null;
    starts_at: Date;
    ends_at: Date;
    slots:
      | {
          slot_id: string;
          title: string;
          position: number;
          starts_at: string | null;
          ends_at: string | null;
          speakers: AgendaSpeaker[] | null;
        }[]
      | null;
  }>(
    // `::text` on the day: it is a calendar date, and reading it back through a
    // timestamp is how D-026 put every session a day early.
    `SELECT se.id, se.title, se.kind, se.session_state AS state,
            d.day_date::text AS day, r.name AS room, t.name AS track,
            se.starts_at, se.ends_at,
            (SELECT json_agg(json_build_object(
                      'slot_id',   s.id,
                      'title',     s.title,
                      'position',  s.position,
                      'starts_at', s.starts_at,
                      'ends_at',   s.ends_at,
                      'speakers',  (SELECT json_agg(json_build_object(
                                             'id',           sp.id,
                                             'name',         sp.full_name,
                                             'organization', sp.organization,
                                             'role',         sa.role)
                                           ORDER BY sa.role, sp.full_name)
                                      FROM pmp.speaker_assignments sa
                                      JOIN pmp.speakers sp ON sp.id = sa.speaker_id
                                     WHERE sa.slot_id = s.id AND sa.replaced_by IS NULL))
                    ORDER BY s.starts_at NULLS LAST, s.position)
               FROM pmp.slots s
              WHERE s.session_id = se.id) AS slots
       FROM pmp.sessions se
       LEFT JOIN pmp.event_days d ON d.id = se.day_id
       LEFT JOIN pmp.rooms r      ON r.id = se.room_id
       LEFT JOIN pmp.tracks t     ON t.id = se.track_id
      WHERE se.event_id = $1
      ORDER BY se.starts_at, r.name NULLS LAST, se.title`,
    [eventId],
  );

  // One status per talk. `listTalks` returns a row per speaker assignment, so the
  // first row for a slot stands for it — the status is a property of the slot.
  const talks = new Map<string, { version_count: number; status: string; status_label: string }>();
  for (const talk of await listTalks(tx, eventId)) {
    if (!talks.has(talk.slot_id)) talks.set(talk.slot_id, talk);
  }

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    kind: row.kind,
    state: row.state,
    day: row.day,
    room: row.room,
    track: row.track,
    starts_at: row.starts_at.toISOString(),
    ends_at: row.ends_at.toISOString(),
    presentations: (row.slots ?? []).map((slot) => {
      const talk = talks.get(slot.slot_id);
      return {
        slot_id: slot.slot_id,
        title: slot.title,
        starts_at: slot.starts_at,
        ends_at: slot.ends_at,
        speakers: slot.speakers ?? [],
        version_count: talk?.version_count ?? 0,
        status: talk?.status ?? "missing",
        status_label: talk?.status_label ?? "Missing",
      };
    }),
  }));
}
