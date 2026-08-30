# DECISIONS.md — Durable Architecture Decisions

## D-001 (2026-08-30): Reuse RFPilot stack — Status: ACCEPTED
Decision: Node.js/TypeScript/Express backend (API + BullMQ worker + outbox dispatcher), Next.js 16 frontends, PostgreSQL/Redis/S3, AWS CDK. Rationale: proven in production for the same client (RFPilot), single team skill set, reusable deployment patterns. Owner: Travis.

## D-002 (2026-08-30): Room Agent in Electron/Node — Status: PROPOSED (provisional until G0-1 PoC passes)
Decision: The Windows Room Agent will be an Electron (Node/TS) app; PowerPoint control via COM from Node (winax or PowerShell bridge), SQLite + content-addressed cache. Rationale: single-language codebase. Risk: COM fidelity — retired by Phase 0 PoC (P0-A). Fallback: thin local sidecar helper for COM only.

## D-003 (2026-08-30): PostgreSQL-only domain store (no MongoDB) — Status: ACCEPTED
Decision: Unlike RFPilot, all domain data lives in PostgreSQL with RLS-based client/event isolation; files in versioned S3; Redis strictly for BullMQ job transport (recoverable from outbox); no authoritative state or caching layer in Redis unless a future decision adds one. Rationale: strongly relational domain (schedule, workflow states, audit chain); simpler operational surface.

## D-004 (2026-08-30): No external Blueprint; we own workflow states and data model — Status: ACCEPTED (state machine itself pending DXG sign-off)
The SRS was generated with Claude Code and the client is tech-agnostic; the "Blueprint data model" and "19-state workflow" it references are not real external documents. We design the state machine (docs/WORKFLOW_STATES.md, Phase 0) and the physical schema ourselves, and present them for client sign-off. Defaults chosen: AWS SES for email, ClamAV for malware scanning.

## D-005 (2026-08-30): Six decomposed lifecycles instead of one state field — Status: ACCEPTED (design), pending DXG sign-off on WORKFLOW_STATES.md
The "19-state workflow" is implemented as six independent lifecycles (processing, inspection, review, per-room sync, session, archive) with orthogonal flags (final lock, restricted-from-distribution). See docs/WORKFLOW_STATES.md.

## D-006 (2026-08-30): No direct DB access across the RFPilot boundary — Status: ACCEPTED (permanent)
All RFPilot integration is via versioned APIs/events only; shared OIDC IdP for staff SSO is PROPOSED. See docs/RFPILOT_INTEGRATION.md.
