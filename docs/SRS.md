SOFTWARE REQUIREMENTS SPECIFICATION
DXG Presentation Management Platform
Complete MVP SRS | Based on DXG Developer Scope of Work v1.0 Draft
1. Document Control


Document
Software Requirements Specification
Product
DXG Presentation Management Platform
Scope baseline
MVP / Phase 1
Source
DXG Developer Scope of Work, Version 1.0 draft
Primary delivery
Cloud platform + native Windows Room Agent
Status
Draft for DXG review
2. Purpose
This SRS defines the functional, non-functional, security, operational, integration, data, workflow, testing, and acceptance requirements for the DXG Presentation Management Platform. It translates the supplied SOW into an implementation-oriented requirements baseline while preserving the SOW's terminology, priorities, measurable targets, and MVP boundaries.
3. Product Overview
The platform manages the full lifecycle of event presentation files: event setup and agenda import, passwordless speaker collection, automated tier-1 inspection, review and approval, Speaker Ready Room operations, offline-capable Windows room synchronization/playback, reporting, and permission-aware archive/retention.
The business problem is that speakers currently arrive with unreviewed or last-minute files, creating wrong versions, missing fonts, broken media, mis-routing, manual transfers, delays, weak auditability, and slow post-event handover. The proposed platform is intended to reduce those operational risks. fileciteturn0file0L11-L25
4. Goals and Measurable Objectives
ID
Objective
Target
OBJ-1
Reduce onsite USB/last-minute first submissions
≥60% reduction
OBJ-2
Eliminate manual file transfers between machines
≥90% of room files delivered via sync
OBJ-3
Reduce wrong-version incidents
≤1 per event
OBJ-4
Reduce missing files at session start
0 sessions start without local file
OBJ-5
Reduce technician search time
Speaker/talk lookup ≤5 seconds P95 in SRR
OBJ-6
Room synchronization certainty
100% rooms show verifiable readiness 60 min before doors
OBJ-7
Archive preparation time
≤4 hours from event close to client package availability
5. Users and Roles
DXG Platform Admins 
DXG Project Managers
Presentation Managers (DXG)
SRR Technicians
Room Technicians
Content Reviewers (make changes like an assistant to the users)
Client Event Administrators(Overall in charge of the event)
Reviewers with scoped access
Speakers/Moderators using link-based access

Access shall be event-scoped and least-privilege. Client and event isolation is mandatory.
6. System Scope and Modules
ID
Module
MVP Scope
M01
M01 Events
Create, duplicate, settings, branding, deadlines, team assignment.
M02
M02 Import
XLSX/CSV upload, auto-guess column mapping, validation, commit, update-by-key re-import.
M03
M03 Schedule
Rooms, tracks, days, sessions, breaks, panels, slots, moves/cancellations/replacements, holding slides, shared media.
M04
M04 Speakers
Directory, profiles, roles, assignments, notes, accessibility, release permissions, duplicate merge.
M05
M05 Communications
Templates, merge fields, branded headers, batch sends, reminders, delivery/open/click/bounce tracking, per-speaker history.
M06
M06 Speaker Portal
Magic link, one-time-code fallback, talk view, requirements, templates, resumable ≤10 GB upload, replace, status, feedback, messages.
M07
M07 File Management
Allowlist, versions, checksums, originals, final designation, naming, room/session assignment, search/filter, bulk download, duplicates, retention flags.
M08
M08 Automated Inspection
Tier-1 file/content/security checks with severity classification.
M09
M09 Review & Approval
Configurable 19-state workflow, queue, preview, three comment lanes, decisions, override, rollback, history.
M10
M10 SRR Console
Dashboard, check-in, search, preview, replacement, mandatory-scanned USB intake, comparison, sign-off, receipts, attribution, departure.
M11
M11 Windows Room Agent
Room registration, delta sync, offline library, previous versions, change alerts, playback, holding screen, logs, override, reconciliation.
M12
M12 Sync Dashboard
Fleet status, room readiness, force sync, agent logs.
M13
M13 Reporting
Collection, missing, pending, warnings, approvals, last-minute changes, check-ins, sync, launch, communications, archive; CSV.
M14
M14 Archive
Scope filters, approved-finals, exclusions, PDF conversion where allowed, manifest, expiring packages, download logs, retention notices, certified deletion.
M15
M15 Administration
Users, event roles, client grants, append-only hash-chained audit, retention policies, system settings.
7. Functional Requirements
ID
Priority
Requirement
Summary
FR-EVT-001
P1
Event creation
PM creates event with client, venue, dates, rooms, deadlines and branding; event must have ≥1 day and ≥1 room before invitations can send.
FR-EVT-002
P2
Duplicate event
If DXG has a similar event again, they shouldn't have to create everything from scratch.
They can duplicate an existing event's Structure /Settings /Templates .But it should not duplicate actual speaker files or previous statuses.

