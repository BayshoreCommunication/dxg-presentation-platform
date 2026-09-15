# BUILD_SPEC.md — Production Build Specification

Status: **v1.0 (2026-09-15)** — the implementation contract for turning `prototype/enhanced.html` into the production product.
Owner: Travis. Reviewer: second developer. DXG approval: not required for this document (it is implementation detail); functional scope changes still require DXG approval per `CLAUDE.md`.

## 0. How this document relates to the others

| Document | Role | This doc's relationship |
|---|---|---|
| `docs/SRS.md` | Requirements baseline (FR/NFR/OBJ/M01–M15) — agreed with DXG | Referenced by ID, never restated |
| `docs/SPEC.md` | Working spec: interpretation, stack rationale, open questions | Still valid; this doc supersedes it wherever they overlap on *implementation* detail |
| `docs/WORKFLOW_STATES.md` | Six domain lifecycles + derived status | Normative. Implemented literally by `packages/domain` |
| `docs/SECURITY_MODEL.md` | Security architecture | Normative |
| `prototype/client-baseline.html` | UI design authority (D-010) | Normative for visual language |
| `prototype/enhanced.html` | Behavioural reference build (baseline IA + live behaviours) | Normative for *behaviour*; §8 and `SCREEN_SPECS.md` transcribe it into contracts |
| `db/migrations/001–005` | Physical schema | Normative; extended only by new ordered migrations |
| `api/openapi.yaml` | API surface | Normative shape; M0 elaborates it into a typed, generation-ready contract |
| `docs/SCREEN_SPECS.md` | Per-screen build contracts (17 screens) | Companion to this document |
| `docs/ROADMAP.md` | Sequenced delivery plan | Companion to this document |

## 1. Assumptions

These are assumptions, not agreements. Correct any of them and this spec changes.

1. **Team**: 2 full-stack engineers continuously + 1 Windows/Electron engineer for the Room Agent workstream (part-time until M5, full-time during M5). Estimates in `ROADMAP.md` are engineer-weeks, not calendar dates.
2. **First production use is a pilot event**, not a full DXG season. Pilot profile (rooms/speakers/file mix) is still an open DXG input (P0-E15).
3. **Single repository, npm workspaces** (D-012, below) rather than RFPilot's four-repo layout — this product ships a backend, two web apps, a desktop agent and shared contracts that must version together.
4. **PowerPoint control ships as an out-of-process helper by default.** COM-from-Node in-process (D-002) remains the preferred option, but the architecture is written so the playback driver is an interface with two implementations; the G0-1 PoC picks the default, not the architecture.
5. **The client portal is role-gated inside the Control Center app** (SPEC §2), with its own layout shell and no staff chrome.
6. **No AI/ML features in MVP** (SRS §21 out-of-scope stands), including no automated content/design judgement — inspection is deterministic checks only.
7. **Blue/green and multi-AZ infrastructure binds at pilot**, not during development; development stays local Docker (D-009).

## 2. Objective and success criteria

Build the product the prototype demonstrates: the full lifecycle of event presentation files — event setup, agenda import, passwordless speaker collection, automated inspection, review/approval, Speaker Ready Room operations, offline-capable Windows room playback, reporting, and permission-aware archive.

Success is measured by the SRS objectives, restated as testable system conditions:

| Objective | Testable condition (verified in M7) |
|---|---|
| OBJ-1 ≥60% fewer onsite first submissions | Pilot report: share of talks whose first version arrived via portal ≥ agreed baseline; instrumented by `file_versions.source` |
| OBJ-2 ≥90% of room files delivered by sync | Pilot report: `room_files` delivered via agent sync ÷ all room files ≥ 0.90 |
| OBJ-3 ≤1 wrong-version incident per event | No room ever plays a non-`active` copy; enforced by the never-silently-replace invariant + launch guard (§6.9) |
| OBJ-4 0 sessions start without a local file | Room readiness endpoint reports every upcoming slot as `Ready` 60 min before doors; alarm otherwise |
| OBJ-5 lookup ≤5 s P95 in SRR | SRR search endpoint P95 ≤1 s server-side (NFR-PERF-04 headroom), measured under the M7 load test |
| OBJ-6 100% verifiable room readiness at doors−60 | Fleet readiness view computed from `room_files` + agent heartbeat freshness; no manual attestation path exists |
| OBJ-7 archive ≤4 h from close | Archive build job completes and delivers an expiring link within 4 h for a pilot-sized package; measured in M6 |

