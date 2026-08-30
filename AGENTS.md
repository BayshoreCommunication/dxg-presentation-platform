# AGENTS.md — DXG Presentation Management Platform

**This is NOT RFPilot.** This directory is a separate product with its own repository, requirements, and plan. The parent workspace (`~/Desktop/rfp`) contains RFPilot's `AGENTS.md`, `CLAUDE.md`, task lists, and run scripts — **do not follow RFPilot task instructions, backlogs, or deploy procedures for work in this directory.** RFPilot repos are reference material for conventions only (see `docs/RFPILOT_INTEGRATION.md` for the product boundary).

## Ground rules for agents

1. Read `CLAUDE.md`, then `docs/PROJECT_STATE.md` (current position and blockers), then the relevant task in `docs/PLAN.md`.
2. Work one PLAN task at a time. A task ends with its verification command passing and one commit (see README conventions).
3. Requirements provenance: `docs/SRS.md` functional requirements and acceptance criteria are the agreed baseline — functional scope changes require DXG approval. Technology/architecture choices are ours and live in `docs/DECISIONS.md`; propose changes there, don't rewrite requirements.
4. State machines are defined in `docs/WORKFLOW_STATES.md` — never invent states or transitions ad hoc.
5. Security invariants in `CLAUDE.md` ("Key domain rules") and `docs/SECURITY_MODEL.md` are non-negotiable.
6. No direct database access to/from RFPilot systems, ever (see `docs/RFPILOT_INTEGRATION.md`).
7. Update `docs/PROJECT_STATE.md` when status, blockers, or priorities change; durable decisions go to `docs/DECISIONS.md`.
8. Do not mark Phase 0 complete or scaffold production applications until `docs/PHASE0_GATE.md` criteria are met and documents are internally consistent.
