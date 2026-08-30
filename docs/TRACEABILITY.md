# TRACEABILITY.md — Requirements Traceability Matrix

Status: v0.1 (2026-08-30). Every SRS requirement, objective, module, mandatory scenario, and acceptance criterion maps to design artifact → PLAN task → automated test → manual/UAT evidence. Statuses: `planned` / `in-progress` / `implemented` / `verified`. Owners: **T** = Travis (backend/full-stack), **D2** = Developer 2 (frontend/desktop), **QA**. Test IDs are suite names to be created with the tasks. This file is updated at every task completion (a task is not `verified` until its row is).

## Functional requirements

| Req | Summary | Design artifact | Task | Automated test | Manual/UAT | Status | Owner |
|---|---|---|---|---|---|---|---|
| FR-EVT-001 | Event creation, ≥1 day+room gate | SPEC §2; schema | M1-4 | `events.create.test` | UAT walkthrough step 1 | planned | T |
| FR-EVT-002 | Duplicate event (structure only) | SPEC §2 | M1-4 | `events.duplicate.test` | UAT | planned | T |
| FR-EVT-003 | Holding/shared media | WORKFLOW_STATES §4 | M1-4 | `events.media.test` | room demo | planned | T |
| FR-IMP-001 | Import: map/validate/commit | SPEC §4.6; import design | M1-6 | `import.commit.test` + malformed/huge suites | sample-file UAT | planned | T |
| FR-IMP-002 | Re-import diff/update-by-key | import design | M1-7 | `import.reimport.test` | re-import UAT | planned | T |
| FR-SPK-001 | Directory + merge | schema | M1-8 | `speakers.merge.test` | UAT | planned | T |
| FR-SPK-002 | Multi-slot/panel assignments | schema | M1-8 | `speakers.assign.test` | UAT | planned | T |
| FR-SPK-003 | Release permissions → archive | SECURITY_MODEL §6 | M1-8, M6-2 | `archive.permissions.test` | archive UAT | planned | T |
| FR-COM-001 | Templates + merge fields | SPEC §2 | M3-5 | `comms.templates.test` | UAT | planned | T |
| FR-COM-002 | Reminder cadence T-14/7/2 | SPEC §2 | M3-5 | `comms.reminders.test` | scheduled-send check | planned | T |
| FR-COM-003 | Delivery/open/click/bounce webhooks | SES design (D-004) | M3-5 | `comms.webhooks.test` | SES sandbox drill | planned | T |
| FR-FILE-001 | Allowlist + preflight | SPEC §2 | M2-3 | `files.allowlist.test` | portal UAT | planned | D2 |
| FR-FILE-002 | Versioning/checksum/originals | WORKFLOW_STATES §1 | M2-2 | `files.versioning.test` | — | planned | T |
| FR-FILE-003 | Resumable ≤10 GB upload | upload design | M2-2 | `upload.resume.test` (fault-injected) | 10 GB manual run | planned | T |
| FR-FILE-004 | Duplicate detection warn-only | SPEC §2 | M2-3 | `files.duplicates.test` | — | planned | T |
| FR-FILE-005 | Role-scoped search/filter/bulk download | schema; RLS | M2-6 (new) | `files.search.rls.test` | SRR search UAT | planned | T |
| FR-INSP-001 | Inspection before review | WORKFLOW_STATES §2 | M2-4 | `inspection.orchestration.test` | — | planned | T |
| FR-INSP-002 | Tier-1 check set | inspection design | M2-4 | `inspection.checks.test` per check | corpus run | planned | T |
| FR-INSP-003 | Waiver visible + audited | WORKFLOW_STATES §2 | M2-5 | `inspection.waiver.test` | UAT | planned | T |
| FR-INSP-004 | Honest limits + technician-review | WORKFLOW_STATES §2; UI copy | M2-4, M3-2 | `inspection.states.test` | copy review | planned | D2 |
| FR-REV-001 | Queue, shortcuts, SLA aging | UI design (G0-6) | M3-2 | `review.queue.test` | reviewer UAT | planned | D2 |
| FR-REV-002 | Configurable state pipeline | WORKFLOW_STATES §3/§7 | M3-1 | `workflow.transitions.test` (full matrix) | — | planned | T |
| FR-REV-003 | Three comment lanes enforced | WORKFLOW_STATES; RLS | M3-3 | `comments.lanes.test` | lane-leak UAT | planned | T |
| FR-REV-004 | Re-approval before room replace | WORKFLOW_STATES §3/§4 | M3-4 | `workflow.reapproval.test` | scenario 18.1 | planned | T |
| FR-REV-005 | Byte-identical rollback + notify | WORKFLOW_STATES §3 | M3-4 | `workflow.rollback.test` (byte compare) | scenario 18.13 | planned | T |
| FR-SRR-001 | Check-in/search/departure | SRR design (G0-6) | M4-1 | `srr.checkin.test` | SRR UAT | planned | D2 |
| FR-SRR-002 | USB scan-before-library | SECURITY_MODEL §3 | M4-2 | `srr.usb.quarantine.test` (EICAR) | malware drill | planned | T |
| FR-SRR-003 | Version comparison deltas | SRR design | M4-3 | `srr.compare.test` | UAT | planned | D2 |
| FR-SRR-004 | Sign-off + receipt | schema | M4-3 | `srr.signoff.test` | receipt print/email UAT | planned | D2 |
| FR-SYNC-001 | Delta/resumable/checksum sync | G0-2 PoC; sync design | M5-2 | `sync.delta.test` | pilot rooms | planned | T |
| FR-SYNC-002 | Change acknowledgment + launch warning | WORKFLOW_STATES §4 | M5-2 | `sync.ack.test` | room UAT | planned | D2 |
| FR-SYNC-003 | Offline log replay dedup | G0-2 PoC | M5-4 | `sync.reconcile.test` | 72h soak | planned | T |
| FR-AGT-001 | Registration + fingerprint + dup warn | SECURITY_MODEL §2 | M5-1 | `agent.register.test` | — | planned | D2 |
| FR-AGT-002 | Playback + holding screen | G0-1 PoC | M5-3 | fidelity matrix runs | fidelity demo | planned | D2 |
| FR-AGT-003 | Signed auto-update, channels, rollback | G0-1b design | M5-6 | `agent.update.test` | staged rollout drill | planned | D2 |
| FR-RPT-001 | Core reports + CSV | report design | M6-1 | `reports.*.test` per report | report UAT | planned | T |
| FR-ARCH-001 | Permission-aware archive builder | SECURITY_MODEL §6 | M6-2 | `archive.build.test` | archive UAT | planned | T |
| FR-ARCH-002 | Expiring links + download logs | SECURITY_MODEL §3 | M6-3 | `archive.links.test` | — | planned | T |
| FR-ARCH-003 | Retention notices + certified deletion | SECURITY_MODEL §6 | M6-3 | `retention.delete.test` (incl. S3 versions/replica/derivatives) | deletion-certificate review | planned | T |
| FR-ADMIN-001 | Event-scoped RBAC + client grants | SECURITY_MODEL §1/§8 | M1-2 | permission-matrix suite | — | planned | T |
| FR-ADMIN-002 | Hash-chained audit + verify endpoint | SECURITY_MODEL §5 | M1-3 | `audit.chain.test` (incl. concurrency) | integrity check demo | planned | T |
| FR-ADMIN-003 | Retention policy CRUD + override | schema | M6-4 | `retention.policy.test` | — | planned | T |