**Definition of "production-ready" for this project** (all must hold at the M7 exit):
- Every FR in `TRACEABILITY.md` maps to shipped code and at least one automated test.
- The 19-step acceptance walkthrough (`ACCEPTANCE_WALKTHROUGH.md`) runs green as an automated E2E suite.
- The SRS §18 mandatory scenarios run as automated tests.
- All six invariants in §3 are enforced by code with tests that prove each violation is rejected.
- Visual acceptance sheet re-run against the built app, 17/17 approved (`VISUAL_ACCEPTANCE.md` §3).
- DR rehearsal, runbooks and on-call complete; pilot-event simulation passed.

## 3. Non-negotiable invariants

Every one of these has a dedicated test file; any PR that touches the relevant module must keep them green.

| # | Invariant | Enforcement point | Test |
|---|---|---|---|
| I-1 | An approved room copy is never silently replaced; a new version reaches a room only after it independently reaches `approved`, and post-delivery changes require room-technician acknowledgment | `domain/roomSync` transition guard + manifest builder | `tests/invariants/never-silently-replace.test.ts` |
| I-2 | Unscanned files never enter the library; scan errors fail closed to `quarantined`, and the previously approved version stays active | `domain/processing` transition table (`stored` unreachable without `scanning`) | `tests/invariants/scan-gate.test.ts` |
| I-3 | SHA-256 integrity on every upload, sync and archive inclusion; no partial file is ever visible | Upload completion, agent verify, archive manifest | `tests/invariants/checksum.test.ts` |
| I-4 | Cross-event access is blocked, logged and alerted | RLS + permission middleware + `security.cross_event_attempt` audit event | `tests/invariants/rls-isolation.test.ts` |
| I-5 | The audit log is append-only and hash-chained | DB trigger (no UPDATE/DELETE) + chain builder + `/admin/audit:verify` | `tests/invariants/audit-chain.test.ts` |
| I-6 | Illegal transitions are rejected with an explanation; overrides require an authorized role + reason and are audited | `domain/transition` engine | `tests/invariants/illegal-transitions.test.ts` |

## 4. Tech stack (pinned)

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript 5.x, `strict: true` everywhere | No `any` in domain code; `unknown` + parse at boundaries |
| Runtime | Node.js 22 LTS | Pin in `.nvmrc` and Docker images |
| API | Express 5 + TypeScript | Three processes: `api`, `worker` (BullMQ), `dispatcher` (outbox) — RFPilot pattern |
| DB | PostgreSQL 16, RLS-isolated | `db/migrations/*.sql`, ordered, forward-only |
| Queue | Redis 7 + BullMQ | Transport only; never authoritative (D-003) |
| Object store | S3, versioned + KMS | Content-addressed keys (§6.8) |
| Frontends | Next.js 16 (App Router) + React 19 + Tailwind CSS 4 | Two apps: `control-center`, `speaker-portal` |
| Desktop | Electron + TypeScript, SQLite (better-sqlite3) | Windows 10 21H2+ / 11 |
| Auth | OIDC (staff, MFA enforced), hashed recipient-bound tokens (speakers), signed device credentials (agents) | §13 |
| Email | AWS SES + SNS event webhooks | D-004 |
| Malware | ClamAV container worker | D-004; fail-closed |
| Office inspection | Deterministic parsers (OOXML zip/XML inspection); no Office on servers | §11 |
| Infra | AWS CDK (us-east-2 primary, us-east-1 DR) | Local Docker during development (D-009) |
| Tests | `node:test` (backend, agent), Jest + Testing Library (web), Playwright (E2E) | RFPilot convention |
| Lint | ESLint flat config, `--max-warnings=0` | |

## 5. Repository layout (D-012 — proposed)

Single repo, npm workspaces. Shared code is a real package, not copy-paste.

