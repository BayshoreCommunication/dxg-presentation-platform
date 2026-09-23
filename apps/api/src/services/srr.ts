import type pg from "pg";
import { appendAudit } from "@pmp/db";
import { deriveTalkStatus, TALK_STATUS_LABEL } from "@pmp/domain";
import type { Actor, DomainError, Result } from "@pmp/domain";
import { err, ok } from "@pmp/domain";
import { formatBytes, formatBytesDelta } from "@pmp/format";
import { ingestVersion, versionFacts } from "./ingest.ts";
import type { VersionFacts } from "./ingest.ts";

/* ── screen 11: Speaker Ready Room dashboard ─────────────────────────────── */

export type ExpectedArrival = {
  speaker_id: string;
  speaker: string;
  slot_id: string;
  title: string;
  room: string | null;
  starts_at: string;
  status: string;
  status_label: string;
  checkin_id: string | null;
  signed_off: boolean;
};

export async function srrDashboard(
  tx: pg.PoolClient,
  eventId: string,
): Promise<{ expected: ExpectedArrival[]; warnings: { slot_id: string; speaker: string | null; check_code: string; severity: string }[]; stations: { station: string; technician: string | null; busy: boolean }[] }> {
  const { rows } = await tx.query<{
    speaker_id: string;
    speaker: string;
    slot_id: string;
    title: string;
    room: string | null;
    starts_at: string;
    session_state: string;
    versions: { processing: string; inspection: string; review: string }[] | null;
    room_copies: { state: string; requiresAck: boolean; acknowledged: boolean }[] | null;
    checkin_id: string | null;
    signed_off: boolean;
  }>(
    `SELECT sp.id AS speaker_id, sp.full_name AS speaker, s.id AS slot_id, s.title,
            r.name AS room, se.starts_at, se.session_state,
            (SELECT json_agg(json_build_object('processing', fv.processing_state,
                                               'inspection', fv.inspection_state,
                                               'review', fv.review_state) ORDER BY fv.version_number)
               FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
              WHERE f.slot_id = s.id) AS versions,
            (SELECT json_agg(json_build_object('state', rf.sync_state,
                     'requiresAck', (rf.acknowledged_at IS NULL AND rf.sync_state = 'synced'),
                     'acknowledged', (rf.acknowledged_at IS NOT NULL)))
               FROM pmp.room_files rf
               JOIN pmp.file_versions fv2 ON fv2.id = rf.file_version_id
               JOIN pmp.files f2 ON f2.id = fv2.file_id
              WHERE f2.slot_id = s.id AND fv2.review_state = 'approved') AS room_copies,
            (SELECT c.id FROM pmp.srr_checkins c
              WHERE c.speaker_id = sp.id AND c.departed_at IS NULL
              ORDER BY c.checked_in_at DESC LIMIT 1) AS checkin_id,
            EXISTS (SELECT 1 FROM pmp.sign_offs so WHERE so.speaker_id = sp.id) AS signed_off
       FROM pmp.speakers sp
       JOIN pmp.speaker_assignments sa ON sa.speaker_id = sp.id
       JOIN pmp.slots s ON s.id = sa.slot_id
       JOIN pmp.sessions se ON se.id = s.session_id
       LEFT JOIN pmp.rooms r ON r.id = se.room_id
      WHERE sp.event_id = $1 AND sp.merged_into IS NULL
      ORDER BY se.starts_at`,
    [eventId],
  );

  const expected = rows.map((row) => {
    const status = deriveTalkStatus({
      sessionState: row.session_state as never,
      eventArchived: false,
      versions: (row.versions ?? []) as never,
      roomCopies: (row.room_copies ?? []) as never,
    });
    return {
      speaker_id: row.speaker_id,
      speaker: row.speaker,
      slot_id: row.slot_id,
      title: row.title,
      room: row.room,
      starts_at: row.starts_at,
      status,
      status_label: TALK_STATUS_LABEL[status],
      checkin_id: row.checkin_id,
      signed_off: row.signed_off,
    };
  });

  const { rows: warnings } = await tx.query<{
    slot_id: string;
    speaker: string | null;
    check_code: string;
    severity: string;
  }>(
    `SELECT s.id AS slot_id, inf.check_code, inf.severity,
            (SELECT sp.full_name FROM pmp.speaker_assignments sa
               JOIN pmp.speakers sp ON sp.id = sa.speaker_id WHERE sa.slot_id = s.id LIMIT 1) AS speaker
       FROM pmp.inspection_findings inf
       JOIN pmp.file_versions fv ON fv.id = inf.file_version_id
       JOIN pmp.files f ON f.id = fv.file_id
       JOIN pmp.slots s ON s.id = f.slot_id
      WHERE inf.event_id = $1 AND inf.waived_at IS NULL
        AND inf.severity IN ('warning', 'blocking')
        AND fv.review_state IN ('awaiting_review', 'in_review')
      ORDER BY inf.severity DESC`,
    [eventId],
  );

  // This event's check-ins only. Without `event_id` a station busy at one event showed
  // as "In session", under that event's technician, on every other event's screen.
  const { rows: stations } = await tx.query<{ station: string; technician: string | null; busy: boolean }>(
    `SELECT st.station,
            (SELECT u.display_name FROM pmp.srr_checkins c
               JOIN pmp.users u ON u.id = c.technician_id
              WHERE c.event_id = $1 AND c.station = st.station AND c.departed_at IS NULL
              ORDER BY c.checked_in_at DESC LIMIT 1) AS technician,
            EXISTS (SELECT 1 FROM pmp.srr_checkins c
                     WHERE c.event_id = $1 AND c.station = st.station AND c.departed_at IS NULL) AS busy
       FROM (VALUES ('Station 1'), ('Station 2'), ('Station 3 · USB')) AS st(station)`,
    [eventId],
  );

  return { expected, warnings, stations };
}

