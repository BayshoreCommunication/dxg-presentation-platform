# PROJECT_STATE.md

Last updated: 2026-09-17 (second entry below)

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
**P0-D block complete** (D1–D5 in `docs/infra/`: ENVIRONMENTS, DATA_TIER, EDGE_APP_TIER, OBSERVABILITY, INFRA_CI) — all drafted 2026-08-30, awaiting the G0-8 review, which can now be scheduled. P0-C1 (physical schema) complete 2026-08-30: `db/migrations/001–005` — 41 tables covering all SRS §10 entities + WORKFLOW_STATES lifecycles, verified on postgres:16 with RLS-isolation and audit append-only smoke tests. P0-C2 (OpenAPI) complete 2026-08-30: `api/openapi.yaml` covering all SRS §11 areas (auth, events, import, schedule, speakers, comms, portal, files/uploads, inspection, review, SRR, agent, sync, reports, archive, admin, ops, webhooks, integration stub), spectral-linted 0 errors. **G0-8 review complete 2026-08-30: PASS WITH CONDITIONS** (`docs/infra/G0-8_REVIEW.md`; D-007) — all 17 open items decided; C1 resolved same day by D-008. **D-008/D-009: development is local-Docker only for now** — `docker-compose.yml` (postgres:16 with migrations auto-applied on :5434, redis :6380, clamav :3310) verified running 2026-08-30; the Pmp-dev-Bootstrap CDK stack (`deploy/aws/`, synth-verified) stays drafted, NOT deployed, until a shared dev server is needed (≤$100/mo cap applies then; $0 until). Remaining conditions: C2 D2 ratification, C3 re-cost after pilot profile. **All Phase 0 work doable without DXG/Windows inputs is now complete.** Blocked remainder: P0-A/B PoCs (Windows environment), P0-E discovery + sign-offs (DXG). Gate items G0-1..G0-7 remain before the overall G0 decision. **Prototype authority settled 2026-08-30 (D-010)**: `prototype/client-baseline.html` is the explicit design authority (17 screens; `prototype/index.html` now opens it; internal sketch renamed `workflow-study.html`). The 19-step demo is transcribed as `docs/ACCEPTANCE_WALKTHROUGH.md`; visual match rules + the 17-screen side-by-side screenshot approval gate are in `docs/VISUAL_ACCEPTANCE.md` — **frontend scaffolding is blocked until that sheet is approved (P0-E16 / G0-6b)**. Client portal confirmed as a distinct user-facing surface (same Next.js app, role-gated). Enhanced faithful prototype built 2026-08-30 (`prototype/enhanced.html`, artifact 8191a44d…): all 17 baseline screens in the baseline's tokens/fonts/IA with the grafted live behaviors (approve→sync→pending-ack→ack chain verified in browser) and the built-in 19-step demo runner. P0-E16 comparison sheet built 2026-08-30 (`prototype/comparison.html`, artifact c88a6c06…): both prototypes embedded side-by-side with synced navigation, per-screen approve/deviation-notes (persisted), 375px portal toggle, copyable approval summary. NEXT: Travis reviews and approves the 17 rows (then DXG); scaffolding unblocks at 17/17. Awaiting DXG walkthrough feedback. Blocked: P0-A/B PoCs (Windows environment), P0-E discovery (DXG). P0-C5 (DXG input request) still needs Travis to send it.

## 2026-09-15 — Phase 1 planning baseline established

Reviewed `prototype/enhanced.html` (all 17 screens + the 19-step demo runner + grafted behaviours) against the SRS, WORKFLOW_STATES, the physical schema and the Phase 0 OpenAPI, and produced the production build baseline (D-011):

- **`docs/BUILD_SPEC.md`** — implementation contract: assumptions, objective→testable success criteria, the six enforced invariants, pinned stack, repo layout (D-012, npm workspaces), cross-cutting contracts (contracts-first, request lifecycle, idempotency/optimistic locking, error taxonomy, audit chain, SSE, job catalogue, S3 content addressing, launch guard), frontend architecture, Room Agent and sync protocol, the tier-1 inspection check set, NFR budgets as test gates, security, commands, code style, testing strategy, boundaries, open questions.
- **`docs/SCREEN_SPECS.md`** — the 17 screens as build contracts (route, roles, data sources, actions→endpoints/transitions, rules, acceptance criteria) plus the cross-screen behaviours table.
- **`docs/ROADMAP.md`** — M0–M7 with effort in engineer-weeks, four parallel workstreams, an explicit gate table (what is actually blocking), a dependency graph, an eight-item risk register and the ordered next actions.
- **`docs/tasks/M0.md`**, **`docs/tasks/M1.md`** — contract-sized, ready-to-execute tasks.

**Gate reality check (unchanged by this work):** G0-6b (17/17 visual approval) still blocks all frontend scaffolding; G0-1 (PowerPoint PoC) still blocks the Room Agent playback decision and needs Windows/Office hardware; G0-4/5/7 still need DXG inputs and the P0-C5 request. **M0 depends on none of them and can start immediately**; it also closes G0-2 by implementing the sync PoC against the specified protocol.

Highest-leverage open action: approve the 17 comparison rows and send the sheet to DXG — it is the only thing serialising the whole plan.

## 2026-09-17 — M0 started: first production code

Travis asked to start development ahead of the remaining gate items. Built the parts of M0 that
depend on neither the visual-acceptance approval nor Windows hardware (commit `4caffe5`):

