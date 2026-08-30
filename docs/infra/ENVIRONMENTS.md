# ENVIRONMENTS.md — Environment Plan & Stack Layout (P0-D1)

Status: Draft v0.1 (2026-08-30) for G0-8 review. Scope: environments, account layout, and CDK stack decomposition only. Excluded (later P0-D tasks): data-tier design (P0-D2), edge/app tier and deployment strategy (P0-D3), observability detail (P0-D4), infra CI (P0-D5).

## 1. Environments

Three environments, per SRS §19. Unlike RFPilot's current single-environment posture, **staging is permanent here** — this platform runs live events with a zero event-day error budget (NFR-AVL-01), so every change must be provable on production-parity infrastructure before it ships, and a change frozen during one event must be rehearsable somewhere.

| Environment | Purpose | Parity | Data |
|---|---|---|---|
| `development` | Day-to-day integration; PR previews of the API | Reduced sizing (single-AZ DB permitted **only here**) | Synthetic fixtures only |
| `staging` | Production parity: release rehearsal, live-event simulation (M7-4), agent event-pinned channel testing, DR/restore rehearsals, performance runs | Full parity: Multi-AZ, same stack shapes, same alarm set, smaller instance sizes where load allows | **Anonymized fixtures** (SRS §19); never real speaker PII or client decks |
| `production` | Live events | Full redundancy from day one — **explicitly do not copy RFPilot's temporary reduced-redundancy production configuration** (its staging deletion and RETAIN-cleanup lessons are inherited as policy below) | Real data; change-frozen during active events |

Local development runs services via docker compose (Postgres/Redis/ClamAV), as in RFPilot; not an AWS environment.

## 2. Account and region layout

- **AWS account**: dedicated account for this product (proposed; alternative is the existing DXG account with strict tag/stack separation — decide at G0-8 review with billing input). Either way: **no shared stacks, buckets, queues, or databases with RFPilot** (D-006 extends to infrastructure).
- **Primary region**: single US region (SRS §12: AWS US hosting) — `us-east-2` proposed, matching team operational familiarity. **DR region**: second US region (`us-east-1`) receiving S3 cross-region replication and backup copies (NFR-DR-01); no warm compute in DR for MVP.
- All environments in the same account use environment-prefixed stacks and isolated VPCs; no cross-environment references.

## 3. CDK stack decomposition (per environment)

Follows the proven RFPilot four-stack split plus a shared CICD stack, with additions this product needs. Prefix: `Pmp-<env>-*` (presentation management platform).

| Stack | Contents | Statefulness |
|---|---|---|
| `Pmp-Cicd` (one per account) | ECR repos (immutable `sha-<commit>` tags), GitHub OIDC deploy roles (branch/environment-locked, no stored keys) | stateful (retain) |
| `Pmp-<env>-Network` | VPC (2+ AZs), subnets, NAT, ALB + listeners/SGs, WAF association, VPC endpoints (S3, ECR, Secrets Manager, CloudWatch) | mostly stateless |
| `Pmp-<env>-Data` | RDS PostgreSQL (Multi-AZ outside dev), ElastiCache Redis, S3 buckets (uploads/library, derivatives, archive, replica config), KMS keys, Secrets Manager secrets | **stateful — termination protection ON, RemovalPolicy RETAIN** |
| `Pmp-<env>-App` | ECS Fargate services: `api`, `worker` (inspection/preview/PDF/archive), `dispatcher`, `cron`, `clamav`; task definitions, autoscaling, CloudFront distributions (Control Center/Speaker Portal if not on Vercel-equivalent, plus download CDN) | stateless |
| `Pmp-<env>-Agent` | Agent-facing surface: agent API target group/routes, agent update distribution bucket + CloudFront, device-credential registry resources | mixed (update bucket retained) |
| `Pmp-<env>-Observability` | Dashboards, alarms (golden signals, agent heartbeat, queue backlog, outbox age), log groups, Sentry wiring, SNS/paging | stateless |

Deploy order: Network → Data → App/Agent → Observability. Known RFPilot lessons codified as rules:
- Listener SG rules materialize in the **Network** stack at synth time — any cert/listener context change requires a Network redeploy with full context (the 2026-08-10 RFPilot outage class). CI always deploys with complete context; manual `cdk deploy`/`diff` without CI's context flags is prohibited on Network/Data.
- Never remove `--exclusively` from CI deploy commands.
- First App deploy of a new environment is manual (migration task needs the App task definition to exist).
- Stack deletion procedure must include the RETAIN-leftover pass (RDS, KMS, buckets, secrets) — tracked in the runbook, as RFPilot's staging removal required.

## 4. Environment isolation rules

- One VPC per environment; no peering between environments.
- Per-environment KMS keys and secrets (`pmp/<env>/...`); IAM roles scoped per environment; deploy roles cannot cross environments.
- Production deploys only from the `production` branch via CI; staging from `main`; development may deploy from PR branches.
- **Event freeze**: production deploys are blocked while any event is active (enforced as a CI gate reading the platform's own event calendar via API — design detail in P0-D5) with a break-glass override requiring Platform Admin approval + reason (audited).

## 5. Naming and tagging

- Stacks/resources: `pmp-<env>-<component>`; hyphens only (no em dashes per workspace convention).
- Mandatory tags: `product=pmp`, `env`, `stack`, `owner`, `costcenter` — cost separation from RFPilot is a hard requirement if sharing an account.

## 6. Open items for G0-8 review

1. Dedicated account vs shared DXG account (billing/org input needed).
2. Region confirmation (`us-east-2` primary / `us-east-1` DR).
3. Frontend hosting: CloudFront+S3/Fargate SSR vs managed platform — affects App stack contents.
4. Whether the Agent surface warrants its own stack or folds into App (kept separate here for event-pinned rollout independence).