/* ── screen 12: check-in ─────────────────────────────────────────────────── */

export async function checkIn(
  tx: pg.PoolClient,
  actor: Actor,
  input: { eventId: string; speakerId: string; station: string },
): Promise<Result<{ checkin_id: string }, DomainError>> {
  const { rows: existing } = await tx.query<{ id: string }>(
    `SELECT id FROM pmp.srr_checkins WHERE speaker_id = $1 AND departed_at IS NULL`,
    [input.speakerId],
  );
  if (existing[0]) return ok({ checkin_id: existing[0].id });

  const { rows: speaker } = await tx.query<{ client_id: string }>(
    `SELECT client_id FROM pmp.speakers WHERE id = $1 AND event_id = $2`,
    [input.speakerId, input.eventId],
  );
  if (!speaker[0]) return err({ code: "srr.speaker_not_found", message: "No such speaker at this event." });

  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.srr_checkins (event_id, client_id, speaker_id, technician_id, station)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [input.eventId, speaker[0].client_id, input.speakerId, actor.id, input.station],
  );

  await appendAudit(tx, {
    partitionId: input.eventId,
    clientId: speaker[0].client_id,
    actorUserId: actor.id,
    action: "srr.checked_in",
    subjectType: "srr_checkin",
    subjectId: rows[0]!.id,
    detail: { speaker_id: input.speakerId, station: input.station },
  });

  return ok({ checkin_id: rows[0]!.id });
}

export type CheckinDetail = {
  checkin: { id: string; station: string | null; checked_in_at: string; technician: string; departed_at: string | null };
  speaker: { id: string; name: string };
  talk: { slot_id: string; title: string; room: string | null; starts_at: string; final_locked: boolean; status: string; status_label: string };
  approved: VersionFacts | null;
  latest: (VersionFacts & { file_version_id: string; review_state: string; processing_state: string }) | null;
  usb: { id: string; scan_result: string; file_version_id: string | null; created_at: string } | null;
  receipt: { version_number: number; sha256: string; signed_at: string; station: string | null; technician: string } | null;
};

