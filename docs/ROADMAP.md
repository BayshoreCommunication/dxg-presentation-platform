# ROADMAP.md — Development Roadmap to Production

Status: **v1.0 (2026-09-15)**. Companion to `BUILD_SPEC.md` and `SCREEN_SPECS.md`. Supersedes the Phase-1 section of `PLAN.md` at the planning level; `PLAN.md` remains the milestone checklist and `docs/tasks/M*.md` hold the executable tasks.

Estimates are **engineer-weeks (ew)**, not dates, and assume the team in `BUILD_SPEC.md` §1: 2 full-stack engineers continuously plus 1 Windows engineer (part-time until M5).

Totals: 43 ew across all milestones, of which **35 ew sit on the critical path** (M0→M1→M2→M3→M4→M6→M7, streams A+B). M5 (8 ew, stream C) runs alongside. Two engineers on the critical path — allowing for review, rework and the fact that not every task parallelises — puts the MVP at roughly **22–28 calendar weeks of build time**, plus whatever the gates in §2 cost in waiting. Re-forecast at each milestone exit against actuals rather than trusting this number twice.

---

## 1. Delivery model

Four workstreams run in parallel once M0 lands. Each milestone ends with a review pass and a demo against the prototype.

| Stream | Content | Who |
|---|---|---|
| **A — Platform** | Domain, API, workers, data, security | Full-stack 1+2 |
| **B — Web** | Control Center + Speaker Portal + Client Portal | Full-stack 2 (+1 during UI-heavy milestones) |
| **C — Agent** | Room Agent, sync engine, playback, packaging | Windows engineer |
| **D — Ops** | Infra, CI/CD, observability, runbooks, DR | Full-stack 1, ~15 % time |

Cadence: one task = one commit = one verification command (BUILD_SPEC §17). Milestone review = invariants + scenarios + E2E green, visual acceptance sheet re-run for touched screens, `TRACEABILITY.md` updated, `PROJECT_STATE.md` updated.

---

## 2. Gates — what is actually blocking

`PHASE0_GATE.md` is still open, and the roadmap respects it rather than routing around it.

| Gate | Status | Blocks | Unblocking action |
|---|---|---|---|
| **G0-6b visual acceptance 17/17** | Comparison sheet built; 0/17 approved | **All frontend scaffolding** (stream B) | Travis approves rows in `prototype/comparison.html`, then DXG |
| **G0-1 PowerPoint PoC** | Not started — no Windows/Office environment | Room Agent *decision* (D-002), stream C beyond the sync engine | Acquire Win 11 machine + Win 10 21H2 VM with M365 and dual/triple monitors |
| **G0-2 offline delta-sync PoC** | Not started | Nothing hard — the protocol is specified (BUILD_SPEC §10); do it as M0-6 against the real spec | Run the PoC as the first agent task; it doubles as the sync engine's skeleton |
| **G0-4 discovery** | Blocked on DXG | Fidelity of M1 import, M4 SRR ergonomics, M5 fleet assumptions | Send the P0-C5 input request (still outstanding) |
| **G0-5 permission matrix sign-off** | Draft only | Nothing immediately; must be signed before M7 | Draft in M1-2, circulate at M1 review |
| **G0-7 test corpus** | Not assembled | Realistic inspection + agent testing (M2, M5) | Assemble ≥30 decks + codec matrix; can start now with synthetic + public decks |
| **G0-8 infrastructure** | PASS WITH CONDITIONS (D-007) | Nothing during development (D-008/D-009) | Re-cost after the pilot profile arrives |

**Consequence for sequencing:** stream A (backend/domain) and stream D (local dev infra) are unblocked today. Stream B is blocked on 17/17 approval — which is one reviewing session, and is therefore the single highest-leverage action on this project right now. Stream C's sync half is unblocked; its playback half needs hardware.

---

## 3. Milestones

### M0 — Foundation (4 ew) · stream A + D · **no gate dependency**

Turns the Phase-0 artefacts into a working skeleton that every later task builds on.

| Task | Output |
|---|---|
| M0-1 | Contracts package: move `api/openapi.yaml` to `packages/contracts`, add `operationId`s and entity schemas, wire `contracts:generate`/`contracts:check` |
| M0-2 | Workspace scaffolding: `apps/api|worker|dispatcher`, `packages/domain|db|ui`, tsconfig project refs, ESLint flat config, `npm run ci` |
| M0-3 | Database plumbing: migration runner, RLS session helpers, transactional test harness, seed fixtures (synthetic only) |
| M0-4 | Transition engine + the six lifecycles in `packages/domain` with the full legal/illegal transition test table; derived status implemented from the prototype's `derived()` |
| M0-5 | Request spine: auth stub, permission middleware, idempotency store, outbox write path, dispatcher, audit chain + `:verify`, error taxonomy, SSE stream |
| M0-6 | Sync PoC against the real protocol (§10) — closes G0-2 and becomes the agent's sync engine skeleton |
| M0-7 | Local stack + CI: docker compose wired to the apps, GitHub Actions running `ci` + invariants on every PR |