```
dxg-presentation-platform/
├── apps/
│   ├── api/                  Express API process (routes, controllers, http concerns only)
│   ├── worker/               BullMQ job processors (inspection, scan, preview, email, archive, sync-manifest)
│   ├── dispatcher/           Outbox dispatcher process
│   ├── control-center/       Next.js — staff screens 1–15 + client portal (screen 17), role-gated
│   ├── speaker-portal/       Next.js — screen 16, token auth only, no staff code shipped
│   └── room-agent/           Electron Windows app (main, renderer, playback driver, sync engine)
├── packages/
│   ├── contracts/            OpenAPI source of truth + generated TS types (contracts:generate/check)
│   ├── domain/               Pure domain logic: transition engine, 6 lifecycles, derived status, manifest diff
│   ├── db/                   Migration runner, typed query helpers, RLS session helpers
│   └── ui/                   Design tokens (from the baseline) + shared primitives used by both web apps
├── db/migrations/            Ordered SQL (existing 001–005 + new)
├── api/openapi.yaml          Moves to packages/contracts/openapi.yaml in M0-1
├── deploy/aws/               CDK
├── docs/                     This documentation set
├── prototype/                Design + behaviour authority (read-only reference)
└── tests/
    ├── invariants/           The six invariant suites (§3)
    ├── scenarios/            SRS §18 mandatory scenarios
    └── e2e/                  Playwright: the 19-step walkthrough + per-screen regression
```

Rules:
- `packages/domain` imports nothing from `apps/*` and has no I/O. It is the only place state machines live.
- `apps/api` contains no business rules — it authenticates, authorises, validates, calls a service, maps errors.
- The derived presentation status (WORKFLOW_STATES §8) exists **once**, in `packages/domain`, and is used by the API, both web apps and reports. The prototype's `derived()` function is its specification.

## 6. Cross-cutting engineering contracts

### 6.1 Contracts-first
`packages/contracts/openapi.yaml` is the source of truth. `npm run contracts:generate` emits request/response types consumed by API handlers and both web apps; `contracts:check` fails CI on drift. Every endpoint needs an `operationId` and a real schema before its milestone starts (M0-1 closes the current gap: the Phase 0 OpenAPI has paths but no operationIds or entity schemas).

### 6.2 Request lifecycle (every authenticated staff request)
```
authenticate (OIDC session)
  → resolve event scope from the route
  → authorise (role × permission matrix; deny ⇒ 403 + audit `security.denied`, cross-event ⇒ alert)
  → open a transaction and SET LOCAL app.user_id / app.client_id / app.event_id  (RLS)
  → validate the body against the generated contract type
  → call the service (services orchestrate; domain decides)
  → domain transition (validates from-state, role, reason) → row update with lock_version bump
  → append audit record (same transaction)
  → enqueue side effects via the outbox (same transaction)
  → commit → dispatcher publishes → worker acts
```
No side effect is ever fired inside the request path. Anything that emails, syncs, scans, converts or notifies goes through the outbox.

### 6.3 Idempotency and optimistic locking
- Every mutating endpoint accepts `Idempotency-Key` (UUID). Keys are stored in `idempotency_keys` with the response snapshot; replay returns the stored result. Scope: (key, endpoint, actor).
- Every transition body carries `lock_version`. Mismatch ⇒ `409` with `current_state` and the current version, so the UI can show the "another technician changed this" merge prompt (SRS §18).

### 6.4 Error taxonomy
Single `Error` shape (`code`, `message`, `detail`, `current_state`). Codes are stable strings, namespaced by domain: `review.illegal_transition`, `file.scan_required`, `sync.not_acknowledged`, `auth.event_scope_denied`, `import.blocking_errors`. Illegal transitions return `422` with a human-readable `message` that names the current state and the allowed actions — the UI shows that message verbatim (SRS §9).

### 6.5 Audit chain
`audit_records` is append-only (no UPDATE/DELETE grants + trigger). Each row stores `prev_hash` and `hash = sha256(canonical_json(record_without_hash) || prev_hash)`, chained per event. `/admin/audit:verify` walks the chain and reports the first break. Exports go to Object-Lock (governance, 3 y) storage per D-007.