## Non-functional requirements

| Req | Summary | Design artifact | Task | Automated test / verification | Status | Owner |
|---|---|---|---|---|---|---|
| NFR-SEC-01 | TLS 1.2+, AES-256/KMS incl. backups | SECURITY_MODEL §7; P0-D | P0-D, M7-3 | cdk-nag rules + config audit | planned | T |
| NFR-SEC-02 | MFA, token/session lifetimes | SECURITY_MODEL §2 | M1-1, M2-1 | `auth.sessions.test` | planned | T |
| NFR-SEC-03 | RBAC regression ≥95% branches | SECURITY_MODEL §8 | M1-2, M7-3 | coverage gate in CI | planned | T |
| NFR-SEC-04 | 100% scan, quarantine <60s median | WORKFLOW_STATES §1 | M2-5 | `scan.sla.test` + metrics | planned | T |
| NFR-SEC-05 | Signed URL ≤15 min / archive ≤7 days | SECURITY_MODEL §3 | M2-2, M6-3 | `urls.expiry.test` | planned | T |
| NFR-SEC-06 | RLS + cross-event alerting | SECURITY_MODEL §1 | M1-2 | `rls.crossevent.test` + alert check | planned | T |
| NFR-SEC-07 | Audit ≥3y, admin 100% | SECURITY_MODEL §5 | M1-3 | audit coverage test | planned | T |
| NFR-PRIV-01 | PII minimization + 30-day deletion | SECURITY_MODEL §6 | M6-3 | `pii.deletion.test` | planned | T |
| NFR-PERF-01 | TTI targets (2.5s / 2s 4G) | frontend perf budget | M7-2 | Lighthouse CI budgets | planned | D2 |
| NFR-PERF-02 | 50×1GB concurrent, resume ≥99.5% | upload design; G0-2 | M7-2 | upload stress harness | planned | T |
| NFR-PERF-03 | 1GB/50Mbps ≤5min; manifest <500ms P95 | G0-2 | M7-2 | sync throughput harness | planned | T |
| NFR-PERF-04 | SRR search P95 ≤1s | schema indexes | M4-1, M7-2 | search load test | planned | T |
| NFR-AVL-01 | 99.9%; event-day zero error budget; freeze | P0-D design | P0-D, M7-4 | alarms + freeze runbook rehearsal | planned | T |
| NFR-AVL-02 | ≥72h offline agent | G0-1 item 14 | M5-4 | 72h soak | planned | D2 |
| NFR-SCAL-01 | 5 events/40 rooms/2500 speakers/4TB | P0-D sizing | M7-2 | load model + stress | planned | T |
| NFR-INT-01 | SHA-256 everywhere, zero mismatch | WORKFLOW_STATES common rules | M2-2, M5-2, M6-2 | checksum tests in each path | planned | T |
| NFR-DR-01 | PITR, cross-region replicas, RPO15m/RTO4h, quarterly rehearsal | P0-D | P0-D, M7-4 | restore rehearsal evidence | planned | T |
| NFR-RET-01 | Certified deletion ≤24h of expiry | SECURITY_MODEL §6 | M6-3 | `retention.sla.test` | planned | T |
| §15 accessibility | WCAG 2.1 AA portals + core flows | G0-6 designs | M7-1 | axe CI + manual audit | planned | D2 |
| §15 compatibility | Browsers matrix; Win 10 21H2+/11; fidelity matrix | G0-1 pins | M7-1 | Playwright matrix + fidelity runs | planned | QA |
| §16 observability | Golden signals, heartbeat <5min detection, IaC 100%, ≥80% core coverage | P0-D | P0-D, M5-5 | alarm tests, coverage gate | planned | T |

