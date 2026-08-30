# EDGE_APP_TIER.md — Edge & Application Tier (P0-D3)

Status: Draft v0.1 (2026-08-30) for G0-8 review. Scope: WAF/CloudFront, frontend hosting, ECS services and worker scaling, deployment + rollback strategy (closes the deployment-design item left open in SPEC §1), event-freeze enforcement, termination protection. Excluded: alarms/dashboards detail (P0-D4), CI mechanics (P0-D5).

## 1. Edge

- **CloudFront distributions** (per env):
  1. `app` — Control Center + Speaker Portal (see §2) + API (`/api/*` behavior forwarded to ALB, no caching). Single distribution keeps one TLS surface and lets the WAF cover UI + API together.
  2. `downloads` — signed-URL file delivery accelerated via CloudFront with origin access control to the library/archive buckets; honors the ≤15 min / ≤7 day signed-URL policies (NFR-SEC-05). Upload acceleration for the 10 GB resumable path uses S3 Transfer Acceleration (decision test in G0-2: measure vs plain multipart from a venue-like connection).
  3. `agent-dist` — agent installer/update channel (Agent stack).
- **WAF** (on `app`): AWS managed core rule set + known-bad-inputs + IP reputation; rate-based rules per IP on auth endpoints and magic-link resolution (credential/token brute-force); size constraints exempting the upload endpoints. Speaker portal endpoints get stricter rate limits than staff endpoints. WAF logs to the access-logs bucket.
- ALB behind CloudFront: HTTPS only, security group admits CloudFront prefix list only (no direct-to-ALB bypass of WAF).

## 2. Frontend hosting (proposal for the G0-8 open item)

**Next.js apps run as ECS Fargate services behind the ALB** (SSR), fronted by CloudFront — not on Vercel. Rationale: SRS §12 mandates AWS US hosting; the event change freeze must cover the whole serving path; WAF/audit/logging stay uniform; and speaker-upload flows keep same-origin simplicity. Static assets served via CloudFront with immutable cache headers. (Vercel remains fine for the RFPilot products; this platform's event-day posture argues for one controllable stack.)

## 3. ECS services (Pmp-<env>-App)

| Service | Role | Scaling |
|---|---|---|
| `api` | Express REST + WebSocket/SSE | Target-tracking on CPU + ALB RequestCount; min 2 tasks (AZ-spread) in staging/prod |
| `web-control` / `web-portal` | Next.js SSR | Target-tracking CPU; min 2 in prod |
| `worker-inspect` | Inspection, preview, PDF conversion | **Queue-depth scaling** (BullMQ waiting count via custom metric): 1→N, N capped by DB/S3 pressure; scale-in slow (finish jobs) |
| `worker-scan` | ClamAV + scan orchestration | Queue-depth scaling; sized to hold the <60s median quarantine SLA (NFR-SEC-04) at 50 concurrent uploads |
| `worker-archive` | Archive build, retention/deletion | Queue-depth, low priority |
| `dispatcher` | Outbox → Redis | Fixed 1 (singleton semantics), restart-on-failure |
| `cron` | Reminders, retention sweeps, readiness recomputation | Fixed 1 |

Workers are separate services (not one process) so inspection load can't starve malware scanning, and each has its own scaling signal. All tasks: no public IPs, egress via NAT, per-service IAM roles scoped to their S3 prefixes/queues.

## 4. Deployment & rollback strategy (decision)

**Chosen: ECS blue/green via CodeDeploy for `api` and the two web services; rolling-with-circuit-breaker for workers/dispatcher/cron.**

- Blue/green on the request-serving services gives: pre-shift health validation on the green target group, near-instant rollback (shift listeners back), and a bake window with automatic rollback on alarm (5xx rate, target health). This satisfies the SRS's blue/green intent where it matters — the user-facing, event-critical path.
- Workers are queue consumers: rolling deploy with ECS deployment circuit breaker + automatic rollback is sufficient (jobs are idempotent; a bad task version fails health checks and rolls back). No listener to shift.
- **Database migrations decouple from deploys**: expand/contract pattern — migrations are always backward-compatible one release back (mirrors agent N/N-1 policy); a one-off migration task runs before service roll (RFPilot pattern), never during an active event.
- **Rollback**: listener shift-back (request services) or previous task definition (workers), both one command in the runbook; images are immutable `sha-<commit>` so rollback targets are exact. Agent-facing API keeps N/N-1 compatibility so a platform rollback never strands newer agents.

## 5. Event-freeze enforcement (design)

- CI deploy job's first step calls `GET /api/v1/ops/deploy-gate` on the target environment: returns `frozen` if any event on that platform instance is within its freeze window (doors−24h until event close, configurable per event). Frozen → pipeline stops.
- **Break-glass**: manual pipeline input `override_reason` + a required approval from a Platform Admin GitHub environment reviewer; the override reason is posted to the platform's audit chain via the same ops endpoint (SRS §9: overrides audited).
- The gate service itself is part of `api`; if the gate is unreachable, deploys are blocked (fail closed) except for the documented cold-start path.
- Agent auto-update deferral during events is separate but analogous (event-pinned channel, G0-1b).

## 6. Protection & hygiene

- Termination protection ON for Data and Cicd stacks (stateful); App/Network/Observability deletable only via runbook order with the RETAIN-leftover pass (ENVIRONMENTS.md §3).
- Deletion protection ON for the ALB and RDS; ECR repos immutable-tag, scan-on-push (Trivy also in CI).
- All service configs from Secrets Manager/SSM at task start — no baked secrets (SECURITY_MODEL §7).

## 7. Open items for G0-8

1. S3 Transfer Acceleration vs plain multipart for uploads — measure in G0-2.
2. WebSocket scale-out approach for `api` (ALB sticky vs Redis-adapter fan-out) — spike in M1.
3. Whether `web-control`/`web-portal` share one Next.js service initially (SPEC §2 says one app role-gated; deploy as one service until portal traffic argues otherwise).