FR-EVT-003
P2
Holding/shared media
Create holding slides and shared media and assign them to rooms.
FR-IMP-001
P1
Schedule import
Upload XLSX/CSV, auto-map columns, validate, report row-level errors, and commit transactionally only with zero blocking errors.
FR-IMP-002
P1
Re-import
Suppose you imported an Excel file yesterday.
Today the client sends an updated file.
The system should recognize:
"This is the same session, but its time has changed."
Instead of creating another session, it should update the existing session. Match by room+start+title or external ID; show add/update/remove diff before commit; do not create duplicate sessions.
FR-SPK-001
P1
Speaker directory
Create/update profiles, merge duplicates while preserving history.
FR-SPK-002
P1
Assignments/roles
Support one speaker across multiple slots and multiple speakers per slot/panel roles.
FR-SPK-003
P1
Release permissions
Capture per-speaker/talk release permissions driving archive/PDF rules.
FR-COM-001
P1
Communication templates
Admins can create templates with dynamic fields.
FR-COM-002
P1
Reminder scheduler
Configurable event reminder cadence; SOW defaults T-14/T-7/T-2.
FR-COM-003
P1
Delivery tracking
Track delivery/open/click/bounce through webhooks and surface bounce on speaker record.This information should appear in the speaker's communication history.
FR-FILE-001
P1
File allowlist
Allow PPT/PPTX/PDF/KEY/MP4/MOV/JPG/PNG/WAV/MP3 with preflight size/type messaging.
FR-FILE-002
P1
Versioning/checksum
Preserve originals, version every new file, and verify SHA-256.
FR-FILE-003
P1
Resumable upload
The upload limit is up to 10 GB.
If the internet disconnects at 70%: 7 GB uploaded the system should resume instead of starting from zero.
After upload, checksum verification confirms the file is intact.

FR-FILE-004
P2
Duplicate detection
Checksum + filename heuristics; warn without silently blocking.
FR-FILE-005
P1
File search
Role-scoped search/filter and bulk download.
FR-INSP-001
P1
Inspection orchestration
Every version enters inspection before review.
FR-INSP-002
P1
Tier-1 checks
Corruption, password, size/type, aspect ratio/slide size, fonts, linked/missing media, container/codec, macros, external links, malware, metadata, duplicate filename.
FR-INSP-003
P2
Waiver
Suppose the system reports:
⚠️ Missing font but the technician knows this is acceptable. An authorized user can waive that finding. The waiver doesn't disappear—it remains visible and is recorded.

