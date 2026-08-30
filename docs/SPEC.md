# SPEC.md — Working Specification

Status: Draft v0.1 (2026-08-30). Baseline: `SRS.md` (client-supplied, authoritative for requirements). This document records our implementation-level interpretation, stack adaptations, and open questions. Requirements themselves are not restated here — reference SRS IDs (FR-*, NFR-*, M01–M15).

## 1. Technology stack

The RFPilot stack (team's proven production pattern for the same client), decided 2026-08-30:

- **API**: Express + TypeScript — versioned REST, webhooks, idempotency; three processes: API, BullMQ worker, outbox dispatcher
- **Room Agent**: Electron (Node/TS) Windows app; PowerPoint control via Node COM bridge (e.g. `winax`) or PowerShell interop; SQLite + content-addressed cache. **High risk — Phase 0 PoC gate.**
- **Frontends**: Next.js 16 + React 19 + Tailwind CSS 4
- **Data**: PostgreSQL (RLS isolation), Redis (queues), versioned S3 + KMS
- **Workers**: containerized inspection/malware/preview/PDF conversion
- **Auth**: OIDC for staff; magic links for speakers
- **Infra**: AWS (CDK IaC), CloudFront, blue/green deploys; RFPilot observability approach

### Room Agent risk note
PowerPoint COM automation from Electron/Node is the least-proven part of the stack. Phase 0 PoC must prove: launch deck in slideshow mode, presenter view handling, monitor targeting, animation/video fidelity, crash recovery, and process supervision over 72h offline operation. Fallback if COM-from-Node proves unstable: a thin local helper (PowerShell script or small compiled sidecar) invoked by the Electron agent — decision recorded in DECISIONS.md after PoC.

## 2. Applications

1. **Control Center** (Next.js) — DXG staff: events, import, schedule, speakers, comms, files, review queue, SRR console, sync dashboard, reports, archive, admin. (Mirrors RFPilot dashboard/admin split only if needed; start as one app with role gates.)
2. **Speaker Portal** (Next.js) — magic-link access, mobile-friendly, resumable ≤10 GB uploads.
3. **Backend** (Express) — versioned REST API + WebSocket/SSE, BullMQ workers (inspection, malware scan, preview/PDF conversion, email, archive build), outbox dispatcher.
4. **Room Agent** (Electron, Windows 10 21H2+/11) — registration, delta sync, offline library, playback, holding screen, log reconciliation, signed auto-update.

## 3. Data model (entities from SRS §10)

PostgreSQL-only for domain data (no MongoDB — unlike RFPilot, there is no document-store need here; files live in S3, metadata in Postgres). Row-level client/event isolation via RLS, following RFPilot's tenant-RLS pattern.

Core aggregates: Client, Event (rooms/tracks/days/sessions/slots), Speaker (+assignments, release permissions), Communication (+delivery events), File/FileVersion (+checksums, inspection findings, workflow state), SRR records (check-in, USB ingestion, sign-off, receipt), RoomAgent (+sync manifests, launch logs), ArchivePackage, RetentionPolicy, User/Role, AuditRecord (append-only hash chain).

Physical schema DDL is a Phase 0 deliverable (SRS gate artifact).

## 4. Open questions

Context (2026-08-30): the SRS was generated with Claude Code; the client is tech-agnostic and there is no external "Blueprint" document. References to the Blueprint data model and the 19-state pipeline are ours to define — we design them and get client sign-off, rather than waiting for source documents.

**We define (client sign-off later):**
1. Workflow state machine — we design the full state pipeline (target ~19 states covering: draft → submitted → inspecting → inspection-passed/warnings/failed → technician-review → in-review → changes-requested → resubmitted → approved → re-approval-required → final-onsite-locked → room-delivered → acknowledged → launched → obsolete → quarantined → withdrawn/canceled → archived), legal transitions, and role gates. Deliverable: `docs/WORKFLOW_STATES.md` in Phase 0.
2. Data model — designed by us in Phase 0 (P0-C1); SRS §10 entity list is the checklist.
3. Email provider — default **AWS SES** (fits AWS stack; delivery/bounce/complaint events via SNS webhooks; open/click via configuration sets) unless a reason for SendGrid emerges.
4. Malware scanning — default **ClamAV containerized** worker for MVP.
5. OIDC — default: same IdP approach as RFPilot staff auth; confirm with DXG onboarding needs.

**Need from DXG (operational, not technical):**
6. Sample agenda XLSX/CSV files for import mapping (FR-IMP-001/002).
7. Branding assets for portals/holding screens.
8. Pilot event profile (rooms, speakers, file mix) for performance sizing.

## 5. Non-negotiable invariants (see CLAUDE.md "Key domain rules")

Approval/re-approval before room replacement; scanned-only library; SHA-256 everywhere; event-scoped RBAC + cross-event alerting; hash-chained audit; explicit-audited overrides.

## 6. Phasing

- **Phase 0 (gate G0)**: PowerPoint-from-Node PoC, offline delta-sync PoC, physical schema, OpenAPI surface, security review, usability prototypes.
- **Phase 1 (MVP)**: M1 core platform/import/speakers → M2 portal/upload/inspection → M3 review/comms → M4 SRR → M5 agent/sync → M6 archive/reports/admin → M7 hardening/UAT/pilot.
- Out of scope: SRS §21 list (no billing, registration, livestream, SMS, edge server, AI features, non-Windows agents).
