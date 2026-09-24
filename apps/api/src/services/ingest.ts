import type pg from "pg";
import { appendAudit } from "@pmp/db";
import { DevSignatureScanner, LocalStorage, inspectPresentation, worstSeverity } from "@pmp/files";
import type { Finding, ScanVerdict } from "@pmp/files";
import { scanVerdictToAction } from "@pmp/domain";

export const storage = new LocalStorage(process.env.FILE_ROOT ?? ".data");
const scanner = new DevSignatureScanner();

export type IngestSource = "portal" | "srr_usb" | "srr_manual";

export type IngestInput = {
  readonly eventId: string;
  readonly clientId: string;
  readonly slotId: string;
  readonly fileName: string;
  readonly uploadId: string;
  readonly source: IngestSource;
  readonly expectedSha256?: string;
  readonly actorUserId?: string;
  readonly speakerId?: string;
};

export type IngestResult = {
  readonly file_version_id: string;
  readonly version_number: number;
  readonly sha256: string;
  readonly processing_state: string;
  readonly inspection_state: string;
  readonly scan_verdict: ScanVerdict;
  readonly findings: Finding[];
};

export type IngestFailure = { readonly code: string; readonly message: string };

/**
 * The one intake path, shared by the speaker portal and SRR USB intake
 * (FR-FILE-002/003, FR-SRR-002). Order is fixed and not configurable:
 * assemble → verify whole-file checksum → scan → store → inspect.
 * `stored` is unreachable without a clean scan (I-2), whichever door the file
 * came through.
 */
