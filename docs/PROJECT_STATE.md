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

## 2026-09-17 (fifth) — Speaker Ready Room: dashboard, check-in, USB intake

Screens 11, 12 and 13, plus the shared intake path they needed.

- **`services/ingest.ts`** — the portal and SRR now share one intake function. The order is fixed
  and not configurable: assemble → verify whole-file checksum → scan → store → inspect. `stored`
  stays unreachable without a clean scan whichever door the file came through (I-2).
- **SRR dashboard** — expected arrivals with live derived status, unresolved warnings on versions
  still in review, station occupancy.
- **Check-in** — station and technician captured; sign-off produces a receipt (version, checksum,
  station, technician) and sets `final_locked`.
- **USB intake** — three gated steps. No reason, no acceptance. No clean scan, no comparison and no
  library entry. Acceptance sends the version to re-approval and leaves the room copy alone.
- **Version comparison** is built from what inspection recorded on both versions (slides, embedded
  media, slide size, file size with deltas). The seed now records the same metadata a real ingest
  would, so comparisons are meaningful in development.

Verified end to end: blank reason refused; clean scan compares 42 vs 42 slides and the size delta;
the room keeps `v2 · active` while the USB version sits in `awaiting_review`; sign-off issues a
receipt and the **speaker portal then refuses a replacement** — a rule set in one application and
honoured in another because both read it from the same place.

Nine screens now run on real data. Eight remain prototype-only. `npm run ci` green (62 tests).

## 2026-09-17 (sixth) — Presentation detail and Inspection, and a state-machine gap closed

Screens 6 and 7, plus the actions they carry: waivers, prefilled revision requests, comment lanes
and rollback.

**A real gap in WORKFLOW_STATES surfaced while implementing rollback.** FR-REV-005 restores "a
prior approved version", but that version is `superseded`, which the document defined as fully
terminal — so rollback had nothing to restore *to*, and the first implementation left the talk
reading "Missing" with no copy live in any room. Resolved by one added transition,
`superseded→approved` via `restore`, requiring Presentation Manager or above and a reason, audited
like any other override. `docs/WORKFLOW_STATES.md` §3 records the amendment and why. The restored
version then reaches rooms by the ordinary approval path rather than a second delivery route.

`deriveTalkStatus` also had to learn about rollback: a rolled-back latest version is not "Missing"
when an approved version stands behind it. Three tests pin the behaviour, including the case where
nothing is behind it and "Missing" is correct.

Verified: waiving is refused for a content reviewer by name and refused with a blank reason, and a
waiver stays visible with author and reason; "Request revision (prefilled)" writes the speaker
comment and moves the review state together, and the speaker portal then shows *Needs revision*;
rollback moves v2 to `rolled_back`/`obsolete` and returns v1 to `approved`/`assigned` with its
original checksum.

Eleven screens now run on real data. Six remain prototype-only. `npm run ci` green (68 tests).

## 2026-09-17 (seventh) — Schedule import and Speakers: the front door

Screens 3 and 5. Migration `006` adds `speakers.organization` (additive).

- **`packages/files/sheet.ts`** — .xlsx and .csv parsing with no new dependency: an XLSX is an OOXML
  package, so the ZIP reader written for presentation inspection opens it too. Shared strings,
  inline strings, skipped columns and Excel serial dates are covered by tests.
- **Auto-mapping** matches header synonyms to platform fields (9/9 on the sample agenda), never maps
  two columns to the same field, and leaves unknown columns unmapped rather than guessing.
- **Validation** separates blocking from warning, and offers a room suggestion only for a clear typo
  (edit distance 1–2, never when two rooms are equally close) — a wrong room means the wrong deck in
  the wrong room, so the suggestion is always an explicit action, never applied automatically.
- **Commit** is transactional and all-or-nothing, and re-import matches on (room, start, title) so a
  second import updates instead of duplicating (FR-IMP-002).
- **Speakers**: directory with organization and live status, server-side search, chase list, and
  duplicate detection with a merge that preserves both histories and every assignment.

**A real bug found here:** spreadsheet times were being read as UTC. They are venue wall-clock
times, so every imported session was landing four hours out and no re-import ever matched an
existing session. Now converted through the event's timezone with `zonedToUtc`, DST included, with
tests against known EST/EDT anchors. `updated` was also never being counted — a matched session now
counts as updated only when something actually differs, so an unchanged re-import writes nothing.

Thirteen screens now run on real data. Four remain prototype-only. `npm run ci` green (90 tests).

## 2026-09-17 (eighth) — Archive builder and Client portal: the handover

Screens 10 and 17, closing the post-event half.

- **`packages/files/zipWrite.ts`** — a ZIP writer to match the reader. Entries are stored
  uncompressed because the payload (PPTX/PDF) is already compressed. Round-trip tests read back
  what was written, binary included, and confirm checksums survive.
- **Scope** is approved finals only, and every exclusion is counted with its reason — no approved
  version, restricted, speaker withheld permission, release permission not set. A `pdf_only`
  permission excludes the talk for now rather than shipping the original, because PDF conversion is
  M6-2: the safer reading of a permission that has not been honoured yet.
- **Build** verifies each file's checksum as it packages it and aborts the whole build on a
  mismatch. The manifest records talk, speaker, room, version, checksum, size and approval record.
- **Deliver** issues an expiring link; **download** is refused before delivery and after expiry
  (marking the package expired), and every download is logged with actor and time.
- **Client portal** is a genuinely separate surface: `Shell` renders no staff navigation under
  `/client`, restricted talks are excluded from every count as well as from the package, and the
  API refuses a staff role outright.

Also fixed here: the seed fabricated checksums without writing any bytes, so the archive build hit
a missing object. The seed now writes real content-addressed objects with real digests, and a
missing object is reported as a clean, explained failure instead of a 500.

Fifteen screens now run on real data. Two remain prototype-only: Create event and Communications.
`npm run ci` green (94 tests).

## 2026-09-17 (ninth) — Create event and Communications: all seventeen screens are real

The last two screens of the client baseline.

- **Create event** — four-step wizard. Step 1 commits a draft (a draft sends nothing); timezone and
  date ranges are validated with explanations; activation requires at least one day and one room.
  Duplication copies rooms, tracks, days, settings, branding and templates, and copies no speakers,
  files or communications — verified: 5 rooms, 3 days, 0 speakers, 0 files, 0 comms.
- **Communications** — default templates with merge fields; the audience is resolved at send time,
  not at schedule time, so a reminder never chases someone who uploaded yesterday; each recipient
  gets their own token and link; a batch is idempotent per (recipient, template); bounced addresses
  are excluded with the reason shown; a provider webhook records delivery, open, click and bounce.
- The "no invitations before the event has a day and a room" rule from the baseline is enforced in
  the API, not just as wizard copy.

**All seventeen baseline screens now run on real data.** What remains is depth behind them, and it
is written down honestly in `DEVELOPMENT.md`: PowerPoint playback (G0-1), the S3 driver, ClamAV,
PDF conversion, slide previews, real OIDC, SES sending and webhook signatures, SSE, asset upload.

`npm run ci` green (94 tests).
