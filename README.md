# DXG Presentation Management Platform

Event presentation lifecycle platform for DXG: agenda import, passwordless speaker file collection, automated inspection, review/approval, Speaker Ready Room operations, offline-capable Windows room playback, reporting, and permission-aware archive.

**This is a separate product from RFPilot.** It lives in the same workspace and reuses RFPilot's stack and conventions, but has its own repository, lifecycle, and requirements. See `AGENTS.md` before doing any agent-driven work here.

## Status

Phase 0 (discovery & technical validation). No application code yet — documentation and gate definition in progress. See `docs/PROJECT_STATE.md`.

## Stack

Node.js/TypeScript throughout: Express API (+ BullMQ worker, outbox dispatcher), Next.js 16 frontends, PostgreSQL (RLS), Redis, versioned S3 + KMS, Electron Windows Room Agent, AWS CDK. Rationale and status of each decision: `docs/DECISIONS.md`.

## Documentation map

| Doc | Purpose |
|---|---|
| `docs/SRS.md` | Requirements baseline (functional requirements & acceptance criteria agreed with DXG) |
| `docs/SPEC.md` | Working spec: interpretation, stack, open questions |
| `docs/PLAN.md` | Task breakdown and working order |
| `docs/WORKFLOW_STATES.md` | Domain lifecycles/state machines |
| `docs/PHASE0_GATE.md` | Measurable G0 acceptance criteria |
| `docs/SECURITY_MODEL.md` | Security architecture |
| `docs/RFPILOT_INTEGRATION.md` | Boundary with RFPilot |
| `docs/TRACEABILITY.md` | Requirement → design → task → test matrix |
| `docs/DECISIONS.md` | Durable decisions (accepted vs proposed) |
| `docs/PROJECT_STATE.md` | Current status, blockers, next task |

## Commit and branch conventions

- `main` is the integration branch. Feature work on short-lived branches `feat/<task-id>-<slug>` (e.g. `feat/m1-3-audit-chain`), docs on `docs/<slug>` or directly on `main` while pre-scaffolding.
- One task = one commit (or a small series); commit after tests pass. Message format: `<area>: <imperative summary>` with the PLAN task ID and requirement IDs in the body, e.g. `audit: add hash-chained audit append path (M1-3, FR-ADMIN-002)`.
- Never commit `.env`, secrets, or real client/event content.
