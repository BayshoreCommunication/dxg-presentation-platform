# PROJECT_STATE.md

Last updated: 2026-08-30

## Status
Phase 0, documentation stage. Git repository initialized; no application code. **G0 status: DEFINED, NOT STARTED** — no gate item has been executed; Phase 0 is not complete and production scaffolding is blocked until PHASE0_GATE.md items pass.

## Completed documentation work (2026-08-30)
- Repo baseline: README, AGENTS (separate-product notice), CLAUDE.md, .gitignore, commit/branch conventions
- SRS provenance corrected (FRs/acceptance = agreed baseline; tech = DECISIONS.md; architecture may evolve; functional scope changes need DXG approval)
- WORKFLOW_STATES.md — six decomposed lifecycles (drafted, pending DXG sign-off)
- PHASE0_GATE.md — measurable G0 criteria incl. full Room Agent PoC matrix
- SECURITY_MODEL.md — incl. certified deletion vs S3 versioning/replication, legal holds
- RFPILOT_INTEGRATION.md — boundary rules (no direct DB access; shared IdP proposed)
- TRACEABILITY.md — full FR/NFR/OBJ/module/scenario/acceptance matrix (all rows `planned`)
- PLAN.md — task contract, P0-D infrastructure design, P0-E discovery tasks, G0 review task

## Architecture decisions
- **Accepted**: D-001 (RFPilot stack), D-003 (Postgres-only, Redis transport-only), D-004 (we own states/schema), D-005 (decomposed lifecycles — design), D-006 (no cross-product DB access)
- **Proposed / provisional**: D-002 (Electron Room Agent — until G0-1 PoC passes), shared IdP with RFPilot, deployment strategy (P0-D3)

## Current blockers
1. **Windows/Office test environment unavailable** — G0-1 and G0-2 PoCs need a physical Windows 11 machine + Win10 21H2 VM with Microsoft 365 PowerPoint and multi-monitor hardware. Blocks the Room Agent viability decision.
2. **DXG inputs pending** — see below; blocks G0-4..7.

## Required DXG inputs
- Stakeholder access for interviews and SRR/room workflow observation (P0-E1..E4)
- Windows device + Office fleet profile; multi-monitor configurations (P0-E5/E6)
- Sample agenda XLSX/CSV files; representative deck/media corpus sources (P0-E12/E13)
- Retention, legal-hold, deletion policy confirmation (P0-E14)
- Pilot-event profile (P0-E15)
- Sign-offs: WORKFLOW_STATES.md, role × permission matrix, prototype walkthrough

## Next single task
**P0-D block complete** (D1–D5 in `docs/infra/`: ENVIRONMENTS, DATA_TIER, EDGE_APP_TIER, OBSERVABILITY, INFRA_CI) — all drafted 2026-08-30, awaiting the G0-8 review, which can now be scheduled. P0-C1 (physical schema) complete 2026-08-30: `db/migrations/001–005` — 41 tables covering all SRS §10 entities + WORKFLOW_STATES lifecycles, verified on postgres:16 with RLS-isolation and audit append-only smoke tests. P0-C2 (OpenAPI) complete 2026-08-30: `api/openapi.yaml` covering all SRS §11 areas (auth, events, import, schedule, speakers, comms, portal, files/uploads, inspection, review, SRR, agent, sync, reports, archive, admin, ops, webhooks, integration stub), spectral-linted 0 errors. **All Phase 0 work doable without DXG/Windows inputs is now complete except the G0-8 infra-design review.** Blocked remainder: P0-A/B PoCs (Windows environment), P0-E discovery + sign-offs (DXG). Blocked: P0-A/B PoCs (Windows environment), P0-E discovery (DXG). P0-C5 (DXG input request) still needs Travis to send it.