export async function checkinDetail(tx: pg.PoolClient, checkinId: string): Promise<CheckinDetail | null> {
  const { rows } = await tx.query<{
    id: string;
    station: string | null;
    checked_in_at: string;
    departed_at: string | null;
    technician: string;
    speaker_id: string;
    speaker_name: string;
    slot_id: string;
    title: string;
    room: string | null;
    starts_at: string;
    final_locked: boolean;
    session_state: string;
    versions: { processing: string; inspection: string; review: string }[] | null;
    room_copies: { state: string; requiresAck: boolean; acknowledged: boolean }[] | null;
  }>(
    `SELECT c.id, c.station, c.checked_in_at, c.departed_at, u.display_name AS technician,
            sp.id AS speaker_id, sp.full_name AS speaker_name,
            s.id AS slot_id, s.title, r.name AS room, se.starts_at, s.final_locked, se.session_state,
            (SELECT json_agg(json_build_object('processing', fv.processing_state,
                                               'inspection', fv.inspection_state,
                                               'review', fv.review_state) ORDER BY fv.version_number)
               FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
              WHERE f.slot_id = s.id) AS versions,
            (SELECT json_agg(json_build_object('state', rf.sync_state,
                     'requiresAck', (rf.acknowledged_at IS NULL AND rf.sync_state = 'synced'),
                     'acknowledged', (rf.acknowledged_at IS NOT NULL)))
               FROM pmp.room_files rf
               JOIN pmp.file_versions fv2 ON fv2.id = rf.file_version_id
               JOIN pmp.files f2 ON f2.id = fv2.file_id
              WHERE f2.slot_id = s.id AND fv2.review_state = 'approved') AS room_copies
       FROM pmp.srr_checkins c
       JOIN pmp.users u ON u.id = c.technician_id
       JOIN pmp.speakers sp ON sp.id = c.speaker_id
       JOIN pmp.speaker_assignments sa ON sa.speaker_id = sp.id
       JOIN pmp.slots s ON s.id = sa.slot_id
       JOIN pmp.sessions se ON se.id = s.session_id
       LEFT JOIN pmp.rooms r ON r.id = se.room_id
      WHERE c.id = $1
      LIMIT 1`,
    [checkinId],
  );
  const row = rows[0];
  if (!row) return null;

  const status = deriveTalkStatus({
    sessionState: row.session_state as never,
    eventArchived: false,
    versions: (row.versions ?? []) as never,
    roomCopies: (row.room_copies ?? []) as never,
  });

  const { rows: approvedRows } = await tx.query<{ id: string }>(
    `SELECT fv.id FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
      WHERE f.slot_id = $1 AND fv.review_state = 'approved'
      ORDER BY fv.version_number DESC LIMIT 1`,
    [row.slot_id],
  );
  const { rows: latestRows } = await tx.query<{ id: string; review_state: string; processing_state: string }>(
    `SELECT fv.id, fv.review_state, fv.processing_state
       FROM pmp.file_versions fv JOIN pmp.files f ON f.id = fv.file_id
      WHERE f.slot_id = $1 ORDER BY fv.version_number DESC LIMIT 1`,
    [row.slot_id],
  );

  const approved = approvedRows[0] ? await versionFacts(tx, approvedRows[0].id) : null;
  const latestFacts = latestRows[0] ? await versionFacts(tx, latestRows[0].id) : null;

  const { rows: usbRows } = await tx.query<{
    id: string;
    scan_result: string;
    file_version_id: string | null;
    created_at: string;
  }>(
    `SELECT id, scan_result, file_version_id, created_at FROM pmp.usb_ingestions
      WHERE checkin_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [checkinId],
  );

  const { rows: receiptRows } = await tx.query<{ content: Record<string, unknown> }>(
    `SELECT rc.content FROM pmp.receipts rc
       JOIN pmp.sign_offs so ON so.id = rc.sign_off_id
      WHERE so.checkin_id = $1 ORDER BY rc.created_at DESC LIMIT 1`,
    [checkinId],
  );

  return {
    checkin: {
      id: row.id,
      station: row.station,
      checked_in_at: row.checked_in_at,
      departed_at: row.departed_at,
      technician: row.technician,
    },
    speaker: { id: row.speaker_id, name: row.speaker_name },
    talk: {
      slot_id: row.slot_id,
      title: row.title,
      room: row.room,
      starts_at: row.starts_at,
      final_locked: row.final_locked,
      status,
      status_label: TALK_STATUS_LABEL[status],
    },
    approved,
    latest:
      latestFacts && latestRows[0]
        ? {
            ...latestFacts,
            file_version_id: latestRows[0].id,
            review_state: latestRows[0].review_state,
            processing_state: latestRows[0].processing_state,
          }
        : null,
    usb: usbRows[0] ?? null,
    receipt: (receiptRows[0]?.content as CheckinDetail["receipt"]) ?? null,
  };
}

/* ── screen 13: USB intake ───────────────────────────────────────────────── */

export type UsbResult = {
  ingestion_id: string;
  scan_result: string;
  file_version_id: string | null;
  version_number: number | null;
  inspection_state: string | null;
  /** What the incoming file is being compared against, and why. */
  compared_with: { version_number: number; basis: "approved" | "previous" } | null;
  comparison: { field: string; approved: string; incoming: string; delta: string }[];
  message: string;
};

/**
 * FR-SRR-002: a USB file is scanned before anything else, and a failed scan
 * quarantines it while the approved version stays active (I-1, I-2). Acceptance
 * sends the new version to re-approval — it never becomes the room copy here.
 */
export async function usbIngest(
  tx: pg.PoolClient,
  actor: Actor,
  input: { checkinId: string; uploadId: string; fileName: string; reason: string },
): Promise<Result<UsbResult, DomainError>> {
  if (!input.reason.trim()) {
    return err({
      code: "srr.reason_required",
      message: "Accepting a USB version requires a reason — nothing was recorded.",
    });
  }

  const detail = await checkinDetail(tx, input.checkinId);
  if (!detail) return err({ code: "srr.checkin_not_found", message: "No such check-in." });

  const { rows: scope } = await tx.query<{ event_id: string; client_id: string }>(
    `SELECT event_id, client_id FROM pmp.srr_checkins WHERE id = $1`,
    [input.checkinId],
  );

  const ingested = await ingestVersion(tx, {
    eventId: scope[0]!.event_id,
    clientId: scope[0]!.client_id,
    slotId: detail.talk.slot_id,
    fileName: input.fileName,
    uploadId: input.uploadId,
    source: "srr_usb",
    actorUserId: actor.id,
  });
  if (!ingested.ok) return err({ code: ingested.error.code, message: ingested.error.message });

  const { rows: ingestionRows } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.usb_ingestions (checkin_id, event_id, client_id, file_version_id, scan_result, scan_detail)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [
      input.checkinId,
      scope[0]!.event_id,
      scope[0]!.client_id,
      ingested.value.file_version_id,
      ingested.value.scan_verdict,
      JSON.stringify({ reason: input.reason, filename: input.fileName }),
    ],
  );

  await appendAudit(tx, {
    partitionId: scope[0]!.event_id,
    clientId: scope[0]!.client_id,
    actorUserId: actor.id,
    action: "srr.usb_ingested",
    subjectType: "usb_ingestion",
    subjectId: ingestionRows[0]!.id,
    detail: { verdict: ingested.value.scan_verdict, version: ingested.value.version_number },
    reason: input.reason,
  });

  if (ingested.value.scan_verdict !== "clean") {
    return ok({
      ingestion_id: ingestionRows[0]!.id,
      scan_result: ingested.value.scan_verdict,
      file_version_id: ingested.value.file_version_id,
      version_number: ingested.value.version_number,
      inspection_state: null,
      compared_with: null,
      comparison: [],
      message:
        "Scan failed — the file is quarantined and did not enter the library. The approved version is untouched and still plays in the room.",
    });
  }

  const incoming = await versionFacts(tx, ingested.value.file_version_id);

  // Compare against the approved version when there is one; otherwise against
  // whatever the speaker last submitted, so the technician always sees what
  // changed rather than an empty panel.
  const baseline = detail.approved ?? detail.latest;
  const comparedWith = baseline
    ? {
        version_number: baseline.version_number,
        basis: (detail.approved ? "approved" : "previous") as "approved" | "previous",
      }
    : null;
  const comparison = compare(baseline, incoming);

  return ok({
    ingestion_id: ingestionRows[0]!.id,
    scan_result: "clean",
    file_version_id: ingested.value.file_version_id,
    version_number: ingested.value.version_number,
    inspection_state: ingested.value.inspection_state,
    compared_with: comparedWith,
    comparison,
    message: `Scan clean · imported as v${ingested.value.version_number} · sent to re-approval. The room keeps the approved version until this one is approved and re-synced.`,
  });
}

function compare(approved: VersionFacts | null, incoming: VersionFacts | null) {
  if (!approved || !incoming) return [];
  const delta = (a: number | null, b: number | null) =>
    a === null || b === null ? "—" : b === a ? "unchanged" : `${b > a ? "+" : ""}${b - a}`;
  return [
    {
      field: "Slides",
      approved: String(approved.slides ?? "—"),
      incoming: String(incoming.slides ?? "—"),
      delta: delta(approved.slides, incoming.slides),
    },
    {
      field: "Embedded media",
      approved: String(approved.embedded_media ?? 0),
      incoming: String(incoming.embedded_media ?? 0),
      delta: delta(approved.embedded_media ?? 0, incoming.embedded_media ?? 0),
    },
    {
      field: "Slide size",
      approved: approved.aspect ?? "—",
      incoming: incoming.aspect ?? "—",
      delta: approved.aspect === incoming.aspect ? "unchanged" : "changed",
    },
    {
      field: "Size",
      approved: formatBytes(approved.size_bytes),
      incoming: formatBytes(incoming.size_bytes),
      delta: formatBytesDelta(approved.size_bytes, incoming.size_bytes),
    },
  ];
}

/* ── sign-off and receipt (FR-SRR-003/004) ───────────────────────────────── */

export async function signOff(
  tx: pg.PoolClient,
  actor: Actor,
  input: { checkinId: string; fileVersionId: string },
): Promise<Result<{ receipt: NonNullable<CheckinDetail["receipt"]> }, DomainError>> {
  const detail = await checkinDetail(tx, input.checkinId);
  if (!detail) return err({ code: "srr.checkin_not_found", message: "No such check-in." });

  const { rows: version } = await tx.query<{
    id: string;
    version_number: number;
    sha256: Buffer | null;
    processing_state: string;
    event_id: string;
    client_id: string;
  }>(
    `SELECT id, version_number, sha256, processing_state, event_id, client_id
       FROM pmp.file_versions WHERE id = $1`,
    [input.fileVersionId],
  );
  if (!version[0]) return err({ code: "srr.version_not_found", message: "No such version." });

  // I-2 again, at the last gate: nothing unscanned is ever signed for.
  if (version[0].processing_state !== "stored") {
    return err({
      code: "srr.not_signable",
      message: `This version is "${version[0].processing_state}" — only a scanned, stored version can be signed off.`,
    });
  }

  const { rows: signOffRows } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.sign_offs (checkin_id, event_id, client_id, speaker_id, file_version_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [input.checkinId, version[0].event_id, version[0].client_id, detail.speaker.id, input.fileVersionId],
  );

  const receipt = {
    version_number: version[0].version_number,
    sha256: version[0].sha256 ? version[0].sha256.toString("hex") : "",
    signed_at: new Date().toISOString(),
    station: detail.checkin.station,
    technician: detail.checkin.technician,
  };

  const { rows: receiptRows } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.receipts (sign_off_id, event_id, client_id, content)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [signOffRows[0]!.id, version[0].event_id, version[0].client_id, JSON.stringify(receipt)],
  );
  await tx.query(`UPDATE pmp.sign_offs SET receipt_id = $1 WHERE id = $2`, [
    receiptRows[0]!.id,
    signOffRows[0]!.id,
  ]);

  // Final onsite lock: from here the speaker portal can no longer replace it.
  await tx.query(`UPDATE pmp.slots SET final_locked = true, lock_version = lock_version + 1 WHERE id = $1`, [
    detail.talk.slot_id,
  ]);

  await appendAudit(tx, {
    partitionId: version[0].event_id,
    clientId: version[0].client_id,
    actorUserId: actor.id,
    action: "srr.signed_off",
    subjectType: "sign_off",
    subjectId: signOffRows[0]!.id,
    detail: { ...receipt, slot_id: detail.talk.slot_id },
  });

  return ok({ receipt });
}

export async function depart(
  tx: pg.PoolClient,
  actor: Actor,
  checkinId: string,
): Promise<Result<{ departed: true }, DomainError>> {
  const { rowCount } = await tx.query(
    `UPDATE pmp.srr_checkins SET departed_at = now(), lock_version = lock_version + 1
      WHERE id = $1 AND departed_at IS NULL`,
    [checkinId],
  );
  if (rowCount === 0) return err({ code: "srr.already_departed", message: "Already checked out." });
  const { rows } = await tx.query<{ event_id: string; client_id: string }>(
    `SELECT event_id, client_id FROM pmp.srr_checkins WHERE id = $1`,
    [checkinId],
  );
  await appendAudit(tx, {
    partitionId: rows[0]!.event_id,
    clientId: rows[0]!.client_id,
    actorUserId: actor.id,
    action: "srr.departed",
    subjectType: "srr_checkin",
    subjectId: checkinId,
  });
  return ok({ departed: true });
}
