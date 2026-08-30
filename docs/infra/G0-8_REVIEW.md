# G0-8_REVIEW.md — Infrastructure Design Gate Review

Date: 2026-08-30. Reviewer: Claude (AI pair), on Travis's instruction. PHASE0_GATE names the second developer as reviewer — **this review stands in for that and should be ratified by D2 when they join**; ratification is a listed condition below.

## 1. Coverage check against the G0-8 requirement list

| Gate requirement | Where designed | Verdict |
|---|---|---|
| Dev / production-parity staging / production | ENVIRONMENTS §1 | ✅ (staging permanent, anonymized fixtures) |
| Separate network/data/application/observability stacks | ENVIRONMENTS §3 (+Agent, +Cicd) | ✅ |
| Multi-AZ PostgreSQL | DATA_TIER §1 | ✅ (single-AZ only in dev) |
| Redis availability | DATA_TIER §2 | ✅ (failover, outbox re-drive drill) |
| Versioned S3/KMS | DATA_TIER §3 | ✅ (6 buckets, per-env CMKs, multipart-abort rule) |
| Cross-region replication | DATA_TIER §4 | ✅ (RTC on library; delete-marker replication off) |
| Backup/PITR | DATA_TIER §1 | ✅ (14d PITR, 35d snapshots, cross-region copies) |
| RPO/RTO validation | DATA_TIER §5 | ✅ (6 timed rehearsals, quarterly, reports filed) |
| WAF and CloudFront | EDGE_APP_TIER §1 | ✅ (CloudFront-only ALB ingress) |
| Worker scaling | EDGE_APP_TIER §3 | ✅ (per-queue-depth, isolated services) |
| Agent heartbeat monitoring | OBSERVABILITY §1–2 | ✅ (60s beat, 3-min alarm < 5-min requirement) |
| Queue backlog + outbox-age alarms | OBSERVABILITY §2 | ✅ (outbox >2 min pages) |
| Deployment rollback | EDGE_APP_TIER §4, INFRA_CI §5 | ✅ (blue/green shift-back; task-def revert; data-stack PR rollback plans) |
| Stateful-stack termination protection | ENVIRONMENTS §3, EDGE_APP_TIER §6, CI assertion | ✅ (also CI-tested) |
| CI: `cdk synth --strict` | INFRA_CI §2.2 | ✅ (all envs, warnings-as-errors) |
| CI: cdk-nag | INFRA_CI §2.3 | ✅ (justified suppressions only) |
| CI: type checking | INFRA_CI §2.1 | ✅ |
| CI: infrastructure tests | INFRA_CI §2.4 | ✅ (incl. listener-SG regression test) |
| CI: `cdk diff` review before deploy | INFRA_CI §2.5, §3 | ✅ (PR comment + Network/Data manual workflow) |
| CI: drift detection | INFRA_CI §4 | ✅ (nightly, code-only remediation) |
| No RFPilot reduced-redundancy copy | ENVIRONMENTS §1, DATA_TIER header | ✅ (explicit) |
| Rough costing | this review §3 | ✅ |

**Gaps found and fixed during review**: none blocking. One observation: PHASE0_GATE G0-8 required "costed roughly" which no doc carried — added below (§3).

## 2. Open-item decisions