### 6.6 Realtime
The prototype's live statuses (command center, room sync, review queue, agent alerts) are delivered by **SSE** per event scope: `GET /api/v1/events/{eventId}/stream`. Event names mirror outbox topics: `file_version.state_changed`, `room_file.state_changed`, `agent.heartbeat`, `import.progress`, `archive.progress`. Clients reconcile by refetching the affected resource — the stream carries IDs and versions, never authoritative payloads. Room Agents do not use SSE; they poll the delta manifest (§10) so offline behaviour is identical online and offline.

### 6.7 Jobs catalogue (BullMQ, all idempotent, all with dead-letter + alarm)
`scan.file_version` · `inspect.file_version` · `preview.render_slides` · `convert.pdf` · `email.send_batch` · `sync.rebuild_manifest` · `archive.build_package` · `retention.sweep` · `reports.export`.

### 6.8 File storage
`s3://<library-bucket>/<client_id>/<event_id>/<sha256>` — content-addressed, so identical bytes are stored once and duplicate detection (FR-FILE-004) is a lookup. `file_versions.s3_key` points at it; originals are never mutated or overwritten. Derived artefacts (previews, PDFs, archive zips) live under `derived/` with their own lifecycle and retention. Bucket is versioned, KMS-encrypted, public access blocked; all downloads are short-lived presigned URLs, logged.

### 6.9 Launch guard
An agent may only launch a file whose `room_files` row is `active` **and** acknowledged when acknowledgment was required. Any other launch attempt is refused locally with the holding screen and reported; the agent never resolves "closest matching file".

## 7. Frontend architecture

- **Design tokens** are extracted from `prototype/client-baseline.html` into `packages/ui/tokens.css` (colours, type scale, radii, spacing). The palette in `enhanced.html` `:root` is the canonical starting set. No component may hardcode a colour.
- **Terminology is fixed** by `VISUAL_ACCEPTANCE.md` §2 — "Command center", "USB intake", "Update pending ack", etc. Copy lives in one module per app so wording changes are one-line.
- **Routing** (control-center): `/` portfolio · `/events/new` · `/events/[id]/import` · `/events/[id]` command center · `/events/[id]/speakers` · `/events/[id]/talks/[slotId]` detail · `/events/[id]/talks/[slotId]/inspection` · `/events/[id]/review` · `/events/[id]/comms` · `/events/[id]/archive` · `/events/[id]/srr` · `/events/[id]/srr/checkin/[checkinId]` · `/events/[id]/srr/intake/[checkinId]` · `/events/[id]/sync` · `/client/[eventId]` (client shell). Speaker portal: `/t/[token]` → `/portal/talks/[slotId]`.
- **Data**: server components for first paint of read-heavy screens; a typed fetch client (generated types) for mutations; SSE subscription per event for live statuses. No global client store beyond the SSE-driven cache invalidation.
- **Role gating** is enforced server-side; the UI additionally hides actions the session cannot perform, and every action button carries the permission it requires so the gate and the button cannot drift.
- **State coverage is mandatory**: every screen implements loading, empty, error, permission-denied, and (where the prototype shows one) offline/degraded. `VISUAL_ACCEPTANCE.md` §2.7 is the checklist.
- **Accessibility**: WCAG 2.1 AA. Keyboard paths for the review queue (`A` approve / `R` request revision) are part of the contract, with visible focus rings and an accessible announcement of the decision. A11y wins over pixel-match where they conflict (logged as a deviation).
- **Responsive**: speaker portal and client portal are verified at 375×812; staff screens at 1440×900 minimum with graceful degradation to 1024.

## 8. Screen contracts

The 17 screens are specified individually in `docs/SCREEN_SPECS.md`: purpose, route, roles, data sources, actions → endpoint/transition, derived statuses, required states, and acceptance criteria. That document is the direct translation of `prototype/enhanced.html` into build contracts and is normative for behaviour.

## 9. Room Agent

