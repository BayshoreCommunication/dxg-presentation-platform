# INFRA_CI.md — Infrastructure CI/CD Design (P0-D5)

Status: Draft v0.1 (2026-08-30) for G0-8 review. Scope: CI/CD for the CDK app and the deploy pipeline's quality gates. Builds on ENVIRONMENTS.md (stack layout, RFPilot lessons), EDGE_APP_TIER.md §4–5 (deployment strategy, event-freeze gate). Completes gate item G0-8's CI requirements: `cdk synth --strict`, cdk-nag, type checking, infrastructure tests, `cdk diff` review before deployment, drift detection.

## 1. Repository layout

CDK app lives in this repo at `deploy/aws/` (RFPilot convention): `bin/` (app entry, env wiring), `lib/` (one file per stack: `cicd`, `network`, `data`, `app`, `agent`, `observability`, plus `config.ts` for per-env settings), `test/` (infra tests). TypeScript, same lint/type-check discipline as the backend. All environment-specific values flow from `config.ts` + GitHub environment variables — **never from ad-hoc CLI context** (the RFPilot Network-stack context lesson: partial context at synth can silently drop listener SG rules).

## 2. CI on every PR touching `deploy/aws/`

Ordered, fail-fast:

1. `npm run lint` + `tsc --noEmit` (type checking)
2. **`cdk synth --strict`** for every environment — synth of all stacks with full context; warnings are errors
3. **cdk-nag** (`AwsSolutions` pack) run against the synthesized assemblies; suppressions only via code annotations with a written justification and are reviewed like code
4. **Infrastructure tests** (CDK assertions on the synthesized templates), minimum suite:
   - Data stack: RDS MultiAZ=true (staging/prod), storage encrypted with the env CMK, deletion protection, backup retention ≥14d, PITR on
   - S3: every bucket versioned, SSE-KMS, Block Public Access, TLS-only policy; library/archive/audit have replication config; multipart-abort lifecycle rule present
   - Network: ALB ingress restricted to CloudFront prefix list; **port-443 listener + SG rule present whenever the cert context is set** (regression test for the RFPilot 2026-08-10 outage class)
   - App: no task role with `*` actions; api/web services have CodeDeploy blue/green deployment group; workers have circuit breaker + rollback enabled
   - Stateful stacks: termination protection true, RemovalPolicy RETAIN on RDS/KMS/buckets/secrets
   - Tag policy: `product/env/stack/owner/costcenter` on every taggable resource
5. **`cdk diff` posted to the PR** as a comment per environment (against the deployed state, read-only role). Reviewer must see the diff before approving — a PR whose diff step failed cannot merge.

## 3. Deploy pipelines

GitHub Actions, OIDC-only auth (no stored keys), environment-locked roles (`Pmp-Cicd`), mirroring the RFPilot pattern:

- **development**: on merge to `main` → synth/tests → `cdk deploy --exclusively` changed stacks → smoke checks.
- **staging**: on merge to `main` after dev succeeds → full app image build + Trivy scan → migration task → `cdk deploy --exclusively Pmp-staging-App Pmp-staging-Agent Pmp-staging-Observability` → smoke + synthetics pass.
- **production**: push to `production` branch only → **event-freeze gate first** (EDGE_APP_TIER §5) → required reviewer approval on the GitHub `production` environment → same sequence with blue/green bake.
- **Network/Data changes** deploy via a separate manually-triggered workflow with a mandatory fresh `cdk diff` output attached to the run and second-person approval — never bundled silently into app deploys. Rules inherited as policy: never remove `--exclusively`; no manual `cdk deploy/diff` on Network/Data outside CI context; first App deploy of a new environment is manual.

## 4. Drift detection

- Nightly scheduled workflow: `cloudformation detect-stack-drift` on all stacks per environment + a read-only `cdk diff`; any drift or diff → notify lane alarm with the drift detail; drift on Data/Network → page lane during event windows.
- Drift is remediated by code (import or revert), never by hand-editing resources; console write access in prod is restricted to break-glass roles.

## 5. Rollback

- App tier: CodeDeploy shift-back / previous task definition (EDGE_APP_TIER §4), one-command runbook.
- Infra: revert the IaC commit and redeploy; for stateful stacks, rollback plans are written in the PR description **before** merge (what happens to data if this change reverts) — required by PR template for `deploy/aws/data-stack` changes.

## 6. Bootstrap & new-environment runbook

Documented in `deploy/aws/README.md` when the CDK app is scaffolded: account bootstrap (`cdk bootstrap` with the CI qualifier), stack-order deploy (Network → Data → App/Agent → Observability), the manual first App deploy, secret seeding checklist, and the deletion procedure incl. the RETAIN-leftover pass.

## 7. Open items for G0-8

1. cdk-nag pack additions (HIPAA/NIST packs are overkill; confirm AwsSolutions suffices for the pentest posture).
2. Whether staging auto-deploys on every `main` merge or batches daily (start per-merge; batch if noisy).
3. Read-only diff role scope for PR comments (needs DescribeStacks + GetTemplate only).
