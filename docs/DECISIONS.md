# DECISIONS.md — Durable Architecture Decisions

## D-001 (2026-08-30): Reuse RFPilot stack
Decision: Node.js/TypeScript/Express backend (API + BullMQ worker + outbox dispatcher), Next.js 16 frontends, PostgreSQL/Redis/S3, AWS CDK. Rationale: proven in production for the same client (RFPilot), single team skill set, reusable deployment patterns. Owner: Travis.

## D-002 (2026-08-30): Room Agent in Electron/Node
Decision: The Windows Room Agent will be an Electron (Node/TS) app; PowerPoint control via COM from Node (winax or PowerShell bridge), SQLite + content-addressed cache. Rationale: single-language codebase. Risk: COM fidelity — retired by Phase 0 PoC (P0-A). Fallback: thin local sidecar helper for COM only. Status: pending PoC confirmation.

## D-003 (2026-08-30): PostgreSQL-only domain store (no MongoDB)
Decision: Unlike RFPilot, all domain data lives in PostgreSQL with RLS-based client/event isolation; files in versioned S3; Redis for queues only. Rationale: strongly relational domain (schedule, workflow states, audit chain); simpler operational surface.

## D-004 (2026-08-30): No external Blueprint; we own workflow states and data model
The SRS was generated with Claude Code and the client is tech-agnostic; the "Blueprint data model" and "19-state workflow" it references are not real external documents. We design the state machine (docs/WORKFLOW_STATES.md, Phase 0) and the physical schema ourselves, and present them for client sign-off. Defaults chosen: AWS SES for email, ClamAV for malware scanning.