- **Shape**: Electron main process (supervisor, sync engine, scheduler, IPC) + renderer (the dark room view of screen 15) + a **playback driver interface** with two implementations: in-process COM (`winax`) and an out-of-process helper. The driver is selected by config; G0-1 evidence sets the default.
- **Local store**: SQLite (`library`, `manifest`, `launch_log`, `outbox`) + a content-addressed file cache keyed by SHA-256, identical to the server layout, so verification is a hash compare.
- **Offline-first**: every agent operation works with the network down. Network loss pauses updates, never playback (prototype, screen 14 copy). Logs queue locally and replay deduplicated by `(agent_id, local_seq)`.
- **Supervision**: PowerPoint crash detected ≤5 s → relaunch or holding screen ≤10 s; agent crash → supervisor restart with state recovery; no orphaned COM processes (G0-1 items 9–11, 15).
- **Updates**: signed MSI, `stable` and `event_pinned` channels, deferral during an active event, rollback to previous version, N/N-1 API compatibility (G0-1b).
- **Security**: device credential issued at registration, rotated; the agent can read only its room's manifest; a duplicate registration for a room raises a warning and requires an operator decision (FR-AGT-001).

## 10. Sync protocol

```
GET  /agent/manifest?room_id&since=<manifest_version>
  → { manifest_version, files:[{file_version_id, sha256, size, slot_id, requires_ack, superseded_sha256}], removals:[...] }
POST /agent/manifest/{id}:applied   { applied:[{file_version_id, sha256}], failures:[...] }
POST /agent/heartbeat               { library_complete, free_bytes, agent_version, pending_updates }
POST /agent/logs                    { entries:[{local_seq, kind, at, detail}] }
```
Rules: downloads are resumable byte-range with per-chunk verification; a file becomes visible to playback only after a full-file SHA-256 match (I-3); `requires_ack` files land as `synced` and stay invisible to the "current copy" pointer until a room technician acknowledges (I-1); the previous approved version is retained locally until event close for byte-identical rollback; manifest responses are P95 <500 ms; 1 GB on 50 Mbps ≤5 min; resume success ≥99.5 % (NFR-PERF-02/03, G0-2 thresholds).

## 11. Inspection engine (tier 1, deterministic)

Check codes (matching `inspection_findings.check_code`) with default severities:

| Code | Check | Default severity |
|---|---|---|
| `corruption` | File opens and parses as its declared type | blocking |
| `password` | Password/encryption protected | blocking |
| `malware` | ClamAV verdict (separate job; error ⇒ quarantine) | blocking |
| `macros` | Macro-enabled content present | blocking |
| `size_type` | Extension/MIME allowlist and ≤10 GB | blocking on type, info on size |
| `aspect` | Slide size vs the room profile (16:9 / 4:3) | info / warning |
| `fonts` | Non-embedded fonts (names + slide refs) | warning |
| `linked_media` | Linked (not embedded) media, with slide refs | warning |
| `codec` | Video codec outside the room playback profile (e.g. HEVC where H.264 is guaranteed) | warning |
| `external_links` | External/auto-open links | warning |
| `dup_filename` | Same SHA-256 already present for this event | info |
| `metadata` | Slide count, aspect, embedded media inventory | info |

Findings carry `detail.slide_refs` so the UI can say "Slide 14" as the prototype does. Severity mapping is event-configurable **upward only** (a warning may be made blocking; blocking security checks may never be downgraded). Waivers annotate a finding, never change state, stay visible forever, and require Presentation Manager + reason (FR-INSP-003).

## 12. Non-functional budgets (enforced as tests, not aspirations)

| Budget | Target | Where verified |
|---|---|---|
| SRR speaker/talk lookup | ≤1 s P95 server-side, ≤5 s end-to-end (OBJ-5, NFR-PERF-04) | M4 test + M7 load |
| Upload | ≤10 GB, resumable, ≥99.5 % resume success (NFR-PERF-02) | M2 test, M7 load (50×1 GB concurrent) |
| Sync | 1 GB / 50 Mbps ≤5 min; manifest P95 <500 ms (NFR-PERF-03) | G0-2 PoC, M5 test |
| Room-offline detection | <5 min from last heartbeat | M5 + alarm test |
| Archive | ≤4 h event close → package delivered (OBJ-7) | M6 test with pilot-sized fixture |
| Availability / DR | per NFR-AVL-01/02, NFR-DR-01 (RPO ≤15 min, RTO ≤4 h) | M7 DR rehearsal |
| Permission regression | ≥95 % of the role × permission matrix covered (NFR-SEC-03) | M1 onwards, gate in CI |