export async function ingestVersion(
  tx: pg.PoolClient,
  input: IngestInput,
): Promise<{ ok: true; value: IngestResult } | { ok: false; error: IngestFailure }> {
  const object = await storage.assemble(input.uploadId, `${input.clientId}/${input.eventId}`);

  if (input.expectedSha256 && input.expectedSha256 !== object.sha256) {
    return {
      ok: false,
      error: {
        code: "file.checksum_mismatch",
        message: "The uploaded bytes did not match the checksum — nothing was stored.",
      },
    };
  }

  const { rows: fileRows } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.files (event_id, client_id, slot_id, display_name)
     SELECT $1, $2, $3, $4
      WHERE NOT EXISTS (SELECT 1 FROM pmp.files WHERE slot_id = $3)
     RETURNING id`,
    [input.eventId, input.clientId, input.slotId, input.fileName],
  );
  let fileId = fileRows[0]?.id;
  if (!fileId) {
    const { rows } = await tx.query<{ id: string }>(`SELECT id FROM pmp.files WHERE slot_id = $1`, [
      input.slotId,
    ]);
    fileId = rows[0]?.id;
  }
  if (!fileId) return { ok: false, error: { code: "file.no_slot", message: "No such talk." } };

  const { rows: nextRows } = await tx.query<{ next: number }>(
    `SELECT COALESCE(max(version_number), 0) + 1 AS next FROM pmp.file_versions WHERE file_id = $1`,
    [fileId],
  );
  const versionNumber = nextRows[0]!.next;

  const { rows: created } = await tx.query<{ id: string }>(
    `INSERT INTO pmp.file_versions (file_id, event_id, client_id, version_number, original_filename,
                                    content_type, size_bytes, sha256, s3_key, source,
                                    uploaded_by_speaker, uploaded_by_user,
                                    processing_state, inspection_state, review_state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'uploaded','pending','awaiting_review')
     RETURNING id`,
    [
      fileId,
      input.eventId,
      input.clientId,
      versionNumber,
      input.fileName,
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      object.size,
      Buffer.from(object.sha256, "hex"),
      object.key,
      input.source,
      input.speakerId ?? null,
      input.actorUserId ?? null,
    ],
  );
  const versionId = created[0]!.id;

  await tx.query(`UPDATE pmp.file_versions SET processing_state = 'scanning' WHERE id = $1`, [versionId]);
  const body = await storage.read(object.key);
  const scan = await scanner.scan(body);
  const processingState = scanVerdictToAction(scan.verdict) === "store" ? "stored" : "quarantined";
  await tx.query(`UPDATE pmp.file_versions SET processing_state = $1 WHERE id = $2`, [
    processingState,
    versionId,
  ]);

  // A clean file is queued for its PDF straight away (D-074): the reviewer previews it as
  // slides, and the archive's PDF is ready before anyone approves. Queued in this
  // transaction; the PDF worker polls, so it starts within seconds of the commit.
  if (processingState === "stored") {
    await tx.query(
      `INSERT INTO pmp.pdf_conversions (file_version_id, event_id, client_id)
       VALUES ($1, $2, $3) ON CONFLICT (file_version_id) DO NOTHING`,
      [versionId, input.eventId, input.clientId],
    );

    /*
     * A newer clean upload replaces any earlier version still waiting for a decision
     * (D-076, WORKFLOW_STATES §3 amended): only the newest file is reviewed, so a
     * reviewer cannot approve the stale one by mistake. Approved versions are left alone —
     * they keep playing in the room until this one is itself approved (FR-REV-004).
     * A quarantined upload replaces nothing.
     */
    const { rows: replaced } = await tx.query<{ id: string; review_state: string; version_number: number }>(
      `UPDATE pmp.file_versions old
          SET review_state = 'superseded', lock_version = old.lock_version + 1
         FROM pmp.file_versions prior
        WHERE old.id = prior.id
          AND old.file_id = $1 AND old.id <> $2
          AND old.review_state IN ('awaiting_review', 'in_review')
       RETURNING old.id, prior.review_state, old.version_number`,
      [fileId, versionId],
    );
    for (const old of replaced) {
      await tx.query(
        `INSERT INTO pmp.workflow_transitions
           (event_id, client_id, subject_type, subject_id, from_state, to_state, action, actor_user_id, reason)
         VALUES ($1, $2, 'file_version.review', $3, $4, 'superseded', 'supersede', NULL, $5)`,
        [input.eventId, input.clientId, old.id, old.review_state, `v${versionNumber} was uploaded before v${old.version_number} was reviewed`],
      );
    }
  }

  await appendAudit(tx, {
    partitionId: input.eventId,
    clientId: input.clientId,
    ...(input.actorUserId === undefined ? {} : { actorUserId: input.actorUserId }),
    action: `file.${processingState}`,
    subjectType: "file_version",
    subjectId: versionId,
    detail: {
      sha256: object.sha256,
      bytes: object.size,
      source: input.source,
      scanner: scanner.name,
      verdict: scan.verdict,
    },
  });

  if (processingState === "quarantined") {
    const finding: Finding = {
      check_code: "malware",
      severity: "blocking",
      detail: { signature: scan.signature ?? null, verdict: scan.verdict },
    };
    await tx.query(
      `INSERT INTO pmp.inspection_findings (file_version_id, event_id, client_id, check_code, severity, detail)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [versionId, input.eventId, input.clientId, finding.check_code, finding.severity, JSON.stringify(finding.detail)],
    );
    return {
      ok: true,
      value: {
        file_version_id: versionId,
        version_number: versionNumber,
        sha256: object.sha256,
        processing_state: processingState,
        inspection_state: "pending",
        scan_verdict: scan.verdict,
        findings: [finding],
      },
    };
  }

  const findings = inspectPresentation(body, input.fileName);
  for (const finding of findings) {
    await tx.query(
      `INSERT INTO pmp.inspection_findings (file_version_id, event_id, client_id, check_code, severity, detail)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [versionId, input.eventId, input.clientId, finding.check_code, finding.severity, JSON.stringify(finding.detail)],
    );
  }
  const worst = worstSeverity(findings);
  const inspectionState = worst === "blocking" ? "failed" : worst === "warning" ? "passed_with_warnings" : "passed";
  await tx.query(`UPDATE pmp.file_versions SET inspection_state = $1 WHERE id = $2`, [inspectionState, versionId]);

  await tx.query(`INSERT INTO pmp.outbox (topic, payload) VALUES ('file_version.state_changed', $1)`, [
    JSON.stringify({ file_version_id: versionId, event_id: input.eventId, inspection_state: inspectionState }),
  ]);

  return {
    ok: true,
    value: {
      file_version_id: versionId,
      version_number: versionNumber,
      sha256: object.sha256,
      processing_state: processingState,
      inspection_state: inspectionState,
      scan_verdict: scan.verdict,
      findings,
    },
  };
}

/** Version comparison for SRR (FR-SRR-003) — built from what inspection recorded. */
export type VersionFacts = {
  version_number: number;
  size_bytes: string;
  slides: number | null;
  embedded_media: number | null;
  aspect: string | null;
  videos_flagged: number;
};

export async function versionFacts(tx: pg.PoolClient, versionId: string): Promise<VersionFacts | null> {
  const { rows } = await tx.query<{ version_number: number; size_bytes: string }>(
    `SELECT version_number, size_bytes::text FROM pmp.file_versions WHERE id = $1`,
    [versionId],
  );
  if (!rows[0]) return null;

  const { rows: findings } = await tx.query<{ check_code: string; detail: Record<string, unknown> }>(
    `SELECT check_code, detail FROM pmp.inspection_findings WHERE file_version_id = $1`,
    [versionId],
  );

  const detailFor = (code: string, key: string): number | null => {
    for (const finding of findings) {
      if (finding.check_code === code && typeof finding.detail[key] === "number") {
        return finding.detail[key] as number;
      }
    }
    return null;
  };
  const aspect = findings.find((finding) => finding.check_code === "aspect")?.detail.aspect;

  return {
    version_number: rows[0].version_number,
    size_bytes: rows[0].size_bytes,
    slides: detailFor("metadata", "slides"),
    embedded_media: detailFor("metadata", "embedded_media"),
    aspect: typeof aspect === "string" ? aspect : null,
    videos_flagged: findings.filter((finding) => finding.check_code === "codec").length,
  };
}