## Objectives (OBJ) — instrumentation

Each objective gets a metric emitted by the platform and a report (M6-1) so pilot success (SRS §22) is measurable:

| Obj | Metric instrumentation | Task | Status |
|---|---|---|---|
| OBJ-1 | First-submission channel (portal vs SRR/USB) per talk → collection report | M6-1 | planned |
| OBJ-2 | Delivery method per room file (sync vs manual override) → sync report | M5-5, M6-1 | planned |
| OBJ-3 | Wrong-version incident log (rollbacks + mismatch reports) | M3-4, M6-1 | planned |
| OBJ-4 | Session-start local-file check from agent launch logs | M5-3 | planned |
| OBJ-5 | SRR search latency P95 metric | M4-1 | planned |
| OBJ-6 | Room readiness timestamps vs doors-60min | M5-5 | planned |
| OBJ-7 | Event-close → archive-available duration | M6-2 | planned |

## Modules M01–M15

M01→M1-4/5 · M02→M1-6/7 · M03→M1-5 · M04→M1-8 · M05→M3-5 · M06→M2-1..3 · M07→M2-2/3/6 · M08→M2-4/5 · M09→M3-1..4 · M10→M4-1..3 · M11→M5-1/3/4/6 · M12→M5-5 · M13→M6-1 · M14→M6-2/3 · M15→M1-1/2/3, M6-4. (Client-facing views: role-gated Control Center — see SPEC §2; verified by permission-matrix suite + client-admin UAT.)