**Exit:** `npm run ci` green; invariant suites I-5 and I-6 green; a seeded event round-trips through the API; G0-2 evidence filed in `docs/poc/SYNC_POC.md`.

### M1 — Core platform (6 ew) · stream A (+B once unblocked)

Auth/RBAC/audit, events, schedule, import, speakers — screens 1, 2, 3, 5.

M1-1 OIDC staff login, sessions, MFA · M1-2 event-scoped RBAC + permission matrix + regression harness · M1-3 audit log hardening and verification endpoint · M1-4 event CRUD, duplication, branding/holding media · M1-5 schedule domain (rooms, tracks, days, sessions, slots, moves/cancellations/replacements) · M1-6 XLSX/CSV import with auto-mapping, validation, transactional commit · M1-7 re-import diff + update-by-key · M1-8 speaker directory, assignments, merge, release permissions.

**Exit:** an event can be created and populated from a real DXG spreadsheet; permission regression ≥95 % of the matrix; screens 1–3, 5 match their approved baseline rows; I-4 green.

### M2 — Collection and inspection (6 ew) · streams A + B

Speaker portal, uploads, inspection — screens 16, 7 and the file half of 6.

M2-1 magic links + one-time-code fallback and token lifecycle · M2-2 resumable ≤10 GB multipart upload with checksum verification and version creation · M2-3 allowlist/preflight + duplicate detection · M2-4 inspection orchestration + the tier-1 check set (BUILD_SPEC §11) · M2-5 ClamAV scanning, quarantine, waivers · M2-6 role-scoped file search and bulk download · M2-7 slide preview rendering.

**Exit:** a speaker uploads a real 1 GB deck over a flaky connection and it lands verified, scanned, inspected, with findings that name slides; I-2 and I-3 green; upload resume ≥99.5 % over 20 induced disconnects.

### M3 — Review, workflow, communications (5 ew) · streams A + B

Screens 8, 9, 4, 6 (review half).

M3-1 configurable review pipeline with role gates and illegal-transition messages · M3-2 review queue, claiming, SLA aging, keyboard decisions · M3-3 three comment lanes with audience enforcement · M3-4 approval, re-approval, byte-identical rollback, room notification fan-out · M3-5 templates, merge fields, batch sends, T-14/7/2 reminders, SES webhook tracking · M3-6 command center KPIs, risk list, activity feed, SSE.

**Exit:** the approval → room readiness causal chain is visible end to end against a simulated room; comment-lane invariant green; a 348-recipient batch sends and tracks without duplicates.

### M4 — Speaker Ready Room (4 ew) · streams A + B

Screens 11, 12, 13.

M4-1 check-in, search within the OBJ-5 budget, station/technician capture · M4-2 USB ingestion with mandatory scan and quarantine · M4-3 version comparison view · M4-4 sign-off, final lock, receipts (print/email) · M4-5 SRR dashboard (expected arrivals, unresolved warnings, stations).

**Exit:** the walkthrough's steps 11–13 run for real; final lock demonstrably blocks portal replacement; I-1's SRR half green.

### M5 — Room Agent and sync (8 ew) · stream C (+A for the server half) · **needs G0-1**

Screens 14, 15.

M5-1 agent registration, device fingerprint, duplicate-agent handling · M5-2 production delta sync, acknowledgment, previous-version retention · M5-3 playback driver (COM or helper per G0-1), holding screen, launch logging, crash supervision · M5-4 offline reconciliation and the 72-hour soak · M5-5 fleet sync dashboard with force sync and readiness · M5-6 signed MSI, update channels, deferral, rollback.

**Exit:** the full G0-1 matrix passes on both OS targets with evidence; a room survives 72 hours offline and keeps launching; I-1 green end to end including the agent.

### M6 — Archive, reports, admin (4 ew) · streams A + B

Screens 10, 17, admin.

M6-1 reports and CSV exports · M6-2 permission-aware archive builder, PDF conversion, manifest · M6-3 expiring links, download logs, retention and certified deletion with legal holds · M6-4 admin (users, retention policies, settings) · M6-5 client portal surface.

**Exit:** a pilot-sized package builds inside the OBJ-7 budget, excludes restricted content in every format, and the client portal reconciles with staff counts.

### M7 — Hardening, pilot, handover (6 ew) · all streams