| # | Item (source) | Decision | Rationale |
|---|---|---|---|
| 1 | Dedicated vs shared AWS account (ENVIRONMENTS) | **Dedicated account — RECOMMENDED, needs Travis/billing confirmation** | Cleanest blast-radius, IAM, and cost isolation from RFPilot; org invite is cheap now, painful later. Condition C1. |
| 2 | Regions (ENVIRONMENTS) | **Confirmed: us-east-2 primary, us-east-1 DR** | Team operational familiarity (RFPilot prod); both satisfy "AWS US". |
| 3 | Frontend hosting (ENVIRONMENTS/EDGE_APP) | **Confirmed: Next.js SSR on Fargate behind ALB/CloudFront** | Event-freeze + WAF must cover the full serving path (EDGE_APP §2 rationale accepted). |
| 4 | Agent stack separate vs folded into App (ENVIRONMENTS) | **Keep separate `Pmp-<env>-Agent`** | Event-pinned rollout independence is a real operational need during events. |
| 5 | Object Lock on `audit-export` (DATA_TIER) | **Yes — Governance mode, 3-year retention** | Strongest practical append-only guarantee; governance (not compliance) mode retains an audited break-glass, consistent with the platform's override philosophy. |
| 6 | RDS Proxy day one (DATA_TIER) | **Not day one** | Connection pressure is speculative pre-pilot; pgBouncer-style pooling in app config first; add Proxy if M7-2 load tests show exhaustion. Revisit trigger written into M7-2. |
| 7 | Mongo assumptions (DATA_TIER) | **Verified none** | Schema (P0-C1), OpenAPI (P0-C2), and all infra docs are Postgres-only. |
| 8 | Instance sizing (DATA_TIER) | **Deferred by design** | Awaits pilot-event profile (P0-E15); placeholder sizes stand for costing. |
| 9 | S3 Transfer Acceleration (EDGE_APP) | **Deferred to G0-2 measurement** | Correct place to decide; no action now. |
| 10 | WebSocket scale-out (EDGE_APP) | **Deferred to M1 spike** | Not an infra-gate blocker; ALB supports both candidate designs. |
| 11 | One web service vs two (EDGE_APP) | **One service initially** | Matches SPEC §2 (single role-gated app); split is a later scaling move, not a redesign. |
| 12 | Paging tool (OBSERVABILITY) | **PagerDuty** | 15-min SEV-1 response with escalation/rotations during live events is exactly its job; free/starter tier suffices for a 2-dev team. |
| 13 | Logs Insights vs OpenSearch (OBSERVABILITY) | **CloudWatch Logs Insights for MVP** | Volume is modest; OpenSearch is standing cost + ops burden; revisit at pilot retro. |
| 14 | Agent crash telemetry (OBSERVABILITY) | **Deferred to G0-1 PoC** | Sentry Electron SDK is the default candidate; PoC verifies footprint. |
| 15 | cdk-nag packs (INFRA_CI) | **AwsSolutions only** | HIPAA/NIST packs add noise without a compliance driver; pentest (M7-3) is the real check. |
| 16 | Staging deploy cadence (INFRA_CI) | **Per-merge** | Matches CI freshness; batch only if it proves noisy (recorded trigger). |
| 17 | Diff role scope (INFRA_CI) | **Read-only: DescribeStacks/GetTemplate + `cdk diff` lookups; no mutating IAM actions** | Least privilege for PR comments. |

## 3. Rough monthly cost (production + staging + dev, us-east-2, pre-pilot sizing)

| Component | Prod | Staging | Dev |
|---|---|---|---|
| RDS Postgres (m7g.large Multi-AZ / m7g.medium Multi-AZ / t4g.medium single) | ~$260 | ~$130 | ~$50 |
| ElastiCache Redis (replicated / replicated small / single) | ~$90 | ~$50 | ~$15 |
| ECS Fargate (≈8–10 tasks / ≈6 / ≈4, modest sizes) | ~$280 | ~$150 | ~$80 |
| ALB + NAT + VPC endpoints | ~$90 | ~$70 | ~$50 |
| S3 + replication + CloudFront (light pre-pilot; grows with events ~4 TB/event) | ~$80 | ~$30 | ~$10 |
| WAF, Secrets, KMS, CloudWatch, Synthetics | ~$90 | ~$50 | ~$20 |
| **Subtotal** | **~$890** | **~$480** | **~$225** |

≈ **$1,600/month** infrastructure pre-pilot, plus per-event S3/transfer growth (a 4 TB event ≈ +$95/mo storage + egress on archive delivery) and PagerDuty/Sentry subscriptions. Not a quote — sizing firms up after P0-E15.

## 4. Verdict

**G0-8: PASS WITH CONDITIONS**

- **C1**: Dedicated-account decision confirmed by Travis (billing/org authority) before `Pmp-Cicd` bootstrap.
- **C2**: This review ratified by Developer 2 when onboarded (PHASE0_GATE reviewer requirement).
- **C3**: Sizing and per-event cost model updated after the pilot-event profile (P0-E15).

No design rework required. CDK implementation may begin when application scaffolding is unblocked by the overall G0 decision (PHASE0_GATE §G0 decision still requires G0-1..G0-7).