- **`packages/domain`** — the transition engine and all six WORKFLOW_STATES lifecycles, plus
  `deriveTalkStatus`/`deriveRoomReadiness`. Pure, no I/O, 51 tests covering every state × action
  pair, role authority, mandatory reasons, audited overrides, and the derived-status truth table.
- **`packages/db`** — `withScope()` (transaction + RLS session variables), idempotent migration
  runner (baselines an entrypoint-applied schema), synthetic seed, hash-chained append-only audit
  with verification.
- **`apps/api`** — Express 5 slice: health, events, talks (status derived in the domain layer),
  the review transition with optimistic locking and role gates, and `audit:verify`.

Verified against Postgres 16 in Docker: approve-before-claim refused with an explanation; stale
`lock_version` → 409; client admin → 403; a reviewer's approval supersedes the prior version,
queues the room, writes the workflow transition, the audit record and two outbox events in one
transaction, and the talk's derived status moves to "Approved — delivering". An UPDATE on
`audit_records` is rejected by the database trigger (I-5 proven at the data layer).

`npm run ci` green. Running instructions: `DEVELOPMENT.md`.

**Doc amendment:** WORKFLOW_STATES §8 now evaluates canceled/archived first (see the note there).

**Still true:** there is no UI — frontend scaffolding remains blocked on the 17-row visual
acceptance (G0-6b), and Room Agent playback remains blocked on G0-1. For client walkthroughs the
artifact is still `prototype/enhanced.html`. Remaining M0 work: M0-1 (contracts package), the rest
of M0-5 (real auth, idempotency store, dispatcher, SSE), M0-6 (sync PoC, closes G0-2), M0-7 (CI).

## 2026-09-17 (later) — four Control Center screens running on the real API

Client demonstration required at short notice; the prototype had already been shown two days
earlier, so the ask was working software. Built (commit `b0769ba`):

- **Portfolio**, **Command center**, **Review & approval**, **Room sync** in `apps/control-center`
  (Next.js), on the live API and database — no browser fixtures.
- Design tokens, primitives, terminology and the full 17-item navigation extracted from the client
  baseline; unbuilt screens appear in the nav but are marked.
- API additions: `/summary`, `/risk-list`, `/review-queue`, `/sync/fleet`, agent heartbeat.
- `npm run demo:reset` restores the walkthrough state; the script is in `DEVELOPMENT.md`.

Verified in the browser: approving the queued talk queues its room, clears the queue, increments
Approved and moves the talk to "Approved — delivering" on the command center.

**Gate consequence (D-013):** this crossed G0-6b. The visual acceptance sheet must now be re-run
against the built app for these four screens; the gate still stands for the other thirteen.

Still open in M0: M0-1 (contracts package), the rest of M0-5 (real OIDC, idempotency store,
dispatcher, SSE — `AutoRefresh` is a stand-in), M0-6 (sync PoC, closes G0-2), M0-7 (CI).
Room Agent playback still blocked on G0-1 hardware.

## 2026-09-17 (third) — speaker portal upload shipped

Added the collection half of the product (commit `2efec3d`): `apps/speaker-portal` (own Next.js
app on :3001, speaker-token auth, no staff code shipped) and `packages/files`.

- **Upload** is genuinely resumable: browser-side SHA-256, part-by-part upload, and a resume that
  asks the server which parts already landed rather than restarting.
- **Pipeline** on completion runs in order — assemble, verify whole-file checksum, scan, store,
  inspect — with the audit record written. `stored` stays unreachable without a clean scan (I-2).
- **Inspection is real parsing**: `packages/files` contains a minimal ZIP/OOXML reader, so slide
  count, slide size vs the room profile, macros, embedded media, QuickTime video against the
  room's H.264 profile, and linked media all come from the file itself. No Office, no dependency.
- Verified end to end on a purpose-built 5 MB .pptx; the uploaded version appears in the staff
  review queue with its findings, and the command center follows.

**Two honest substitutions, documented in `DEVELOPMENT.md`:** storage is local disk behind the
interface the S3 driver implements in M2-2, and the dev scanner is a real scanner with a
one-signature (EICAR) database until the ClamAV worker lands in M2-5. Neither weakens the
invariant: files are scanned, and scan errors fail closed.

Five screens now run on real data: Portfolio, Command center, Review & approval, Room sync,
Speaker portal. Twelve remain prototype-only.

## 2026-09-17 (fourth) — Room Agent room view, and the chain closes

Added screen 15 (`/events/:id/agent/:roomId`) plus the server side it needs: `agentView`,
`syncRoom`, `acknowledge` and the launch guard. The never-silently-replace chain now runs
end to end in the running system: speaker uploads → DXG approves → agent syncs and verifies the
checksum → the copy sits as *update pending ack* while the room keeps playing the approved
version → the room technician acknowledges → the new version becomes current and the previous one
is retained for rollback.

**Three real bugs found and fixed while wiring it** (each now covered):
1. The launch query picked an arbitrary room copy when a room held both an active and a pending
   one — replaced with a LATERAL that prefers active, then acknowledged, then synced.
2. The launch guard was fed `requiresAck: !acknowledged`, which blocked every *first* delivery.
   It only awaits acknowledgment while `synced`. Regression tests added in `invariants.test.ts`.
3. `syncRoom` passed the human actor to machine-only transitions, so every sync transition was
   refused — and because the `Result` was ignored, it failed **silently** while reporting success.
   Sync now acts as the agent and every Result is checked; failures are counted and returned.

Also: authority is now evaluated before the optimistic-lock check, so a forbidden action says so
instead of reporting a conflict.

Six screens now run on real data. Eleven remain prototype-only. `npm run ci` green (62 tests).