## 13. Security

- **Staff**: OIDC + MFA, idle and absolute session timeouts (NFR-SEC-02), event-scoped least-privilege roles (`platform_admin`, `project_manager`, `presentation_manager`, `srr_technician`, `room_technician`, `content_reviewer`, `client_event_admin`, `scoped_reviewer`).
- **Speakers**: magic link + one-time-code fallback; tokens stored hashed, recipient-bound, single-event, expiring, revocable, rotated on use for sensitive actions. A speaker token grants access only to that speaker's assignments.
- **Agents**: signed device credentials, room-scoped.
- **Isolation**: RLS on every tenant table by `client_id`/`event_id` plus application-level authorisation. A request that resolves outside its scope returns 403, writes `security.cross_event_attempt` and raises an alert (I-4).
- **Data**: KMS at rest, TLS 1.2+ in transit, presigned short-lived download URLs, downloads logged, restricted-from-distribution flag honoured in search, bulk download and archive.
- Full model, threat analysis and retention/legal-hold rules: `docs/SECURITY_MODEL.md`.

## 14. Commands

```bash
# repo root
npm ci
npm run dev                 # docker compose up + all app processes in watch mode
npm run lint                # eslint --max-warnings=0 across workspaces
npm run type-check          # tsc --noEmit across workspaces
npm test                    # unit + domain tests across workspaces
npm run contracts:check     # fail if generated types drift from openapi.yaml
npm run test:invariants     # the six invariant suites (§3)
npm run test:scenarios      # SRS §18 mandatory scenarios
npm run test:e2e            # Playwright, incl. the 19-step walkthrough
npm run ci                  # contracts:check && lint && type-check && test && build

# database
npm run db:up               # docker compose postgres/redis/clamav
npm run db:migrate          # apply db/migrations in order
npm run db:reset            # drop + recreate + migrate + seed fixtures

# per workspace
npm run dev  -w apps/api
npm run dev  -w apps/control-center
npm run dev  -w apps/speaker-portal
npm run dev  -w apps/room-agent          # Electron, Windows
npm run build -w apps/room-agent -- --msi  # signed MSI (M5-6)
```

## 15. Code style

Domain code is pure and total; services orchestrate; routes are thin. One real example — the review transition, which is the heart of I-1 and I-6:

```ts
// packages/domain/src/review/transition.ts
export type ReviewState =
  | 'awaiting_review' | 'in_review' | 'changes_requested'
  | 'approved' | 'superseded' | 'rejected' | 'rolled_back';

const LEGAL: Record<ReviewState, Partial<Record<ReviewAction, ReviewState>>> = {
  awaiting_review: { claim: 'in_review' },
  in_review: { approve: 'approved', request_changes: 'changes_requested', reject: 'rejected' },
  changes_requested: {},
  approved: { supersede: 'superseded', roll_back: 'rolled_back' },
  superseded: {},
  rejected: {},
  rolled_back: {},
};

/** Pure: no I/O, no clock, no randomness. Returns either the next state or a typed refusal. */
export function transitionReview(input: {
  from: ReviewState;
  action: ReviewAction;
  actor: { roles: EventRole[] };
  reason?: string;
  override?: boolean;
}): Result<{ to: ReviewState; requiresReason: boolean }, IllegalTransition> {
  const to = LEGAL[input.from][input.action];
  if (!to) {
    if (!input.override) {
      return err({
        code: 'review.illegal_transition',
        message: `Cannot ${input.action} a presentation that is ${label(input.from)}. Allowed: ${allowed(input.from)}.`,
        current_state: input.from,
      });
    }
    if (!hasRole(input.actor, 'presentation_manager')) return err(FORBIDDEN_OVERRIDE);
    if (!input.reason?.trim()) return err(REASON_REQUIRED);
  }
  if (!canPerform(input.actor, input.action)) return err(FORBIDDEN);
  return ok({ to: to ?? OVERRIDE_TARGET[input.action], requiresReason: Boolean(input.override) });
}
```