M7-1 SRS §18 mandatory scenarios as automated suites · M7-2 performance: 50×1 GB concurrent uploads, sync fan-out, SRR search load · M7-3 security: SAST/DAST, pentest prep, permission regression gate · M7-4 production infrastructure (the G0-8 target design), DR rehearsal, runbooks, on-call · M7-5 live-event simulation + UAT with DXG · M7-6 training package: technician certification, client-admin quickstart, speaker guide and video.

**Exit:** the production-ready definition in `BUILD_SPEC.md` §2 holds in full.

---

## 4. Sequencing and parallelism

```
now ─┬─ M0 Foundation (A+D) ────────────┐
     ├─ G0-6b approval  (Travis→DXG) ───┤ unblocks stream B
     ├─ Windows hardware + G0-1 (C) ────┤ unblocks M5 playback
     └─ DXG inputs request (P0-C5) ─────┘ improves M1/M4/M5 fidelity

M0 ─→ M1 ─→ M2 ─→ M3 ─→ M4 ─→ M6 ─→ M7        (streams A+B, sequential by dependency)
        └────────→ M5 (stream C, parallel from M2 onward; server half lands with M3)
```

Hard dependencies: M1 before everything (identity, events, schedule). M2 before M3 (nothing to review without versions). M3 before M4 and M5 (approval is the input to sync). M3+M4 before M6 (archive needs approved finals and final locks). Everything before M7.

Safe parallelism: agent sync engine (M0-6, M5-1/2) from day one; inspection checks (M2-4) alongside upload (M2-2); communications (M3-5) alongside review (M3-1..4); reports (M6-1) any time after M3.

---

## 5. Risk register

| # | Risk | Impact | Mitigation | Trigger to act |
|---|---|---|---|---|
| R1 | PowerPoint COM automation is unreliable from Node | Room Agent redesign, M5 slips | Driver interface with two implementations from the start; helper-process fallback; G0-1 decides | Any G0-1 matrix item failing twice |
| R2 | Visual acceptance stays unapproved | Stream B cannot start; the whole plan serialises | Escalate — it is one reviewing session; approve internally first, then DXG | Not approved within one week |
| R3 | DXG discovery inputs never arrive | Import mapping, SRR ergonomics and fleet assumptions built on guesses | Build against synthetic fixtures with pluggable mapping; keep an assumptions list in `SPEC.md` §4 | Two weeks without a response after P0-C5 |
| R4 | Large-file performance (10 GB, 50 rooms) | NFR misses late | Performance tests from M2, not M7; content-addressed storage avoids duplicate transfer | Any upload/sync budget missed on a fixture |
| R5 | Offline correctness bugs (the expensive kind) | Wrong version on screen at an event — the failure mode the product exists to prevent | I-1 invariant tests, 72-hour soak, launch guard, holding-screen fallback everywhere | Any test that can produce a non-`active` launch |
| R6 | Scope creep from prototype polish | Milestones stretch | `SCREEN_SPECS.md` acceptance criteria are the scope; extras go to a backlog | Any task touching >5 files or lacking a requirement ID |
| R7 | Windows fleet heterogeneity (Office builds, AV, no admin rights) | Agent installs fail onsite | Fleet profiling (P0-E5) before MSI design; per-room agent health in the fleet dashboard | First failed install on DXG hardware |
| R8 | Single-engineer knowledge silos (agent, infra) | Bus factor | Every milestone review includes a walkthrough by a second engineer; ADRs in `DECISIONS.md` | Any module with one reviewer for two milestones |

---

## 6. Immediate next actions

Ordered by leverage, not by effort:

1. **Approve the 17 visual-acceptance rows** (`prototype/comparison.html`) and send the sheet to DXG — unblocks the entire frontend stream. *Travis.*
2. **Send the P0-C5 DXG input request** (sample agendas, branding, retention policy, pilot profile, fleet profile, stakeholder time). *Travis.*
3. **Procure the Windows/Office test environment** and run G0-1. *Travis + Windows engineer.*
4. **Start M0** — it depends on none of the above. *Stream A.* Tasks are ready in `docs/tasks/M0.md`.
5. **Assemble the test corpus** (G0-7) with synthetic and public decks now; swap in DXG-supplied real-world samples when they arrive.

---

## 7. Review discipline (Addy workflow)

- **Spec before code**: `BUILD_SPEC.md` + `SCREEN_SPECS.md` are the contract; changing behaviour means changing them first.
- **Plan before build**: each milestone is decomposed into `docs/tasks/M<x>.md` *before* its first commit, never during.
- **Small chunks**: one bounded behaviour, ≤5 files, tests written with or before the code, one commit, verification command in the task.
- **Review every milestone**: correctness, readability, architecture, security, performance — plus the invariant suites and the visual sheet.
- **Docs are durable context**: `PROJECT_STATE.md` after every milestone, `DECISIONS.md` for anything durable, `TRACEABILITY.md` rows move from `planned` to `built` with the test that proves it.
