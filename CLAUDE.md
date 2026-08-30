# CLAUDE.md — DXG Presentation Management Platform

Guidance for Claude Code working in this project. This project lives inside the RFPilot workspace (`~/Desktop/rfp`) and deliberately reuses RFPilot's stack, conventions, and documentation discipline. It is a separate product for the same client (DXG). Not yet a git repository (git will be added later).

## Stack

- **Backend**: Node.js + TypeScript + Express (RFPilot pattern: API process + BullMQ worker + outbox dispatcher)
- **Data**: PostgreSQL (primary, with RLS for client/event isolation), Redis (queues/cache), private S3 (versioned file storage, KMS)
- **Frontends**: Next.js 16 + React 19 + Tailwind CSS 4 (Control Center, Speaker Portal, Client Portal)
- **Room Agent**: Electron (Node/TypeScript) Windows app. Drives PowerPoint via COM automation from Node (Phase 0 PoC required). SQLite + content-addressed local cache, offline-first.
- **Contracts**: backend `src/contracts/` as source of truth, generated types for frontends (`contracts:generate` / `contracts:check`), same as RFPilot
- **Testing**: backend `node:test`; frontends Jest (jsdom); Playwright E2E
- **Infra**: AWS (CDK), following RFPilot deployment patterns

## Workflow (Addy Osmani spec-first workflow)

1. Spec before code — `docs/SPEC.md` is the working spec; `docs/SRS.md` is the requirements baseline (edit only to keep it aligned with agreed scope/stack; requirement changes need client agreement).
2. Plan — `docs/PLAN.md` breaks work into small, verifiable tasks with dependency order. Work top to bottom.
3. Build in small chunks — one task at a time; run tests after each task; commit per task once git exists.
4. Review — every milestone gets a review pass before moving on.
5. Update `docs/PROJECT_STATE.md` when status, commitments, or priorities change; durable decisions go in `docs/DECISIONS.md`.

## Documentation

- `docs/SRS.md` — client SRS (read-only baseline)
- `docs/SPEC.md` — working spec: stack adaptations, resolved ambiguities, open questions
- `docs/PLAN.md` — task breakdown and current position
- `docs/DECISIONS.md` — durable architecture decisions
- `docs/PROJECT_STATE.md` — implementation status

## Key domain rules (from SRS — never violate)

- An approved version is never silently replaced in room copies; re-approval required.
- Unscanned USB files cannot enter the library; scan failures quarantine and preserve the prior approved version.
- SHA-256 integrity on every upload, sync, and archive inclusion.
- Cross-event access must be blocked, logged, and alerted (event-scoped, least-privilege RBAC).
- Audit log is append-only and hash-chained.
- Illegal workflow-state transitions are rejected with explanation; overrides need an authorized role + reason and are audited.

## Conventions

- Follow RFPilot conventions (see `../CLAUDE.md` and `../dxg-rfp-tool-backend/docs/`): ESLint `--max-warnings=0`, `type-check`, ordered SQL migrations, `.env` never committed.
- No real client/event content in fixtures.
