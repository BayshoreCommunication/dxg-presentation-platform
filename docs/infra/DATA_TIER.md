# DATA_TIER.md — Data-Tier Design (P0-D2)

Status: Draft v0.1 (2026-08-30) for G0-8 review. Scope: PostgreSQL, Redis, S3/KMS, replication, backup/PITR, and the RPO/RTO validation plan. Requirement baseline: NFR-DR-01 (RPO ≤15 min, RTO ≤4 h, quarterly rehearsal), NFR-AVL-01 (99.9%, zero event-day error budget), NFR-SCAL-01 (5 events / 40 rooms / 2,500 speakers / 4 TB per event), NFR-INT-01 (SHA-256, zero mismatch), NFR-SEC-01 (KMS at rest incl. backups), NFR-RET-01 (certified deletion). Excluded: edge/app tier (P0-D3), alarm detail (P0-D4). All resources live in the `Pmp-<env>-Data` stack (ENVIRONMENTS.md §3): termination protection ON, RemovalPolicy RETAIN.

## 1. PostgreSQL (authoritative domain store)

- **Engine**: RDS PostgreSQL (not Aurora, for MVP): the domain is metadata-heavy, not throughput-heavy — 4 TB/event is file bytes in S3, while Postgres holds rows; RDS is the simpler, well-understood option. Revisit Aurora only if connection or replica scaling demands it.
- **Topology**: Multi-AZ (two-AZ instance failover) in staging and production; single-AZ permitted only in development. Failover is automatic; the app uses the cluster endpoint and BullMQ workers retry idempotently through a failover blip.
- **Sizing (initial)**: prod `db.m7g.large` (2 vCPU/8 GiB) with gp3 storage 200 GiB, autoscaling to 1 TiB; staging one size down. Postgres data volume estimate: ~thousands of rows per event (sessions, versions, findings, audit) — storage is dominated by the audit chain and inspection findings; 200 GiB is generous headroom. Connection pooling via RDS Proxy (workers + API + spiky webhook traffic).
- **Version pinning**: latest RDS-supported PostgreSQL major at build time, pinned minor, upgrades rehearsed on staging first; never during an active event.
- **Encryption**: KMS CMK per environment; backups and snapshots inherit encryption (NFR-SEC-01).
- **Backup/PITR**: continuous WAL-based PITR enabled, 14-day window; automated daily snapshots retained 35 days; monthly snapshot copied cross-region (us-east-1) with the DR KMS key. RPO for Postgres = PITR granularity (≈5 min) ≤ 15 min requirement.
- **RLS**: enforced from the first migration (SECURITY_MODEL §1); the migration role is distinct from the app role; app role has no BYPASSRLS.

## 2. Redis (job transport only — D-003)

- **ElastiCache Redis, replication group with automatic failover**: primary + one replica across AZs in staging/prod; single node in dev. Redis holds BullMQ queues and rate limits only; everything is recoverable from the Postgres outbox, so **durability is not required — availability is**: AOF off, failover target < 1 min.
- **Recovery posture**: on total Redis loss, the dispatcher re-drives jobs from the outbox; queue idempotency keys (WORKFLOW_STATES common rules) make replays safe. This recovery path is an explicit test in the validation plan (§5.4).
- TLS in transit + auth token in Secrets Manager; no public access.

## 3. S3 layout, versioning, KMS

Buckets per environment (all: versioning ON, SSE-KMS with per-env CMK, Block Public Access, TLS-only bucket policy, access logging):

| Bucket | Contents | Lifecycle |
|---|---|---|
| `pmp-<env>-library` | Original uploads + file versions (content-addressed keys include SHA-256) | No expiry; noncurrent versions retained (versions ARE the product); certified deletion per SECURITY_MODEL §6 |
| `pmp-<env>-derivatives` | Previews, converted PDFs, inspection artifacts (tracked in `derived_objects`) | Rebuildable: noncurrent versions expire after 30 days; IA after 90 days |
| `pmp-<env>-archive` | Built archive packages + manifests | Per retention policy; deletion certified |
| `pmp-<env>-agent-dist` | Signed agent installers/updates (Agent stack) | Keep N/N-1 + last stable per channel |
| `pmp-<env>-audit-export` | Audit chain exports | ≥3 years (NFR-SEC-07), Object Lock (compliance mode) considered at G0-8 |
| `pmp-<env>-access-logs` | S3/ALB/CloudFront logs | 13 months, IA at 30 days |

- **Multipart uploads**: incomplete multipart uploads aborted after 7 days by lifecycle rule (10 GB resumable uploads will strand parts); resumable-upload bookkeeping in Postgres references the upload ID so a resumed upload within 7 days survives.
- **Storage classes**: library stays Standard through the event + 90 days, then Intelligent-Tiering (post-event access is archive-driven and rare).

## 4. Cross-region replication (DR)

- **Replicated to us-east-1**: `library`, `archive`, `audit-export` (the unrecoverable data). Replication rule includes **delete-marker replication disabled** and replica versioning ON; certified deletion handles replicas explicitly by enumerating replica versions (SECURITY_MODEL §6.2) — replication never silently propagates destruction, and never substitutes for it either.
- **Not replicated**: `derivatives` (rebuildable), `agent-dist` (re-publishable), logs.
- Replica buckets use a DR-region KMS CMK; replication role is the only writer.
- **RPO**: S3 RTC (Replication Time Control) enabled on `library` — 15-minute replication SLA matches NFR-DR-01, with replication metrics + missed-threshold alarms (wired in P0-D4).

## 5. RPO/RTO validation plan (quarterly rehearsal, NFR-DR-01)

Each rehearsal runs on **staging** (production-parity), is timed, and files a report under `docs/runbooks/dr-rehearsals/`:

1. **Postgres PITR restore**: pick a timestamp mid-load-test, restore to new instance, verify: latest committed transaction ≤15 min before target (RPO), app smoke-passes against restored DB, audit-chain verification endpoint passes on restored data. Target: restore + verify ≤2 h.
2. **Postgres snapshot restore in DR region** from the cross-region copy: same verification. Target ≤3 h.
3. **S3 replica integrity**: sample N file versions, compare SHA-256 against Postgres-recorded checksums in the DR region (NFR-INT-01 zero mismatch).
4. **Redis loss drill**: flush staging Redis under synthetic queue load; verify dispatcher re-drive from outbox completes with zero lost and zero duplicated jobs.
5. **Full RTO walk-through** (annually, or before first pilot): from "region impaired" declaration → DR runbook → serving from restored stack ≤4 h. MVP DR is restore-based (no warm standby); the runbook, not standby infrastructure, is what makes 4 h achievable — it must exist and be rehearsed before pilot (M7-4).
6. Rehearsal cadence enforced by a scheduled reminder + report check in the ops calendar; a missed quarter is a SEV-3.

## 6. Event-day posture (NFR-AVL-01)

- Change freeze includes the data tier: no instance modifications, no engine patches, no lifecycle/replication changes during active events.
- Pre-event checklist (part of readiness certification): backup window verified outside event hours, PITR healthy, replication lag < threshold, Redis failover tested within last 90 days, disk headroom ≥30%.

## 7. Open items for G0-8

1. Object Lock (compliance) on `audit-export` — strongest append-only guarantee vs operational friction with certified deletion exceptions.
2. RDS Proxy from day one vs added when connection pressure appears.
3. Atlas-style managed alternative rejected: no MongoDB in this product (D-003) — confirm nothing else assumes it.
4. Exact instance sizing after pilot-event profile arrives (P0-E15).