FR-INSP-004
P1
Honest limits
Pass state includes limitations; technician-review state exists.
FR-REV-001
P1
Review queue
Preview + keyboard shortcuts; SLA aging visible; decision identity/timestamp logged.
FR-REV-002
P1
19-state workflow
Configurable subset of 19-state pipeline with legal transitions and role gates.
FR-REV-003
P1
Three comment lanes
Internal, client-visible, speaker-visible; audience lane enforced and audited.
FR-REV-004
P1
Approval/re-approval
New version cannot replace approved room copies until re-approved.
FR-REV-005
P1
Rollback
Restore prior approved version byte-identically and notify affected rooms.
FR-SRR-001
P1
SRR check-in
Search/check-in with time, station, technician and departure capture.
FR-SRR-002
P1
USB ingestion
Mandatory malware scan before library; quarantine on failure; prior approved version preserved.
FR-SRR-003
P1
Version comparison
Show file size, slide and media deltas between versions.
FR-SRR-004
P1
Sign-off
Bind speaker identity, exact version and timestamp; provide printable/emailable receipt.
FR-SYNC-001
P1
Room sync
Delta manifest, resumable, checksum-verified sync per room.
FR-SYNC-002
P1
Change acknowledgment
Approved change produces visible room-technician acknowledgment; launch warns if unacknowledged; previous version retained.
FR-SYNC-003
P1
Offline reconciliation
Queue logs offline, replay on reconnect, deduplicate replay.
FR-AGT-001
P1
Agent registration
Room-code registration + device fingerprint; warn if >1 active agent per room.
FR-AGT-002
P1
Playback
Launch PPTX/PDF/video/image plus branded holding screen; fidelity tests required.
FR-AGT-003
P2
Agent update
Signed auto-update with release channel and rollback-safe updates.
FR-RPT-001
P1
Reporting
Core reports for collection, missing, pending, warnings, approvals, revisions, check-ins, sync, launch, comms, archive; CSV export.
FR-ARCH-001
P1
Archive builder
Permission-aware package with approved-final rule, restricted exclusions, permitted PDF conversion and manifest.
FR-ARCH-002
P1
Archive delivery
Expiring links and download logging.
FR-ARCH-003
P1
Retention/deletion
Pre-expiry notices and certified secure deletion.
FR-ADMIN-001
P1
Users/RBAC
Event-scoped roles and client access grants with permission tests.
FR-ADMIN-002
P1
Audit
Append-only hash-chained audit viewer/export and integrity verification endpoint.
FR-ADMIN-003
P1
Retention policy
Admin CRUD with per-event override.
8. Key End-to-End Workflows
Event setup
PM creates event → configures rooms/dates/deadlines/branding → imports agenda → validates/commits → assigns team.
Speaker collection
Speaker opens scoped magic link → sees talk/deadline/template → uploads resumably → checksum verified → inspection queued.
Inspection/review
Inspection completes → findings classified → reviewer queue → comments/decision → approval or revision → re-upload triggers re-inspection/re-approval.
SRR
Technician searches speaker → checks in → scans USB → imports to new version → compares → accepts with reason if required → speaker signs off → receipt → departure.
Room delivery
Approved set produces delta manifest → room agent syncs/checksums → room readiness derived → changes require acknowledgment → files launch offline → logs reconcile on reconnect.
Archive
PM selects scope → approved finals and permissions applied → restricted files excluded → manifest/package created → expiring link → download logged → retention/deletion lifecycle.
9. Business Rules and State Rules
An approved version is not silently replaced in room copies by a new upload; re-approval is required.
Final onsite version locks further speaker-portal replacement.
Restricted-from-distribution is an orthogonal flag and must affect downstream distribution/archive behavior.
Illegal workflow transitions must be rejected with an explanation.
Overrides require an authorized role and a reason and must be audited.
Unscanned USB files cannot enter the library.
Scan failures use a quarantine path and preserve the prior approved version.
SHA-256 integrity is required for upload, sync and archive inclusion.
Previous room version remains available until event close under the SOW change/rollback rules.
Cross-event access attempts must be blocked, logged and alerted.
10. Data Requirements
Core entities shall include Event, Client, Venue, Room, Track, Day, Session, Slot, Speaker, Speaker Assignment, Communication, File, File Version, Inspection Finding, Workflow State/Transition, Comment, SRR Check-In, USB Ingestion, Sign-Off, Receipt, Room Agent, Sync Manifest, Launch Log, Report, Archive Package, Retention Policy, User/Role, Audit Record.
Physical database schema/DDL and full OpenAPI specification are Phase 0 gate artifacts. The supplied SOW explicitly adopts the Blueprint data model and API requirements. fileciteturn0file0L359-L362
11. API and Integration Requirements
The Node.js (Express + TypeScript) API shall expose versioned endpoint areas covering the platform domains.
APIs shall support pagination, filtering, bulk operations, webhooks, real-time updates where required, idempotency and retry semantics.
Email integration shall provide delivery/open/click/bounce webhooks.
Storage shall use versioned object storage with KMS.
Room Agent communication shall support delta manifests, sync state, acknowledgments and offline reconciliation.
OpenAPI shall be complete for the implemented API surface.
12. Technical Architecture Baseline
The platform adopts a cloud architecture consisting of Next.js front ends, a Node.js (Express + TypeScript) API, PostgreSQL, Redis/queue, S3 versioned storage with KMS, containerized inspection/malware/preview/PDF workers, OIDC authentication, email/webhooks, logging/metrics, Sentry, AWS US hosting, CloudFront, AWS CDK IaC and blue/green deployment. The Windows Room Agent is an Electron (Node/TypeScript) application with PowerPoint COM automation, SQLite, content-addressed cache, MSI and signed auto-update. An onsite edge server is deferred to Phase 2. fileciteturn0file0L240-L246
13. Security and Privacy Requirements
ID
Requirement
NFR-SEC-01
TLS 1.2+ in transit; AES-256/KMS at rest including backups.
NFR-SEC-02
MFA for all DXG roles; speaker tokens single-purpose, revocable and ≤30-day expiry; staff idle timeout 12h/absolute 24h; portal token session 24h.
NFR-SEC-03
RBAC with automated permission regression coverage ≥95% of policy-code branches.
NFR-SEC-04
100% of ingested files scanned before entering any library; quarantine SLA <60s median.
NFR-SEC-05
Signed download URLs ≤15 minutes; archive links ≤7 days.
NFR-SEC-06
Client/event row-level authorization; cross-event attempts logged and alerted.
NFR-SEC-07
Append-only hash-chained audit retained ≥3 years; admin actions 100% covered.
NFR-PRIV-01
Speaker PII limited to operational fields; verified deletion requests honored within 30 days after retention.
14. Performance, Availability, Reliability and Scale
ID
Target
NFR-PERF-01
Control Center P95 TTI <2.5s on broadband; Speaker Portal P95 <2s on 4G.
NFR-PERF-02
≥50 concurrent 1GB uploads without failure; resume success ≥99.5%.
NFR-PERF-03
Sync 1GB to room agent on 50 Mbps ≤5 min; delta manifest response <500ms P95.
NFR-PERF-04
SRR search server-side P95 ≤1s.
NFR-AVL-01
Cloud 99.9% monthly; zero event-day error budget for sync/auth paths; change freeze during active events.
NFR-AVL-02
Offline Agent operates ≥72h fully offline except sync; automatic reconciliation.
NFR-SCAL-01
5 concurrent events / 40 rooms / 2,500 speakers / 4TB per event without degradation beyond targets.
NFR-INT-01
SHA-256 verification on every upload, sync and archive inclusion; zero mismatches tolerated.
NFR-DR-01
DB continuous PITR + daily snapshot; objects cross-region replicated; RPO ≤15min, RTO ≤4h; quarterly restore rehearsal.
NFR-RET-01
Policy-driven secure deletion of object, versions and derivatives with certificate within 24h of expiry.
15. Accessibility and Compatibility
Speaker and Client portals shall meet WCAG 2.1 AA; Control Center core flows shall meet AA.
Supported browsers: latest two versions of Chrome, Edge, Safari and Firefox; Speaker Portal supports iOS/Android mobile browsers.
Room Agent supports Windows 10 21H2+ and Windows 11 with Microsoft 365 PowerPoint, using a version-pinned fidelity matrix.
16. Observability and Operations
Golden signals and agent heartbeat monitoring shall detect room-offline conditions in <5 minutes.
IaC coverage shall be 100%.
Core-domain unit coverage target is ≥80%.
On-call support is required during events; SEV-1 includes any live-event impairment to launch or sync and has a 15-minute response target.
Production is change-frozen during active events; agent stable/event-pinned release channels are required.
17. Testing Requirements
Unit, integration and Playwright E2E testing.
Security: SAST/DAST, dependency scanning, external penetration test before pilot, permission-matrix regression.
Performance: upload stress, sync throughput and SRR search load.
Reliability: network interruption, 72-hour offline soak and conflict injection.
Fidelity: PowerPoint animations, embedded/linked video, fonts, presenter view, 16:9/4:3, PDF and H.264/HEVC/ProRes video matrix.
Malware: EICAR and quarantine drills.
Import: malformed, huge and re-import suites.
Backup/restore rehearsal, UAT and live-event simulation.
18. Mandatory Test Scenarios
Speaker upload while same file is mid-sync: no partial file becomes current.
Two technicians update same presentation: optimistic lock and merge prompt.
Room loses internet: playback unaffected and reconciliation occurs on return.
Corrupted file: technician-review path; never reaches room.
Linked-media deck: warning with slide references.
Post-deadline portal submission: blocked; SRR override path works.
Session changes rooms: files re-route and old room copy becomes obsolete.
Canceled presentation: removed from room lists but retained according to archive rules.
Replacement speaker: assignment transfer preserves file history.
Presentation laptop failure: spare registration and full resync <15 minutes.
Cloud outage during event: agents and SRR local modes follow runbook.
Outdated room file: readiness turns amber and alert fires.
Rollback: prior version restored byte-identically and rooms notified.
19. Deployment and Support
Environments: development, production-parity staging with anonymized fixtures, and production in US.
Room Agent deployment uses signed MSI; silent auto-update is disabled during active events; N/N-1 API compatibility is supported.
Event setup includes agent installation checklist, room-code issuance and pre-doors readiness certification.
Training: technician certification course, client-admin quickstart, speaker one-page guide and short video.
Post-event: archive delivery confirmation, retention scheduling and retrospective feedback.
20. MVP Delivery Plan
Phase 0 Discovery & Technical Validation: 4–6 weeks. Includes stakeholder interviews, workflow documentation, fleet profiling, PowerPoint COM PoC, offline sync PoC, security review, usability prototypes, physical schema and OpenAPI. Gate G0 requires PoCs to pass defined checklists.
Phase 1 MVP: 22–30 weeks (5–7 months). M1 core platform/import/speakers; M2 portal/upload/inspection; M3 review/approval/comms; M4 SRR; M5 Room Agent/sync; M6 archive/reports/admin; M7 hardening/UAT/live simulation/pilot.
Phase 2: operational enhancements. Phase 3: intelligence and automation.
These are SOW ranges, not guarantees; gates G0–G5 are the mechanism for re-baselining. fileciteturn0file0L363-L388
21. Out of Scope — Initial Release
Public self-service subscriptions
Third-party AV-company tenancy
Billing/subscription management
Open marketplace
Full event registration
Abstract management
Attendee mobile apps
Livestreaming
Video editing
Digital signage beyond presentation holding screens
SMS (Phase 2)
Onsite edge server (Phase 2)
AI features (Phase 3)
Non-Windows room agents
Automated slide auto-advance/show control
These exclusions are explicitly identified in the supplied SOW. fileciteturn0file0L82-L86
22. Acceptance and Completion Criteria
Prototype: DXG stakeholders complete the 19-step scripted walkthrough and approve the design/screen inventory with no more than minor revisions.
MVP pilot-ready: all P1 stories accepted; permission and state-machine suites green; live simulation passes with zero SEV-1/2 defects; high pentest findings remediated; runbooks rehearsed.
Pilot success: 0 platform-caused session delays; ≥95% talks flow through platform; 100% rooms certified ready 60 minutes pre-doors; 0 wrong-version incidents; archive delivered ≤4h after close; technician SUS ≥75.
Production-ready: pilot criteria met, post-pilot P1 fixes deployed/reverified, DR restore rehearsed and support/on-call staffed.
Pre-launch defect policy: zero open SEV-1/2; SEV-3 ≤10 with documented workarounds; SEV-4 triaged to backlog. fileciteturn0file0L421-L436
23. Key Risks and Mitigations
Risk
Impact
Mitigation
PowerPoint COM fidelity gaps
High
Phase 0 PoC; pinned Office builds; fidelity regression matrix; PDF fallback.
Venue network unreliability
High
Offline-first agent; pre-event sync; readiness certification; edge server Phase 2.
Cloud outage during live event
High
Agent/SRR local modes; runbook; multi-AZ; event change freeze.
Speaker adoption
Medium
Two-minute UX; reminders; client nudges; SRR safety net.
Large-file upload failures
Medium
Resumable multipart; stress testing; CDN acceleration.
Inspection over-promising
Medium
Tiered severities; technician-review state; honest UI copy.
Scope creep
Medium
Contractual out-of-scope list and change control at gates.
Agent update failure
High
Event-pinned channel; N/N-1 compatibility; staged rollout.
Confidential deck breach
High
KMS, signed links, RBAC tests, pentest and retention controls.
24. Traceability / Development Priority
Priority foundation: Auth + RBAC + audit chain.
Then event/room/session domain and wizard.
Then import/re-import.
Then speaker domain and magic links.
Then resumable upload/versioning/checksums.
Then inspection pipeline.
Then state machine/review/comments.
Then communications.
Then approval/re-approval/rollback.
Then Room Agent/delta sync/offline library.
Then change acknowledgment/room rollback.
Then playback/holding screen/logging.
Then SRR check-in and USB/sign-off.
Then sync fleet/readiness, reports, archive, client views and reconciliation hardening.
Resource Allocation — 2 Developers
Resource
Allocation
Primary Responsibility
Developer 1 — Backend/Full-Stack
100%
Backend, database, APIs, file processing, workflows, integrations
Developer 2 — Frontend/Desktop
100%
Web UI, Speaker Portal, SRR Console, Windows Room Agent
QA
~35–40% during testing phases
Functional, integration, regression, performance testing
DevOps
~10–20%
CI/CD, cloud infrastructure, storage, monitoring, deployment
UI/UX Designer
~10–15% initially
Wireframes, workflows, responsive UI and usability
Project/Product Manager
~15–20%
Requirements, prioritization, stakeholder coordination, UAT