```ts
// apps/api/src/routes/review.ts — thin: authorise, validate, delegate, map
router.post('/file-versions/:versionId\\:transition',
  requirePermission('review.decide'),
  withIdempotency,
  async (req, res) => {
    const body = parse(TransitionRequest, req.body);          // generated contract type
    const result = await reviewService.transition(req.scope, req.params.versionId, body);
    if (!result.ok) return res.status(statusFor(result.error)).json(result.error);
    return res.json(result.value);
  });
```

Conventions: named exports only; `Result<T, E>` for expected failures and exceptions only for bugs; SQL in `packages/db` with named parameters (no string interpolation ever); file names `camelCase.ts`, React components `PascalCase.tsx`; tests next to the code as `*.test.ts` except the three suites under `tests/`; every state-changing function takes an explicit actor.

## 16. Testing strategy

| Level | Tool | Scope | Gate |
|---|---|---|---|
| Domain unit | `node:test` | `packages/domain` — every lifecycle, every legal and illegal transition, derived status truth table | 100 % of transition table branches |
| Service/integration | `node:test` + docker Postgres/Redis/ClamAV | Services with a real database incl. RLS, idempotency, outbox | Every endpoint has at least one happy + one denied + one conflict case |
| Invariant | `node:test` | The six suites in §3 | Must be green on every PR |
| Scenario | `node:test` | SRS §18 mandatory scenarios (partial sync, two technicians, replacement speaker, missing media, quarantine, rollback) | Must be green before M7 exit |
| Web unit | Jest + Testing Library | Components, derived status rendering, role gating, empty/error states | Changed components covered |
| E2E | Playwright | The 19-step walkthrough end to end, plus per-screen visual regression against approved baseline rows | Green before each milestone review |
| Agent | `node:test` + Windows CI runner | Sync engine, cache, offline queue; playback driver against a fake, plus the G0-1 matrix on real hardware | Matrix re-run at M5 exit |
| Load | k6 or artillery | 50×1 GB concurrent uploads, SRR search, sync fan-out | M7 |

TDD is the default for domain and workflow code: the transition table test is written before the transition table.

## 17. Boundaries

**Always**
- Work one `docs/tasks/M*.md` task at a time; end it with its verification command passing and one commit.
- Update the OpenAPI contract before the handler; run `contracts:check`.
- Add the audit record and the outbox event in the same transaction as the state change.
- Reference requirement IDs (FR/NFR/OBJ) in the commit body and keep `TRACEABILITY.md` current.
- Keep the six invariant suites green.
- Use the baseline's terminology and tokens for anything user-visible.

**Ask first**
- Any change to `docs/SRS.md` functional requirements or acceptance criteria (needs DXG approval).
- New states or transitions (`WORKFLOW_STATES.md` is sign-off material).
- New runtime dependencies, new AWS services, or anything that moves cost.
- Schema changes that rewrite existing tables rather than adding to them.
- Anything that would deviate from an approved visual-acceptance row.

**Never**
- Let a file enter a library or a room without a clean scan and a checksum match.
- Replace an approved room copy without re-approval and, where required, acknowledgment.
- Write to `audit_records` other than by appending, or bypass the chain.
- Put authoritative state in Redis, or reach across the RFPilot boundary at the database level (D-006).
- Commit `.env`, secrets, real client/event content, or real speaker decks as fixtures.
- Mark a task done with a failing or skipped test.

## 18. Open questions

1. **Pilot profile** (rooms, speakers, file mix) — blocks final performance sizing and the M7 load-test targets (P0-E15).
2. **Sample agenda files** — the import column-mapping heuristics in M1-6 need real DXG spreadsheets (P0-E13).
3. **Retention / legal-hold / certified-deletion policy** confirmation (P0-E14) — affects M6-3 and the Object-Lock configuration.
4. **Role × permission matrix sign-off** (P0-E8) — M1-2 can start from our draft, but the matrix must be DXG-signed before M7.
5. **Playback driver default** — decided by G0-1 evidence; the interface ships either way.
6. **Client-portal branding assets** — needed before M6 client-facing polish.
7. **Windows fleet profile** (Office builds, admin rights, AV) — shapes agent packaging and the MSI install mode.
