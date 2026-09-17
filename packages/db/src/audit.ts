import { createHash } from "node:crypto";
import type pg from "pg";

/**
 * Append-only, hash-chained audit (BUILD_SPEC §6.5, I-5). The chain is per
 * partition (one per event); each record hashes its own canonical form plus the
 * previous record's hash, so a deleted or edited row breaks verification.
 */
export type AuditInput = {
  readonly partitionId: string;
  readonly clientId: string;
  readonly actorUserId?: string;
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly detail?: Record<string, unknown>;
  readonly reason?: string;
};

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) => {
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort());
    }
    return inner;
  });

export async function appendAudit(tx: pg.PoolClient, input: AuditInput): Promise<{ seq: number }> {
  const { rows: head } = await tx.query<{ seq: string; record_hash: Buffer }>(
    `SELECT seq, record_hash FROM pmp.audit_records
      WHERE partition_id = $1 ORDER BY seq DESC LIMIT 1`,
    [input.partitionId],
  );
  const prevHash = head[0]?.record_hash ?? Buffer.alloc(32);
  const seq = Number(head[0]?.seq ?? 0) + 1;

  const body = canonical({
    partition_id: input.partitionId,
    seq,
    actor_user_id: input.actorUserId ?? null,
    action: input.action,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    detail: input.detail ?? {},
    reason: input.reason ?? null,
  });
  const recordHash = createHash("sha256").update(body).update(prevHash).digest();

  await tx.query(
    `INSERT INTO pmp.audit_records
       (partition_id, client_id, seq, actor_user_id, action, subject_type, subject_id,
        detail, reason, prev_hash, record_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      input.partitionId,
      input.clientId,
      seq,
      input.actorUserId ?? null,
      input.action,
      input.subjectType,
      input.subjectId,
      JSON.stringify(input.detail ?? {}),
      input.reason ?? null,
      prevHash,
      recordHash,
    ],
  );
  return { seq };
}

export type ChainVerdict = { readonly intact: true } | { readonly intact: false; readonly brokenAtSeq: number };

/** Walks the chain and reports the first break (the `:verify` endpoint's core). */
export async function verifyAuditChain(tx: pg.PoolClient, partitionId: string): Promise<ChainVerdict> {
  const { rows } = await tx.query<{
    seq: string;
    actor_user_id: string | null;
    action: string;
    subject_type: string;
    subject_id: string;
    detail: Record<string, unknown>;
    reason: string | null;
    prev_hash: Buffer;
    record_hash: Buffer;
  }>(
    `SELECT seq, actor_user_id, action, subject_type, subject_id, detail, reason, prev_hash, record_hash
       FROM pmp.audit_records WHERE partition_id = $1 ORDER BY seq ASC`,
    [partitionId],
  );

  let expectedPrev: Buffer<ArrayBufferLike> = Buffer.alloc(32);
  let expectedSeq = 1;
  for (const row of rows) {
    const seq = Number(row.seq);
    if (seq !== expectedSeq || !row.prev_hash.equals(expectedPrev)) {
      return { intact: false, brokenAtSeq: seq };
    }
    const body = canonical({
      partition_id: partitionId,
      seq,
      actor_user_id: row.actor_user_id,
      action: row.action,
      subject_type: row.subject_type,
      subject_id: row.subject_id,
      detail: row.detail,
      reason: row.reason,
    });
    const hash = createHash("sha256").update(body).update(row.prev_hash).digest();
    if (!hash.equals(row.record_hash)) return { intact: false, brokenAtSeq: seq };
    expectedPrev = row.record_hash;
    expectedSeq += 1;
  }
  return { intact: true };
}
