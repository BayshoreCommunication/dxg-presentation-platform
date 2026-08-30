# DEV_BOOTSTRAP.md — Development-Phase Infrastructure (≤$100/month)

Status: Decided 2026-08-30 (D-008); **amended by D-009: not deployed yet.** Development currently runs entirely in local Docker (`docker-compose.yml` at repo root — postgres with auto-applied migrations on port 5434, redis on 6380, clamav on 3310). This document's single-server plan activates only when a shared dev server becomes necessary; until then AWS cost is $0. While the platform has 0 users and is in development, we run **one server in the existing RFPilot AWS account** (295229565954, us-east-2) with a hard budget cap of **$100/month**. The five infra design docs (ENVIRONMENTS, DATA_TIER, EDGE_APP_TIER, OBSERVABILITY, INFRA_CI) remain the **pilot/production target** — nothing in them is built until the project approaches pilot; they are not deleted or weakened, just deferred.

## 1. What we run now

| Resource | Choice | Est. cost/mo |
|---|---|---|
| 1× EC2 instance | `t4g.medium` (2 vCPU / 4 GiB, arm64), public subnet in the account's default/dev VPC, 50 GiB gp3 | ~$27 + ~$4 disk |
| Runtime | Docker Compose on the instance: `api`, `worker`, `dispatcher`, `cron`, `postgres:16`, `redis`, `clamav` — same process shapes as production, one box | — |
| S3 | 1 bucket `pmp-dev-storage` (versioned, SSE-S3, Block Public Access, 7-day multipart-abort rule); prefixes stand in for the six-bucket layout | ~$3–10 |
| TLS/ingress | Caddy (or nginx + certbot) on the instance; Elastic IP; no ALB, no NAT, no CloudFront, no WAF | ~$0–4 |
| Backups | Nightly `pg_dump` + config to S3 (14-day expiry lifecycle); EBS snapshot weekly | ~$2 |
| Monitoring | CloudWatch agent basics + one billing alarm at **$80** (warning) and **$100** (alert) scoped to `product=pmp` tags; Sentry free tier | ~$3 |
| **Total** | | **~$45–60/mo** — comfortable headroom under $100 |

Scale-up path inside the cap: `t4g.large` (~$55/mo) if the box strains before pilot.

## 2. Rules for living in the RFPilot account

- **Tag everything** `product=pmp` (cost separation is mandatory — RFPilot billing must stay clean; use a cost-allocation tag + budget filter).
- **Touch nothing RFPilot**: no shared security groups, roles, buckets, or stacks; the D-006 no-cross-product rule applies inside the account too. New IAM roles/users are `pmp-*` prefixed.
- No changes to `Rfpilot-*` stacks, ever, from this project's tooling.
- The dev instance is provisioned by the `Pmp-dev-Bootstrap` CDK stack (`deploy/aws/`, drafted 2026-08-30, synth-verified): own tiny VPC (1 AZ public, no NAT), t4g.medium AL2023 arm64 with encrypted 50 GiB gp3 (`deleteOnTermination: false`), no SSH ingress (SSM Session Manager only), docker + compose via user data, versioned `pmp-dev-storage-<acct>` bucket (RETAIN), EIP, and a $100 monthly budget with alerts at $80/$100 filtered on `product=pmp`. Deploy: `cd deploy/aws && npm i && npx cdk deploy --profile rfpilot` (account is pinned to 295229565954/us-east-2 in code). One-time manual steps: activate the `product` cost-allocation tag in Billing; after boot, clone the repo onto the box via SSM and `docker compose up` (no deploy key is baked into user data).

## 3. What is explicitly deferred (and its trigger)

| Deferred | Comes back when |
|---|---|
| Three environments, Multi-AZ RDS, ElastiCache, ALB/WAF/CloudFront, cross-region replication, PITR-grade backups, blue/green, PagerDuty, Synthetics | **Pilot preparation** (M7 planning at the latest; ideally when the first real event date is set) — the SRS NFRs (99.9%, RPO/RTO, event-day error budget) bind at pilot, not during 0-user development |
| Full CI infra gates (cdk-nag, drift detection) | With the first multi-stack CDK work at pilot prep; lint/type/test CI runs from day one regardless |
| Dedicated AWS account (was G0-8 C1 recommendation) | Overridden by decision D-008: shared RFPilot account. Revisit only if DXG requires billing/tenancy separation at pilot |

Dev-phase security still non-negotiable: Block Public Access on the bucket, no secrets in the repo (Secrets Manager or instance-local `.env` outside git), SSH via key + IP allowlist (or SSM Session Manager, preferred), Postgres/Redis bound to localhost/compose network only.

## 4. Interaction with tests and PoCs

- The G0-2 offline-sync PoC syncs against this box (bandwidth shaping client-side).
- Performance NFRs (50×1GB uploads, etc.) are **not** testable on this box and are not expected to be — they belong to pilot-prep infrastructure (M7-2).
- Local development remains docker compose on dev machines; the server is the shared integration target.
