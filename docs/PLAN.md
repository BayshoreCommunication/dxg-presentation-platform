# PLAN.md — Task Breakdown

Working order follows SRS §24 (traceability priority) with Phase 0 risk-retirement first. One task at a time; each task ends with passing tests. Mark tasks `[x]` when done and update PROJECT_STATE.md at milestone boundaries.

## Phase 0 — Discovery & technical validation (gate G0)

### P0-A: PowerPoint-from-Node PoC (highest risk)
- [ ] P0-A1 Minimal Electron app on Windows: open PPTX in PowerPoint slideshow via COM (winax or PowerShell bridge); measure launch reliability
- [ ] P0-A2 Fidelity checks: animations, embedded video, fonts, 16:9 vs 4:3, presenter view, monitor targeting
- [ ] P0-A3 Crash/recovery: kill PowerPoint mid-show, agent detects and recovers; holding-screen fallback
- [ ] P0-A4 Decision record in DECISIONS.md: COM-from-Node vs sidecar helper approach

### P0-B: Offline delta-sync PoC
- [ ] P0-B1 Content-addressed local cache (SQLite index + SHA-256-named files); delta manifest protocol design
- [ ] P0-B2 Resumable, checksum-verified download of a 1 GB file with induced disconnects
- [ ] P0-B3 Offline log queue + replay/dedup on reconnect

### P0-C: Foundation artifacts
- [ ] P0-C1 Physical PostgreSQL schema (DDL + migration files) for all SRS §10 entities
- [ ] P0-C2 OpenAPI surface for the versioned API areas (SRS §11)
- [ ] P0-C3 Repo scaffolding: backend (Express+TS, worker, dispatcher, contracts pipeline), control-center and speaker-portal (Next.js), agent (Electron) — mirroring RFPilot layouts
- [ ] P0-C4 Design the workflow state machine (`docs/WORKFLOW_STATES.md`): states, legal transitions, role gates — present to DXG for sign-off
- [ ] P0-C5 Request from DXG: sample agenda XLSX/CSV files, branding assets, pilot event profile

## Phase 1 — MVP milestones

### M1 Core platform (auth, RBAC, audit, events, import, speakers)
- [ ] M1-1 Auth: OIDC staff login, sessions/timeouts (NFR-SEC-02), MFA
- [ ] M1-2 RBAC: event-scoped roles, client grants, permission middleware + permission-matrix regression tests (NFR-SEC-03)
- [ ] M1-3 Append-only hash-chained audit log + integrity verification endpoint (FR-ADMIN-002)
- [ ] M1-4 Event CRUD + duplication (structure/settings only) + holding/shared media (FR-EVT-001..003)
- [ ] M1-5 Schedule domain: rooms/tracks/days/sessions/slots, moves/cancellations/replacements (M03)
- [ ] M1-6 XLSX/CSV import: auto-mapping, validation, transactional commit (FR-IMP-001)
- [ ] M1-7 Re-import with diff preview and update-by-key (FR-IMP-002)
- [ ] M1-8 Speaker directory, assignments, duplicate merge, release permissions (FR-SPK-001..003)

### M2 Speaker portal, upload, inspection
- [ ] M2-1 Magic links + one-time-code fallback, token lifecycle (M06, NFR-SEC-02)
- [ ] M2-2 Resumable multipart upload ≤10 GB to S3, checksum verification, versioning, originals preserved (FR-FILE-002/003)
- [ ] M2-3 Allowlist/preflight + duplicate detection (FR-FILE-001/004)
- [ ] M2-4 Inspection orchestration worker + tier-1 checks + severity classification (FR-INSP-001/002)
- [ ] M2-5 Malware scanning + quarantine path (NFR-SEC-04); waivers (FR-INSP-003)

### M3 Review, workflow, communications
- [ ] M3-1 Configurable state machine (19-state superset), legal transitions, role gates, illegal-transition rejection (FR-REV-002)
- [ ] M3-2 Review queue with preview, keyboard shortcuts, SLA aging (FR-REV-001)
- [ ] M3-3 Three comment lanes with audience enforcement (FR-REV-003)
- [ ] M3-4 Approval/re-approval + byte-identical rollback + room notifications (FR-REV-004/005)
- [ ] M3-5 Templates, merge fields, batch sends, T-14/7/2 reminders, webhook delivery tracking (M05)

### M4 SRR console
- [ ] M4-1 Check-in/search (P95 ≤1s), station/technician capture (FR-SRR-001)
- [ ] M4-2 Mandatory-scan USB ingestion + quarantine (FR-SRR-002)
- [ ] M4-3 Version comparison, sign-off + receipts (FR-SRR-003/004)

### M5 Room Agent & sync (builds on P0-A/P0-B)
- [ ] M5-1 Agent registration, device fingerprint, duplicate-agent warning (FR-AGT-001)
- [ ] M5-2 Production delta sync + change acknowledgment + previous-version retention (FR-SYNC-001/002)
- [ ] M5-3 Playback + holding screen + launch logging (FR-AGT-002)
- [ ] M5-4 Offline reconciliation (FR-SYNC-003); 72h soak test
- [ ] M5-5 Sync dashboard: fleet status, readiness, force sync (M12)
- [ ] M5-6 Signed MSI + auto-update channels (FR-AGT-003)

### M6 Archive, reports, admin
- [ ] M6-1 Reports + CSV export (FR-RPT-001)
- [ ] M6-2 Permission-aware archive builder, PDF conversion, manifest (FR-ARCH-001)
- [ ] M6-3 Expiring links + download logs + retention/certified deletion (FR-ARCH-002/003, NFR-RET-01)
- [ ] M6-4 Admin: users, retention policies, system settings (M15)

### M7 Hardening
- [ ] M7-1 SRS §18 mandatory test scenarios as automated/E2E suites
- [ ] M7-2 Performance: 50×1GB concurrent uploads, sync throughput, SRR search load
- [ ] M7-3 Security: SAST/DAST, pentest prep, permission regression ≥95%
- [ ] M7-4 DR rehearsal, runbooks, live-event simulation, UAT