## Mandatory test scenarios (SRS §18)

| # | Scenario | Automated | Task |
|---|---|---|---|
| 1 | Upload during sync — no partial file current | `sync.atomicity.test` | M5-2 |
| 2 | Two technicians — optimistic lock + merge prompt | `workflow.optlock.test` + UI e2e | M3-1 |
| 3 | Room offline — playback OK, reconcile on return | 72h soak + `sync.reconcile.test` | M5-4 |
| 4 | Corrupted file — technician-review, never reaches room | `inspection.corrupt.e2e` | M2-4 |
| 5 | Linked media — warning with slide refs | `inspection.linkedmedia.test` | M2-4 |
| 6 | Post-deadline block + SRR override | `portal.deadline.test` | M2-1, M4-2 |
| 7 | Session room change — re-route + obsolete old copy | `schedule.move.e2e` | M1-5, M5-2 |
| 8 | Canceled presentation — removed from rooms, archived per rules | `schedule.cancel.e2e` | M1-5, M6-2 |
| 9 | Replacement speaker — history preserved | `speakers.replace.test` | M1-8 |
| 10 | Spare laptop — re-register + full resync <15min | timed drill | M5-1 (manual evidence) |
| 11 | Cloud outage during event — local modes runbook | game-day drill | M7-4 |
| 12 | Outdated room file — amber + alert | `readiness.stale.test` | M5-5 |
| 13 | Rollback byte-identical + rooms notified | `workflow.rollback.test` | M3-4 |

## Acceptance criteria (SRS §22)

| Criterion | Evidence path | Status |
|---|---|---|
| Prototype: 19-step walkthrough approved | G0-6 | planned |
| MVP pilot-ready: P1 stories, permission+state suites green, live sim zero SEV-1/2, pentest highs fixed, runbooks rehearsed | M7-1..4 | planned |
| Pilot success: 0 delays, ≥95% via platform, 100% rooms ready −60min, 0 wrong-version, archive ≤4h, SUS ≥75 | OBJ instrumentation + pilot report | planned |
| Production-ready: pilot + P1 fixes + DR rehearsal + on-call staffed | M7-4 + ops sign-off | planned |
| Defect policy: 0 SEV-1/2, ≤10 SEV-3 with workarounds | release checklist | planned |

## Explicit coverage checks (audit findings)

Client-portal views (SPEC §2, permission suite) ✓ · file search/filter/bulk download (FR-FILE-005 → new task M2-6) ✓ · honest inspection limits (FR-INSP-004) ✓ · final onsite lock (WORKFLOW_STATES §3 flag; test in `workflow.finallock.test`, task M4-3) ✓ · restricted-from-distribution (flag; `archive.restricted.test`, M6-2) ✓ · signed URL expiry (NFR-SEC-05) ✓ · cross-event alerting (NFR-SEC-06) ✓ · PII deletion (NFR-PRIV-01) ✓ · availability/scale (NFR-AVL/SCAL) ✓ · PITR + cross-region (NFR-DR-01) ✓ · N/N-1 (G0-1b, FR-AGT-003) ✓ · training & support (SRS §19 → task M7-5 added to PLAN) ✓ · OBJ-1..7 instrumentation ✓
