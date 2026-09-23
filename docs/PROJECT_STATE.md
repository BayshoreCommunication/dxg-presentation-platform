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

## 2026-09-17 (tenth) — authentication: sign-in screens for both apps

Both apps now require a real session; the `x-dev-user` header only applies in development when no
session cookie is present.

- **Staff**: `/login` (email + password), forced password change on a temporary password, signed-in
  identity and sign-out in the sidebar, middleware redirecting deep links through sign-in and back.
- **Presenters**: `/login` (email + access code). The emailed link `/t/<code>` pre-fills the code
  and asks for the email — following a link is no longer sign-in on its own, which is the point:
  a forwarded email does not hand over the presentation (D-016).
- Both API clients forward the session: cookies from `next/headers` in server components,
  `credentials: "include"` in the browser. `next/headers` is imported dynamically because a static
  import pulls it into the client bundle and breaks every client component sharing the module.

**A second, larger gap found while testing:** authentication was enforced but **authorization was
not**. A signed-in client event admin could read the staff review queue, summary, speakers and
event list — any account with a session passed, because the read endpoints only checked that an
actor existed. The staff surface is now deny-by-default: a request must carry a staff event role,
with `/portal/*`, `/client/*`, `/agent/*`, `/webhooks/*`, `/ops/*` and the auth endpoints as the
only exceptions. `tests/invariants/auth-separation.test.ts` covers all three principals (15 tests).

Also fixed: the review workspace rendered informational findings as warnings with raw JSON; the
client portal 500'd instead of explaining that it is a client surface.

## 2026-09-17 (eleventh) — MFA enforced, closing the last SRS security gap

TOTP (RFC 6238) written against the standard library — no dependency, no SMS, no identity
provider, and no third party ever sees a secret. Verified against all six RFC 6238 test vectors.

- A password on an enrolled account yields a five-minute challenge, not a session. The challenge
  cookie opens nothing: `/events` and `/auth/session` both refuse it.
- A code is accepted once per step, so a glimpsed code cannot be replayed inside its 30 seconds.
- Ten single-use recovery codes at enrolment, stored hashed, shown once; removing MFA needs both
  the password and a live code.
- Unenrolled staff accounts reach the enrolment endpoints and nothing else.
- **No development bypass**: the seed pre-enrols the development accounts with a known secret, so
  local work uses a real second factor. `npm run demo:totp` prints the current code.

Two things the tests taught us, both kept: replay protection made sequential tests invalidate each
other's codes, so the helper waits for a step boundary on first use and hands out a step-unique
code thereafter; and because the counter is per account, test files that run in separate processes
need separate accounts. The suite now passes twice in a row with no flakes (21 tests).

This closes the D-015 deviation. NFR-SEC-02 is met.

## 2026-09-17 (twelfth) — staff account administration

`/admin/users`, restricted to platform admins and project managers. Creating an account issues a
temporary password shown once; resetting a password or an authenticator revokes that account's
sessions; roles are granted and removed per event.

Guards, each covered by a test: a content reviewer is refused the screen and the create endpoint;
an admin cannot deactivate themselves; the last platform admin role on an event cannot be revoked;
resetting someone's authenticator requires a written reason, because it turns a lost phone back
into an open door and is the strongest thing one account can do to another. A new account is
refused the staff surface twice over — first for holding no role, then for not having enrolled.

**A gap this surfaced: the seed had no platform admin at all**, so nobody could administer
accounts. `admin@example.invalid` (A. Whitfield, platform_admin) is now seeded.

Eighteen screens; 139 unit tests, 29 auth/MFA/admin tests, lint and type-check green.

## 2026-09-17 (thirteenth) — self-service password reset, and the outbox dispatcher

Resetting a forgotten password needed email to actually leave the system, which meant building the
outbox dispatcher the architecture always specified (BUILD_SPEC §6.2) rather than stubbing around
it. `apps/dispatcher` drains the outbox and delivers through a sender chosen by environment: a file
transport in development that writes each message to `.data/mail/` and prints it, and an SES
transport that **throws rather than silently succeeding**, so production cannot look like working
email while nobody receives anything. Communications batches now travel the same path.

The reset itself:
- requesting one answers identically whether or not the address has an account, and sends nothing
  when it does not
- the link is hashed in storage, single use, 30 minutes, and asking for a new one retires the old
- at most five requests per account per hour
- completing a reset revokes every session — and does **not** satisfy the second factor: an
  enrolled account still needs its authenticator, so a hijacked mailbox alone opens nothing

Three test-design problems fixed rather than worked around: the reset tests were changing a shared
fixture account's password and breaking the MFA suite (they now create and enrol their own
account); they raced with previously queued mail (they now wait for a message written after a
marker and addressed to the right recipient); and a password-policy failure returned 400 where
every other policy refusal returns 422 — the API was made consistent.

139 unit tests, 34 auth/MFA/admin/reset tests, green twice in a row.

## 2026-09-17 (fourteenth) — SES wired, with signed delivery events

`SesSender` sends through SESv2 (`@aws-sdk/client-sesv2`, loaded lazily so development never
touches it), tagging every message with the communication it belongs to so events can be matched
back to a speaker without relying on the message id alone. Configuration is validated at
construction: the transport refuses to start without `AWS_REGION` and `MAIL_FROM`, and warns
loudly when `SES_CONFIGURATION_SET` is missing — without one, SES publishes no delivery, bounce or
complaint events and the platform would believe every message landed.

Delivery events arrive via SNS and are signature-verified before anything is recorded. That is a
real control, not ceremony: a forged bounce suppresses future mail to that speaker, so it is a way
to silently cut a presenter off from their upload link. The verifier checks the signature, that the
certificate URL is genuinely an SNS HTTPS `.pem` — **checked before fetching, so a forged URL is
never requested** — that the topic is allowlisted, and that the timestamp is recent. Subscription
confirmations are handled, and events for messages we never sent are acknowledged rather than
retried forever.

15 tests cover it, including a message signed with a different key, a tampered payload, a lookalike
certificate host, an unexpected topic and a replayed timestamp. Verified end to end in development:
a 3-recipient batch went queued → dispatched → `sent`, with per-speaker status.

Remaining before SES is live: a verified sender identity and configuration set in AWS, the SNS
topic and subscription, and production-out-of-sandbox. Those are account actions, not code.

## 2026-09-17 (fifteenth) — SES live in the shared account

Set up in 295229565954 / us-east-2 with the `rfpilot` profile (D-008). Detail and runbook:
`docs/infra/EMAIL.md`.

Already there and not needing work: **`dxg-agency.com` is verified with DKIM signing**, and the
account already has **production access** (50,000/day, 14/sec) — no DNS changes, no sandbox
request. The gap was the part that matters: the account had **no configuration sets at all**, so
SES was publishing no delivery telemetry anywhere.

Created: configuration set `pmp-email` (TLS `REQUIRE`, reputation metrics on, suppression on bounce
and complaint), SNS topic `pmp-email-events` with a policy allowing only SES in this account to
publish, and an event destination for SEND, DELIVERY, BOUNCE, COMPLAINT, REJECT, RENDERING_FAILURE
and DELIVERY_DELAY. Tagged `product=pmp` to stay separable from RFPilot. Verified by sending a real
message through the configuration set to the DXG service address.

**Known drift, recorded rather than hidden:** created with the CLI, not CloudFormation.
`deploy/aws/lib/email-stack.ts` describes the resources and synths clean, but a first `cdk deploy`
would collide with the existing names — adopt with `cdk import` or delete and deploy. Both commands
are in `docs/infra/EMAIL.md`.

Outstanding, none of it code: no SNS subscription (the API has no public URL yet; the webhook is
built and verifies signatures), open/click tracking off pending a tracking subdomain, and no custom
MAIL FROM domain for SPF alignment.

## 2026-09-17 (sixteenth) — custom MAIL FROM domain

`mail.dxg-agency.com` is now set as the custom MAIL FROM domain on the `dxg-agency.com` identity.
Status is **`PENDING`** and will stay there until two DNS records exist; the records and the check
command are in `docs/infra/EMAIL.md`.

**I cannot add those records.** `dxg-agency.com` is served by Namecheap
(`dns1.registrar-servers.com`), and the only hosted zone in this AWS account is the private
`rfpilot-production.local.` — so this needs whoever administers that zone. The two records are an
MX on `mail` → `feedback-smtp.us-east-2.amazonses.com` priority 10, and a TXT on `mail` →
`v=spf1 include:amazonses.com ~all`.

**Chose `USE_DEFAULT_VALUE` over `REJECT_MESSAGE` deliberately.** `REJECT_MESSAGE` is the stricter
setting and the wrong one to start with: the records do not exist yet, so it would reject every
outgoing message — upload links, reminders, password resets — until work completed in a system we
do not control. `USE_DEFAULT_VALUE` falls back to `amazonses.com`, which is precisely the behaviour
that was already in place, so nothing regresses. Once the identity reads `SUCCESS`, tightening to
`REJECT_MESSAGE` is worth doing and the command is in the runbook.

Confirmed rather than assumed: a real message was sent through the `pmp-email` configuration set
while the identity was `PENDING` and was accepted (`MessageId 010f01a0aee21e1f-…`), DKIM still
`SUCCESS`. Sending is unaffected.

## 2026-09-20 (seventeenth) — MAIL FROM lapsed; `av-rfpilot.com` evaluated and rejected

Three days on, `mail.dxg-agency.com` is still `PENDING` and the Namecheap records were never
published, so the setup is at or past SES's 72-hour cutoff and has effectively lapsed to `Failed`.

**I had this wrong in the last entry and have corrected the runbook.** I wrote that SES flips to
`SUCCESS` "within about 72 hours of the records propagating". The window actually runs from *when
the MAIL FROM was configured*; at the end of it SES stops checking and sets `Failed`, and publishing
the records afterwards does nothing until the configure command is re-run. The order matters:
publish the records first, then configure.

**`av-rfpilot.com` cannot substitute.** It is ours (GoDaddy), already SES-verified with DKIM
`SUCCESS`, and `mail.av-rfpilot.com` is free — but SES requires the MAIL FROM domain to be a
subdomain of the parent domain of the verified identity, so it cannot serve `dxg-agency.com`. Even
if it could, it is the wrong answer twice over: speakers would receive event mail from a domain that
is not their agency's, and `av-rfpilot.com` is RFPilot production's live sending identity
(`noreply@av-rfpilot.com`), so changing its attributes would reach into another product's
production email.

**None of this is blocking.** DMARC needs SPF *or* DKIM to align. DKIM already signs as
`dxg-agency.com` and aligns, so mail from `presentations@dxg-agency.com` authenticates correctly
today; the apex also already publishes `v=spf1 include:amazonses.com ~all`. The custom MAIL FROM
adds SPF alignment as a second, independent path — worth finishing, not worth changing the sending
domain for.

**Separate finding, different product:** `_dmarc.av-rfpilot.com` publishes **two** DMARC TXT records
(`p=quarantine` and `p=none`). Per RFC 7489 §6.6.3 receivers must ignore DMARC entirely when more
than one record is present, so RFPilot currently has *no* effective DMARC policy despite intending
`p=quarantine`. Confirmed against two resolvers. Not fixed here — it is RFPilot's zone and not this
project's call.

## 2026-09-20 (eighteenth) — sending address switched to `noreply@av-rfpilot.com`

Travis's call (D-019): the platform now sends as `noreply@av-rfpilot.com`, the address RFPilot
production already uses, replacing `presentations@dxg-agency.com`. The reason is control — that
domain's DNS is ours at GoDaddy, where `dxg-agency.com` sits at Namecheap and the custom MAIL FROM
there lapsed after 72 hours without the records ever being published.

The change was pure configuration; no address was ever hardcoded. `.env.example` and
`docs/infra/EMAIL.md` now carry the new sender, `deploy/aws/bin/pmp.ts` passes
`sendingDomain: 'av-rfpilot.com'`, and the stack comment explains why the identity is still not
CDK-managed — it is now shared with another product's production sender, which is a stronger reason
than before, not a weaker one. Verified by sending as the new address through the `pmp-email`
configuration set (`MessageId 010f01a0bd30a596-…`). 154 tests pass, lint and CDK typecheck clean.

**One regression came with the switch, and it needs a DNS edit we can actually make.**
`av-rfpilot.com`'s apex SPF is `v=spf1 include:spf.em.secureserver.net ?all` — it does **not**
authorize SES, where `dxg-agency.com` already published `include:amazonses.com`. So outgoing mail now
authenticates on DKIM alone, with no second path. Fix is one record edit at GoDaddy:
`v=spf1 include:spf.em.secureserver.net include:amazonses.com ~all` (edit the existing record — two
SPF records are as broken as none; `?all` → `~all` is the other half).

That compounds with the duplicate `_dmarc.av-rfpilot.com` records already noted: DMARC is currently
not applied at all, so the weak SPF is not yet being punished. When someone deletes the stray
`p=none` record and `p=quarantine` starts taking effect, DKIM becomes the only thing between this
platform's mail and the spam folder. **Do the SPF fix first.** Both now affect two products, not one.

Recorded but not mitigated: speakers will receive event mail from a vendor domain rather than DXG's,
and sender reputation is now shared with RFPilot — a bad speaker list can hurt their deliverability
and vice versa. `MAIL_REPLY_TO` pointing at a real DXG address is the cheap mitigation for the first
and is still unset.

## 2026-09-20 (nineteenth) — email authentication actually fixed

Both DNS gaps on `av-rfpilot.com` are closed. Travis made the edits at GoDaddy; I verified them.

**SPF** now reads `v=spf1 include:spf.em.secureserver.net include:amazonses.com ~all`. Exactly one
record, SES authorized, `~all` instead of the old neutral `?all`, 2 of 10 permitted DNS lookups used,
identical on both authoritative nameservers and on 1.1.1.1 / 8.8.8.8 / 9.9.9.9.

**DMARC**'s duplicate `p=none` record is deleted, leaving
`v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;`. Until now two
records meant receivers ignored DMARC entirely (RFC 7489 §6.6.3), so a policy that looked like
`p=quarantine` was doing nothing. It is now genuinely in force — for RFPilot as well as this platform.

The ordering was deliberate and is recorded in `docs/infra/EMAIL.md` in case this is ever redone:
while DMARC was unenforced the weak SPF cost nothing, so SPF had to be fixed *first*. Removing the
duplicate is the act that switches enforcement on.

**A verification note worth keeping.** My first check after the DMARC delete reported success and
then printed two records in the same breath — GoDaddy's anycast nodes converge unevenly, and `ns36`
was serving the new zone while `ns35` alternated for several minutes. A single `dig` inside that
window is not evidence in either direction. The runbook now says to query both nameservers plus a
public resolver, repeatedly, when checking a recent change.

Net effect: outgoing mail from `noreply@av-rfpilot.com` now authenticates on two independent paths
(SPF and DKIM, both aligned) under an enforced DMARC policy, where a week ago it had one unenforced
path. Items 1 and 2 of the email Outstanding list are closed.

## 2026-09-20 (twentieth) — `MAIL_REPLY_TO` set

`MAIL_REPLY_TO=dxgrfptool@gmail.com` (D-020). Speakers replying to an upload link now reach a real
inbox instead of `noreply@`.

**The finding that decided it: `dxg-agency.com` publishes no MX records and cannot receive mail at
all.** The natural choice — a DXG-branded reply-to — would have bounced every speaker reply silently.
Worth knowing beyond this one setting: nothing can be delivered to that domain, so no future feature
should assume otherwise. `av-rfpilot.com` does have MX (GoDaddy mailboxes), but inventing an address
there carries the same silent-bounce risk unless the mailbox is confirmed to exist.

Chosen knowing the cost: external speakers see a gmail address. It is a stopgap and a one-line change
when DXG provides a branded monitored mailbox.

No code change was needed — `SesSender` already passes `ReplyToAddresses` when configured. Verified
through the platform's own sender rather than the CLI, so the whole path from env to SES is proven
(`MessageId 010f01a0bd42259b-…`). Added `packages/email/src/config.test.ts`: six tests over
`sesConfigFromEnv()`, including that `replyTo` survives and that it stays `undefined` rather than an
empty string when unset. `npm run ci` green, 160 tests.

## 2026-09-20 (twenty-first) — project contact address is the service address

`deploy/aws/bin/pmp.ts` defaulted `alertEmail` to a personal address. On deploy that creates two real
AWS Budgets email subscriptions ($80 and $100 thresholds), so it was inert only because nothing is
deployed yet. Now `dxgrfptool@gmail.com`, matching `MAIL_REPLY_TO` (D-020) — this project uses the
service address, not personal contact details. The `pmpAlertEmail` CDK context key still overrides it.

Swept the rest of the project: no personal address remains anywhere. The other non-fixture addresses
are `m.vega@dxg.live` in a TOTP test fixture and `name@dxg.live` as a UI placeholder in
`StaffAdmin.tsx` — neither is ever sent to. Everything else is `*@example.invalid`.

The mandatory `owner` tag (ENVIRONMENTS.md §5) is now `dxg-pmp` rather than a personal name —
Travis's call. Because the tagging scheme is documented rather than incidental, the *value* convention
is now written into ENVIRONMENTS.md §5 alongside it: tag values carry no personal contact details,
because ownership is the team's and a tag outlives whoever set it. Confirmed via `cdk synth` that
every resource carries `owner=dxg-pmp`. Nothing is deployed, so no live resource needed retagging.

## 2026-09-20 (twenty-second) — Cloudflare Quick Tunnel, and two bugs it exposed

Travis's call: no deployment yet, work locally. A Cloudflare Quick Tunnel
(`cloudflared tunnel --url http://localhost:4000`, no account, no DNS) gives the local API a public
HTTPS URL, which is the only thing the SNS subscription was ever waiting for. Local stack up:
postgres/redis/clamav in compose, API on :4000, `.env` created (gitignored) pointing at real SES.

**The tunnel immediately exposed why the subscription would never have worked.**

**1. SNS posts `Content-Type: text/plain; charset=UTF-8`, not `application/json`.** The global
`express.json()` therefore never parsed an SNS body, so `req.body` arrived `undefined` and the route
crashed on its first property access. Every real SNS message would have failed — *including the
SubscriptionConfirmation*, so the subscription could never have activated. The failure mode is
especially nasty because it looks like "SNS never called us" rather than a bug on our side. Fixed with
a route-scoped `express.json({ type: () => true })`: the signature check is what establishes trust,
not the Content-Type header.

**2. No global error handler existed**, so Express's default served a full stack trace — absolute
filesystem paths and internals — from `/api/v1/webhooks/email`, which is unauthenticated by necessity
and was about to be exposed to the public internet. Added a last-resort handler returning JSON, 4xx
for body-parser rejections and an opaque 500 otherwise.

**Verified live, not assumed.** Subscription confirmed (`…:38e39ff0-…`); a real SES send produced
SNS metrics of 3 notifications delivered, **0 failed**, meaning the webhook returned 2xx through the
tunnel. Rejection paths still behave: unsigned → 403, wrong topic ARN → 403, empty body → 400,
malformed JSON → 400 with no stack.

**What is NOT yet proven, stated plainly.** The chain is confirmed as far as the webhook returning
2xx. The last link — `recordDeliveryEvent` writing a `communication_events` row — was not exercised,
because the seed creates no `communication_templates`, so `POST /events/:id/comms/send` cannot run,
and the CLI-sent test message carried no `communication_id` tag to attach events to. `parseSesEvent`
and `SES_EVENT_STATUS` are unit-tested; `recordDeliveryEvent` has **no test coverage at all**. So the
transport is proven and the recording is not.

The tunnel URL is ephemeral and changes on restart; the subscription has to be recreated each time.
Fine for testing, not a standing arrangement.

## 2026-09-20 (twenty-third) — speaker upload exercised for real, and a user guide

Uploaded a genuine presentation through the speaker portal UI as Alicia Fontaine, signed in with an
access code alone. Not a stub: the file was built with the project's own `writeZip` into a valid
PPTX — 5 slides, 16:9 slide size, an embedded .mp4 — so the inspector had real structure to read.

The whole chain held. Server-side afterwards: version 2, `processing_state=stored`,
`inspection_state=passed`, `review_state=awaiting_review`, sha256 `123e81e0…672e` matching what the
speaker was shown, the bytes content-addressed on disk under client/event prefixes, and four
inspection findings recorded (5 slides, 16:9 against the room profile, 1 embedded media) — identical
to what the same inspector produced locally beforehand. v1 kept, not overwritten; the button becomes
"Replace file".

**One display bug found:** a 68,912-byte file renders as "**0 MB** — within the 10 GB limit". The
size is rounded to whole megabytes, so anything under ~500 KB reads as zero, which looks like a
failed upload at the exact moment the speaker most needs reassurance. Not fixed here.

Added `docs/USER_JOURNEY.md` — a plain-language guide covering both the speaker's three steps and the
staff path from event creation through onsite to archive, written for someone opening the platform for
the first time with no technical background. Grounded in the flows as they actually behave, having
just walked them, rather than in what the screens are intended to do.

## 2026-09-20 (twenty-fourth) — one byte formatter, `@pmp/format`

Fixed the "0 MB" display. The speaker's upload confirmation now reads
**"v2 received. Checksum verified — earlier versions are kept safe. 68.9 KB."**, verified in the
running UI rather than only in tests.

**It was not one bug, it was eight.** Every size string in the product was formatted at its own call
site — `PortalView`, `UploadPanel`, `ArchiveView`, `ReviewWorkspace`, `PresentationDetail`,
`InspectionView`, `RoomAgentView` and the API's `srr.ts` — each with a slightly different local
helper, and all of them flooring to whole megabytes. Fixing only the reported screen would have left
seven others to be rediscovered one at a time.

New zero-dependency package `@pmp/format` (`formatBytes`, `formatBytesDelta`), imported by all eight.
It picks a unit by magnitude, never renders a real file as `0`, keeps one decimal below 100 and drops
it above, returns `—` for absent values rather than inventing `0 bytes`, and handles the negatives
that deltas produce. 9 tests, including the regression itself: 68,912 bytes must render `68.9 KB` and
must not render `0 MB`.

**Two things worth recording from doing it.** `Number(null)` is `0`, not `NaN`, so a missing size was
being reported as a real empty file until an explicit guard went in — caught by the test, not by
reading the code. And the formatter first lived in `@pmp/domain`, which failed: the Next apps then had
to typecheck the whole domain package, which uses `.ts` extension imports and `findLast`, neither
compatible with their tsconfig. A single-file package with no internal imports was the fix, and is
better design anyway — two frontends should not compile the lifecycle engine to print a file size.

`npm run ci` green at 169 tests.

## 2026-09-20 (twenty-fifth) — sizes verified across the staff surface; a session bug found on the way

Swept every staff view that renders a size, after the `@pmp/format` change. All correct, no `0 MB`
anywhere: Presentation detail `68.9 KB` and `155 MB` on one page, Inspection `68.9 KB`, Review
`155 MB`, Archive `504 MB`. Room Agent shows `0 files · 0 bytes local`, which is a genuine zero — an
empty room library — not a null coerced to a number; the formatter returns `—` for absent values, so
the two cases stay distinguishable. Room sync, SRR and Client portal render no sizes without data.

**A real bug surfaced while getting there: the staff app crashed with a presenter signed in.**
`/api/v1/auth/session` returned whatever principal held the session cookie, regardless of kind. Both
apps share the API origin, so one browser holds one cookie for both and signing into the speaker
portal *replaces* a staff session. The control centre then rendered a presenter through the staff
shell and died on `principal.roles.join()` — a field presenters do not have.

Not privilege escalation: the deny-by-default staff gate still refused every staff route, which is
why this surfaced as a crash rather than as access. But the staff app was rendering a principal it
should never have accepted. Fixed at the API boundary — `/auth/session` answers "who is the signed-in
*staff member*", so a presenter there is no session at all — and narrowed again in the control centre
layout, so a future shape change cannot 500 the app. The portal side was already correct via
`withPortalSession`.

**Found and not fixed:** 20 of 22 staff pages throw on a 401 instead of redirecting to the login
screen, so an expired session shows a crash page. Only `admin/users` and `client/[eventId]` redirect.
The middleware comment claims "a 401 from there sends the user back here too" — it does not. The fix
cannot go in `lib/api.ts`, which is shared with client components where `LoginForm` needs to *display*
a 401 rather than redirect, so it is a per-page change. Tracked separately.

## 2026-09-20 (twenty-sixth) — an expired session now lands on the login screen

All 16 staff pages that call the API route a 401 back to `/login?next=<where they were>&reason=required`
instead of rendering a crash page. Previously only `admin/users` and `client/[eventId]` did.

`lib/guard.ts` wraps the fetch rather than restructuring each page:
`const { items } = await guard(listEvents(), "/")`. One line per call site, and the `next` parameter
means the user resumes where they were rather than landing on the portfolio.

**Only 401 redirects, deliberately.** A 403 means the session is perfectly valid and the role is not
sufficient; bouncing that person to a login screen they are already past sends them round a loop with
nothing explained. Those stay with the caller, as the two already-correct pages do.

**It could not be centralised in `lib/api.ts`**, which was the obvious place. That module is imported
by client components too, and `LoginForm` needs to render a 401 as "that email and password don't
match an account" rather than navigate away from the form being typed into. A blanket redirect inside
`request()` would have broken sign-in — the failure being silently converted into a redirect back to
the same form. Verified after the change that a wrong password still shows its message and stays put.

Verified by deleting every `auth_sessions` row while keeping the browser cookie — the real expired
session case — then requesting all 14 reachable staff paths: every one landed on `/login` with its
own path preserved, none errored.

Corrected the `middleware.ts` comment, which claimed "a 401 from there sends the user back here too".
That was not true when written; it is now, and the comment says which code makes it so.

Also fixed while in there: `events/[id]/agent/[roomId]` destructured only `roomId`, so the return path
had no event id to build from — caught by typecheck, not by reading.

## 2026-09-20 (twenty-seventh) — a 403 now explains itself

Creating a staff account through the admin screen and signing in as it produced a Next.js runtime
error reading "This is a DXG staff area. Your account does not have a staff role on this event."

Two separate things, and only one of them is a bug in the strict sense.

**The 403 was correct.** `Staff accounts` creates the account; it does not grant access. A new account
therefore has no role on any event and the API refuses it, exactly as designed. The role is added
afterwards from the same screen, through the per-user `add role…` dropdown and `grant`.

**Rendering that refusal as a stack trace was mine**, from the previous entry. I routed 401 to the
login screen and deliberately left 403 to propagate, reasoning that bouncing a signed-in person to a
login screen would loop them. That reasoning holds; leaving them at a crash page instead does not.
`guard()` now sends a 403 to `/no-access`, which states that sign-in worked, that what is missing is a
role on an event, and that an administrator adds it from Staff accounts.

Worth noting this is the *ordinary* first-run path for every new staff member, not an edge case — the
account necessarily exists before anyone gives it a role — so it was always going to be the first
thing a new colleague saw.

Verified by signing in as an administrator, rendering `/no-access` with the real message, then
granting `presentation_manager` on MedTech Forward 2026 to the test account through the UI and
confirming the row in `event_roles`.

## 2026-09-20 (twenty-eighth) — QR code on authenticator enrolment

Enrolment now leads with a scannable QR, typed secret kept underneath (D-021, superseding the D-017
clause that declined QR codes). The API had been returning `otpauth_uri` all along and the UI was
discarding it, so most of this was already built.

Rendered in the browser via `qrcode-generator` (MIT, zero dependencies, types included) — chosen over
`qrcode`, which pulls three transitive packages including a CLI argument parser. D-017's real
objection was handing a secret to a third-party image service; that still stands and is honoured, as
nothing leaves the page.

**A second bug surfaced while testing, worth more than the QR itself.** Signing in as the new account
landed on `/no-access` saying "what's missing is a role on an event" while the actual message read
"Set up your authenticator app before using the platform" — the page assumed every 403 meant a
missing role. Two different refusals were being flattened into one. `guard()` now reads the error
code: `auth.mfa_required` routes to `/account/mfa`, because not having enrolled yet is a **step to
finish, not a door being closed**; every other 403 still goes to `/no-access`. Without that, a new
staff member was told to ask an administrator for a role they already had.

Verified end to end rather than by eye: the QR was rebuilt independently from the secret shown on
screen and matched the rendered SVG exactly — 49 modules, viewBox `0 0 57 57`, 1258 dark modules —
then enrolment was completed with a code derived from that secret, recovery codes issued, and
`mfa_enrolled_at` confirmed set. CI green, 169 tests.

## 2026-09-20 (twenty-ninth) — the already-enrolled screen was a dead end

Pressing **Start setup** on an account that already has an authenticator showed
"This account already has an authenticator. Remove it first to enrol a new one." — and then offered
nothing but the same button, which would fail again. Correct refusal, unusable screen.

**The refusal itself stays.** Letting a signed-in session silently swap its own second factor would
mean anyone who borrowed an unlocked screen could replace it with their own, which is precisely the
attack the second factor exists to stop. What was missing was telling the person who *can* unblock
them: an administrator, via Staff accounts → reset 2FA. The screen now says so, and the button that
cannot succeed is disabled rather than left inviting.

This surfaced because I enrolled the test account during the previous task using a secret generated
in my own verification script — a secret that exists nowhere Travis could reach, so the account was
effectively locked. Cleared it through the real admin path rather than with SQL, which exercised the
flow properly: the reset prompts for *who asked and how they were verified*, and that reason is now
in the audit chain as `admin.mfa_reset` — "Enrolled during testing with a secret the owner does not
hold". Worth noting the prompt exists at all; a 2FA reset is a social-engineering target, and
recording the justification at the moment of the act is the point.

`test@example.com` is now back to unenrolled and can be set up with a real authenticator app.
CI green, 169 tests.

## 2026-09-20 (thirtieth) — a password change that changed nothing

Travis spotted that the forced first-use change accepted the temporary password as the new password.
Confirmed: neither `changeOwnPassword` nor `completePasswordReset` compared the candidate with the
current one. Length and the common-password list were enforced; sameness was not (D-022).

The temporary password is the single worst one to keep, being the only one on the system chosen by
someone else and carried over an untrusted channel. Keeping it cleared `must_change_password`, so the
account was filed as resolved while unchanged — the platform would never raise it again.

Both paths now compare against the stored hash via `verifyPassword`, which also covers reset-by-token
where no current password is submitted. `auth.same_as_old` returns 422, consistent with the other
policy refusals. The message names the temporary password on a first-use change and drops that
wording afterwards, once it is the person's own.

`tests/invariants/password-reuse.test.ts` — five live-API cases. Verified by reverting the fix and
re-running: **3 of 5 fail without it, 5 of 5 pass with it.** The most telling failure is not the
refusal itself but the follow-up — without the check, the reuse succeeded *and* cleared the
forced-change flag. Full CI green, 169 tests.

## 2026-09-20 (thirty-first) — the sidebar stops offering doors that are locked

A presentation manager saw **Staff accounts**, clicked it, and got "Viewing accounts requires a
platform admin or project manager." The refusal was right; offering the link was not.

The sidebar now omits an entry the signed-in account would be refused, and drops a group left with
nothing in it. Only two entries are actually conditional, because only two are gated at view level:
Staff accounts (`platform_admin`, `project_manager`) and Client portal (`client_event_admin`,
`scoped_reviewer`). Everything else is open to any staff role — the restrictions elsewhere are on
specific *actions* within a screen, not on reaching it, so hiding those screens would have been
wrong.

**The lists mirror the server's gates rather than restating them.** A second permission model in the
frontend is one that drifts; the comment in `Sidebar.tsx` names the server-side constant each list
tracks, so a change there has an obvious counterpart here.

**This is presentation, not protection, and the code says so.** Verified after the change: signed in
as a presentation manager with no Staff accounts link rendered, `GET /api/v1/admin/users` still
returns 403, and the page itself still shows its own refusal. Hiding a link nobody can use is a
courtesy; it is never why the thing is safe.

Logged in `VISUAL_ACCEPTANCE.md` §5 as the first deviation, since §2.1 fixes sidebar structure. It is
not a renaming or reordering — for a full-access account the sidebar is exactly the approved baseline,
which is the state the screenshot gate compares. Flagged there for DXG that Client portal is now
hidden from *all* staff including admins, because the API refuses staff by design; if they expect
staff to preview the client view, that is an API decision this change merely makes visible.

CI green, 169 tests.

## 2026-09-20 (thirty-second) — staff can preview the client portal, and clients stop seeing a broken sidebar

Travis's call: staff should be able to see what their client sees. `/client/events/:eventId` now
accepts staff as well as client roles and returns `viewed_as`, and the screen bands itself
**"Preview — this is what &lt;client&gt; sees"** when staff are looking.

**This widens nothing.** The client view is a strict subset of the control centre staff already have,
with restricted talks filtered out (FR-ARCH-001). The filtering is identical for both viewers; only
the banner differs. What the refusal actually prevented was staff checking what they were about to
show someone.

**The banner is not decoration.** These counts are deliberately narrower than the command centre's. A
staff member reading "3 of 3 collected" without knowing restricted talks were excluded would draw a
false conclusion about their own event and might repeat it to the client. It names the client too, so
it is obvious whose view is being previewed.

**A real gap in yesterday's sidebar work surfaced while testing this.** I had gated two entries on the
assumption that everyone signed in is staff. They are not: a `client_event_admin` uses the same login
and is refused by the deny-by-default gate on **every** control-centre, onsite and device route.
Probed all of them as J. Ellis — 403 on eight, 200 on one. So a client was being handed sixteen links
of which exactly one worked. Those groups are now gated to `STAFF_ROLES`, and such an account sees
only EXTERNAL. Worth recording that this was found by testing the *other* role rather than by
re-reading the change.

**Still poor and not fixed:** a client signing in lands on `/` , is refused, and gets
"You're signed in, but this area isn't open to your account" before finding their portal. Sending
client-role accounts to their own event instead needs a rule for choosing which event, so it is a
decision rather than a tidy-up. Flagged, not guessed at.

CI green, 169 tests. Deviation log in `VISUAL_ACCEPTANCE.md` §5 updated — the earlier "hidden from all
staff" entry is superseded.

## 2026-09-20 (thirty-third) — a client signs in and arrives somewhere useful

Client accounts now land on their own event instead of being bounced off the portfolio. Verified both
ways in: signing in goes straight to `/client/<event>`, and visiting `/` later does the same. Staff
are untouched — `admin@example.invalid` still gets the portfolio at `/`.

The principal carries `client_events` (id and name) — populated **only** when every role the account
holds is a client role, so DXG staff never carry what would be every event in the system. A hybrid
account, if one ever exists, is treated as staff: that is the safer of the two guesses, since it lands
somewhere with more rather than less.

**The multi-event case is asked, not guessed.** One event goes straight through; more than one shows
`/client` to choose from. Picking on their behalf could open the wrong client's event, which is the
single mistake this surface must not make — it is the one place two clients' data could be confused.
No event is not a choice at all but a missing role, so that still goes to `/no-access`.

The rule lives in `lib/landing.ts` rather than inside the login form, because three callers need the
same answer — sign-in, MFA completion, and `/`. It also honours an explicit destination: a client who
followed a link to a specific `/client/...` page still gets it rather than being redirected to the
same place twice.

CI green, 169 tests.

## 2026-09-20 (thirty-fourth) — password minimum 6, and a way off the change-password screen

Two changes Travis asked for on the forced-change screen.

**Minimum length 12 → 6** (D-023). Not contradicting anything documented — no SRS or NFR names a
length. Flagged rather than waved through: six is below NIST's floor of 8, and these accounts can
read and change every speaker's material. Enforced TOTP and five-attempt lockout are what now carry
the weight; against an offline attack on a stolen hash neither helps and only scrypt's cost
parameters do. `MINIMUM_LENGTH` is one constant if it should go back up.

**The dictionary had to widen with it.** The common-password list was written under a 12-character
minimum, so nothing shorter could reach it. At six, `123456`, `qwerty` and `abc123` were suddenly
long enough to pass the length rule with nothing else refusing them — lowering the floor alone would
have been worse than either change. Thirty short entries added, verified live: five characters is
`too_short`, `abcdef` is accepted, `qwerty` is `too_common`.

**A test was passing for the wrong reason.** "common passwords are rejected however long" asserted
`too_short` against two eleven-character entries — the old length rule caught them before the
dictionary was consulted. It now asserts `too_common`, and finally tests what its name says. Two new
cases cover the newly-reachable short guesses and their casing variants. 171 tests.

**A way out of the screen**, which is what prompted this. The route differs by how you arrived: a
voluntary change offers "← Back without changing it"; a forced first-use change cannot, since the
account is refused everywhere else, so it offers **"Sign out instead"** — the escape someone handed
the wrong temporary password actually needs. The emailed-link reset screen gets "← Back to sign in",
its only honest destination with no session.

Side effect worth recording: the live policy check changed `admin@example.invalid`'s password and,
correctly, revoked every session for it. Restored to the seeded password and re-verified sign-in.

## 2026-09-20 (thirty-fifth) — the reset screen, checked rather than assumed

Walked the emailed-link reset end to end with the file transport, so nothing was actually sent:
requested a reset, took the link out of `.data/mail`, opened it, and exercised the screen.

**The back link I said I had added was not there.** The previous change matched on
`"Set password"` while that button reads `"Set new password"`, and I had written the edit as a
conditional replace with no assertion — so it silently did nothing and reported success. The copy
change in the same file did land, which is what made it look done. Added properly, with an assert this
time. The lesson is the edit style, not the missed string: a replace that cannot fail is a replace
that cannot tell you it failed.

Everything else behaved:

| Case | Result |
|---|---|
| `12345` | 422 `auth.too_short` — the new 6 minimum |
| `qwerty` | 422 `auth.too_common` — the widened dictionary, on this path too |
| the account's current password | 422 `auth.same_as_old` |
| a genuine new password | 200, `mfa_still_required: true` |
| the same token a second time | 422 `auth.reset_invalid` |

Worth noting the failed attempts did **not** consume the token — someone who fumbles the policy three
times still has their link. And `mfa_still_required` stays true, so a reset remains no substitute for
the second factor: a hijacked mailbox alone still opens nothing. Both are existing properties this
confirmed rather than added.

`test@example.com`'s password is now `reset-worked-2026` as a result of the walkthrough.
`npm run ci` green at 171 tests; the reset invariant suite green separately.

## 2026-09-20 (thirty-sixth) — how the first admin comes to exist

`scripts/bootstrapAdmin.ts` (D-024). A deployed installation had no way to make its first account:
Staff accounts requires a platform admin and there is none.

A script rather than an endpoint, because a bootstrap route cannot authenticate its caller — there is
nobody to authenticate against — so it would be a URL that mints an administrator. Database
credentials are a higher bar than anything HTTP could check, and there is no route left behind to
forget to remove. It refuses the moment any `platform_admin` exists, naming the one that does, so it
is safe to ship.

It takes a client and an event because `event_roles.event_id` is NOT NULL with a foreign key: on an
empty database there is nowhere to hang a role. It creates the first real event from the arguments
rather than inventing a placeholder that would haunt every listing.

**Verified on a throwaway database** — a fresh postgres with migrations and no seed, not the
development one. That is what caught the bug: `ON CONFLICT (name)` on `pmp.clients`, which carries no
unique constraint, failed with `42P10`. Reading the script would not have found it. After the fix:
the account is created with the role, the audit chain gets `admin.bootstrapped` with a null actor,
signing in reports `must_change_password: true` and `mfa_enrolled: false`, and every route is refused
with `auth.mfa_required` until enrolment. A second run refuses.

**An inconsistency this surfaced, recorded not fixed.** `rolesFor` selects roles with no event filter,
so a `platform_admin` on one event is a platform admin everywhere — storage is per-event, effect is
global. It is why granting on the first event suffices, and a trap: revoking on one event does not
revoke it. `event_roles` appears in no RLS policy so a nullable `event_id` would be contained, but
that is a migration and a grant-UI change, and belongs in its own decision.

CI green, 171 tests.

## 2026-09-20 (thirty-seventh) — roles are finally event-scoped

Fixed the inconsistency recorded in D-024 — and it was worse than "inconsistent". Roles were flattened
across events, so **any role on any one event granted that role's powers on every event**. Proved it
before touching anything: a content reviewer on one conference read a second conference's summary and
speakers. Different client, no link, no barrier. SRS §5 says isolation is mandatory, so this
contradicted the spec rather than an assumption of mine.

Enforced at `scopeFor` — the one place all eighteen event-scoped routes already pass through — so a
route written tomorrow inherits the rule rather than having to remember it. Refusal is
`auth.not_on_this_event`, 403. The global error handler was widened to render a typed 4xx faithfully;
it had been flattening everything into "Malformed request".

`platform_admin` stays platform-wide. That exception is necessary, not convenient: creating the first
event and granting roles on it cannot be done from inside an event, and `bootstrapAdmin.ts` relies on
it.

**A consequence the browser caught that the API probe had not.** With per-event scoping live, M. Vega
landed on `/no-access` — the portfolio lists every event and then fetches a summary for each, so a
manager on one event got a page of refusals. `GET /events` now returns only the account's own events.
Verified per role: admin sees 3, the two event-scoped accounts see 1 each.

`tests/invariants/event-scope.test.ts`, twelve cases over nine surfaces. Reverted the check and
re-ran to be sure they bite: **10 of 12 fail without it, 12 of 12 pass with it.** Full CI green;
invariants 48 pass, 0 fail.

Dev-database noise worth knowing: two probe events remain (`Cross-Event Probe 2026`,
`Event Scope Probe`). The second is the new suite's own fixture and should stay; the first resisted a
plain delete because of `event_days` foreign keys, and writing cascade-delete logic for dev noise was
not worth the risk. `npm run db:reset` clears both.

## 2026-09-20 (thirty-eighth) — an event switcher, and the end of the hardcoded event

Travis asked how staff work once there are five events. The honest answer was "badly", for three
reasons, all now fixed.

**The event-context line was a literal string** — `MedTech Fwd 26 · Day 2` in the JSX. With five
events the one element whose job is to say where you are would have been wrong on four of them. It is
now a switcher listing the events this account works on, with the day computed from today against the
event's dates — and the date range shown instead when today falls outside the run, because "Day -14"
is a confident lie.

**The sidebar fell back to the seeded event's id** when the URL had none. Harmless while one event
existed; a trap after D-025, because a staff member not on that event got a sidebar where every link
refused. Event-scoped links are now inert until an event is chosen.

**There was no switcher at all** — the only way to change event was back through the portfolio.

The switcher's list comes from `GET /events`, which D-025 already scoped: every event for a platform
admin, only their own for anyone else. Reusing that rather than adding a second query is the point —
one rule, one place to change it.

**Role granting per event already worked.** `POST /admin/users/:id/roles` has always taken an
`event_id`, and Staff accounts already had an event picker beside the role picker; with a single
seeded event it rendered as a one-option select and looked like nothing. Nothing needed building.

Verified against a real five-event installation with M. Vega holding `presentation_manager` on
MedTech Forward and `content_reviewer` on NeuroSummit: the portfolio shows her two events and not the
other three, the switcher offers exactly those two, choosing one lights all twelve event-scoped links,
and before choosing only Portfolio and Create event — the two that need no event — are live. The
platform admin sees all five. CI green; invariants 48 pass, 0 fail.

## 2026-09-20 (thirty-ninth) — creating events through the wizard, and a stale switcher

Created two events through the Create event wizard rather than by script, which is what found the
bug: **the event you had just made was missing from the switcher you were standing in.**

`CreateEventWizard` called `router.push()` and nothing else. The switcher's list comes from the
server layout, and Next caches that across a client navigation — so the new event was active, the URL
pointed at it, and the switcher still listed only the old ones until a full reload. Not a bug the
wizard had before: it had no event list to keep current until yesterday's switcher landed. Fixed with
`router.refresh()` alongside the push, and confirmed by creating a third event and watching it appear
already selected.

The wizard itself behaved well. It refuses to let invitations go out before the event has a day and a
room — "a speaker link would point at nothing" — and says plainly that a draft sends nothing to
anyone, which is the right reassurance at the moment someone is filling in real speaker-facing
details for the first time.

Three events now in the development database: MedTech Forward 2026 (5 rooms), NeuroSummit Spring 2026
and OrthoWorld Congress 2026 (3 rooms each, the latter on America/Chicago so a non-default timezone is
exercised). CI green.

## 2026-09-20 (fortieth) — Staff accounts answers "who is on this event?"

The screen could only answer one question — what can this person reach — and an administrator
staffing an event has the opposite one. Added a **Who is on each event** view, which is the default,
with the account list still a click away.

**The reason it is the default is what it shows when nothing is there.** With three events in the
database, two came up `nobody assigned yet`. That state was previously invisible: an event nobody can
work on looks exactly like a healthy one from a list organised by person, because an absence has no
row of its own to appear on. An administrator could create an event, move on, and find out from the
silence.

No API change — `listStaff` already returned each assignment with its event id and name, so this is
the same facts read the other way round.

**Two smaller fixes in the same screen, both about avoiding a quiet mistake.** The event select on
each row defaulted to whichever event happened to be first, so the quickest path — pick a role, press
grant — assigned it on an event nobody chose; on this screen that mistake surfaces later as someone
reading another client's material. It now starts blank and refuses with "Pick which event this role
is on." And an account with no roles said "no roles", which understates it: such an account is
refused every screen in the product, so it now says so.

Verified through the UI: the guard refuses, a real grant of `content_reviewer` on NeuroSummit
succeeds, and both views update together — M. Vega shows two events with different roles in the
account list, and appears under NeuroSummit in the event view. CI green; admin invariants pass.

## 2026-09-20 (forty-first) — assigning several roles at once

Travis asked for multiple roles per person per event. **Checked first: it already worked.**
`event_roles` is keyed on (user, event, role), `grantRole` inserts one of those, and granting twice
with different roles was already accepted — verified against the API, including that re-granting a
role already held is idempotent rather than an error. What was missing was doing it in one go, and a
single-choice dropdown implying it was one or nothing.

The role picker in Event assignments is now checkboxes: tick every hat someone wears on that event
and assign once. The button counts what it is about to do ("assign 2 roles"), so there is no doubt
before pressing it.

**Roles already held come back ticked and disabled**, captioned "Already holds this role here". Worth
the extra state: without it an administrator re-opening the row cannot tell what is already true from
what they are about to add, and the obvious reading — an empty box means they do not have it — would
be wrong.

Grants run sequentially rather than in parallel, so a failure part-way names the role it failed on
instead of losing it in a race.

Verified through the UI: picking a person reveals eight checkboxes, ticking SRR technician and room
technician and pressing assign gives C. Delgado both on OrthoWorld in one action, the form resets, and
re-opening the row shows both ticked and locked. CI green; admin invariants 8 pass.

## 2026-09-20 (forty-second) — Admin becomes two pages

`/admin/assignments` and `/admin/users`, one job each, both in the sidebar under ADMIN and both gated
to `platform_admin` / `project_manager`.

Splitting by the question rather than by the data: placement is asked while staffing an event,
account administration is asked about a person. Carrying both on one screen put controls for the
first onto every row of the second.

`StaffAdmin.tsx` became `StaffAccounts.tsx` and `EventAssignments.tsx`. The panels were carved out on
exact string anchors rather than line numbers so no JSX was retyped in the move — and **lint proved
the split was clean**: it immediately reported `setStaffRole`, `EVENT_ROLE_NAMES` and the `events`
prop as unused in the accounts half, which is precisely what should fall away when the assignment work
leaves. The accounts page no longer fetches `listEvents` at all.

Cross-links both ways — "‹ event assignments" from the accounts header, "change assignments" on each
account row. Verified in the browser: 8 links across, 0 assignment controls remaining on the accounts
page, both pages 200.

Logged in `VISUAL_ACCEPTANCE.md` §5, since §2.1 fixes the sidebar's screen list and ADMIN now has two
entries. CI green, 171 tests.

## 2026-09-20 (forty-third) — Staff accounts drops the roles column

The column that started this thread is gone. Staff accounts is now Account · Status · Last sign-in ·
actions, and every row fits a single line — seven accounts read at a glance where they previously
needed scrolling past stacked assignment lists.

Nothing is lost: the same facts live on Event assignments, grouped the way the question is asked, and
the header carries a link across. Sidebar order is now Staff accounts then Event assignments, matching
where an administrator starts.

CI green, 171 tests.

## 2026-09-20 (forty-fourth) — one line per person, roles side by side

`byEvent` paired (person, role), so someone holding three roles occupied three rows and read as three
people at a glance — A. Whitfield appeared three times under MedTech Forward. It now groups by person
and carries every role they hold on that event. MedTech went from nine rows to six.

**Each role keeps its own remove**, as a `×` beside its chip rather than one button at the end of the
line. They are removed one at a time, and taking someone off room sync should not also take them off
review. Verified rather than assumed: removing `project manager` from A. Whitfield left
`platform admin` and `presentation manager` untouched.

The already-held check behind the assign checkboxes was updated with it — it asked whether a paired
entry matched the role, and now asks whether the person's role list contains it. Missing that would
have left roles wrongly unticked and re-grantable, which is harmless but confusing.

CI green, 171 tests; admin invariants 8 pass.

## 2026-09-20 (forty-fifth) — the invariant suites take their accounts away again

Three resets in a session were all for the same reason: `npm run test:invariants` left `probe-…`,
`roleless-…`, `reuse-probe-…` and `reset-probe-…` accounts behind, and the only way to clear them was
wiping the database — which took the events and assignments with it every time.

The suites create their own accounts deliberately, and should keep doing so: a test that changes
`m.vega`'s password breaks whichever other suite signs in as her. Only the removing was missing.
`tests/helpers/cleanup.ts` plus an `after()` hook in each of the three suites that creates accounts.

**Not every referencing row is alike, and the helper says so.** Twenty-one tables have a foreign key
to `pmp.users`. Sessions, MFA challenges, recovery codes, reset tokens, role grants and client grants
are *state about* an account and go with it. Audit records, comments and workflow transitions are
*records of what happened* — deleting those to tidy a list would be erasing history to make a screen
look neater. So the helper removes the first kind, and if anything of the second kind still holds the
row it rolls back to a savepoint and **deactivates instead of forcing the delete**. An account that
did real work stays, visibly retired.

**A guard, not a formality:** cleanup refuses unless `PGDATABASE` matches `pmp_dev` or `pmp_test*`.
This deletes user rows, and the only thing between a test run and someone's real data is which
database the environment points at. Verified it refuses `pmp_production`, `pmp` and `rfpilot`, and
allows `pmp_dev` and `pmp_test_ci`.

Verified end to end: 5 accounts before, full suite run (51 tests, 48 pass, 0 fail), 5 accounts after —
the same five, all still active. CI green.

## 2026-09-20 (forty-sixth) — test events clean up too

The account cleanup left a gap I had claimed closed: `event-scope.test.ts` creates an "Event Scope
Probe" event to prove a role on one event is not a role on another, and that event stayed — sitting in
every portfolio and every switcher. `removeTestEvents` now takes it away on the same terms as the
accounts.

**The first attempt archived it instead of deleting it, and the fallback is why that was visible
rather than silent.** Something still referenced the row, so the helper rolled back to its savepoint
and archived. Chasing it down: `communication_templates`, two rows — "Upload invitation" and
"Reminder — file still missing" — copied onto every new event at creation. That is configuration, not
history: mail actually sent lives in `communications` and `communication_events`, which the helper
does not touch. Added to the structural list, and the event now deletes cleanly.

Worth keeping the distinction in mind, because the table name invites the opposite conclusion. An
event that really did write to a speaker still fails the delete and gets archived, which is the
intended outcome.

Verified across a full run: 3 events and 5 accounts before, 3 and 5 after, all still active.

**Unrelated flake seen while testing, recorded not fixed.** One run reported 15 skipped where the next
reported 3. The suites skip themselves wholesale when sign-in fails in `before()`, and they share one
development TOTP secret — the server refuses a replayed code, so concurrent suites can starve each
other of a usable one. `pass 36 / fail 0 / skipped 15` reads as success and is not: a skipped suite
tested nothing. The `freshCode` helper already waits for a step boundary; it evidently is not enough
under full parallelism.

## 2026-09-20 (forty-seventh) — the invariant suites stop skipping themselves

Two problems, and the second was the dangerous one.

**The contention.** `freshCode` serialises TOTP steps in module-level state, which only holds within
one process — and Node runs each test file in its own. `mfa_last_counter` is per account, and
`admin@example.invalid` is signed in from four call sites across the suites, so two files starting in
the same 30-second step collided and the loser got its code refused. `signInStaff` now waits out the
step and retries, up to three attempts.

**The silence.** A failed sign-in set `up = false`, so the suite skipped every test in the file and
the run reported `fail 0`. That is worse than a failure: a green summary while nothing was tested. A
skip is right when the API is not running; it is wrong when the API answered its health check and
sign-in failed anyway. `signInStaff` now throws with the status and code, distinguishing a rejected
password — which will not improve with waiting — from a refused second factor, which will.

**Proved by forcing the race**, not by re-running and hoping: four concurrent sign-ins as the same
account, launched together, all succeeded — staggered at 0s, 12s, 42s and 72s as each took the next
step. Before this, three of the four returned empty and would have skipped their suites.

Two consecutive full runs: 48 pass, 0 fail, 3 skipped both times. The three remaining skips are
honest — those tests read the password-reset link out of `.data/mail`, which only the file transport
writes, and the dispatcher is currently on SES. They cannot verify a link they cannot read, and say so.


## 2026-09-21 (forty-eighth) — the agenda builds the event, and three bugs under the floorboards

Travis supplied DXG's actual agenda file — the Preseria import template, `v.1.3` — and asked for the
create-event wizard to drop its "Rooms & tracks" step and import a schedule instead. D-026.

**The manual step was worse than redundant.** `commitImport` already created rooms, tracks and event
days from a committed agenda, and that code is untouched by this change. Typing rooms in first did not
save the work; it created a second list the spreadsheet then had to agree with, and `buildPreview`
treats an unrecognised room as a **blocking** error once an event has rooms. A project manager who
typed `Ballroom B` and was sent `Ballroon B` got a blocked import on data they did not author. Step 2
is now `ImportView` itself, embedded — the same component as screen 3, with an `embedded` flag, rather
than a second copy that could drift from it.

Step 2 is skippable on purpose. The button reads **Skip for now ›** until something is imported and
**Save & continue ›** afterwards. An event can still reach `active` with no rooms, which the wizard
could not previously produce; that is a real reduction in what `active` tells you, and it is accepted
because a mandatory step traps anyone who opens the wizard before the spreadsheet exists. The guard
that matters — `comms.event_incomplete` — is unchanged.

**The import could not read DXG's file, and reading the code would not have told me so.** Running it
did. The template opens with a banner row, puts the real headers on row 2 and two annotation rows
(`max 255 chars.`, `REQUIRED`) beneath them:

- `buildPreview` destructured `const [headers, ...dataRows] = sheet`, so it mapped the banner as the
  header row and validated `REQUIRED` as a session title. `findHeaderRow` now scores the first rows
  against the field synonyms and drops annotation rows below the winner.
- **Every blank header matched.** `normalise("")` is `""` and `"".includes("")` is true, so under the
  substring pass the banner's ten empty cells claimed `session.title`, `room.name`, `session.start`
  and the rest, in order.
- **`Presenter 1 Email` mapped to `speaker.name`**, because the substring pass tried `speaker.name`
  first and the header contains "presenter" — then `Presenter 2 Email` took `speaker.email`. The
  platform would have filed presenter 1's address as a display name and **sent every upload invitation
  to the second presenter**. A decisive-keyword pass now runs first, and a header whose keyword is
  already taken maps to nothing rather than falling through: an unmapped column gets noticed and
  fixed, a wrongly mapped one does not.

**Then two more, neither of which any existing test could have caught.**

**Every session imported a day early, on this machine and not in production.** `toDateTime` built its
date with `new Date(value).toISOString().slice(0, 10)` — an instant resolved in the server's timezone,
read back in UTC. Here (Asia/Dhaka, UTC+6) `05/16/2023` came back as `2023-05-15`, and `03/01/2026`
rolled back to `2026-02-28`. The first end-to-end run put the whole agenda on the 15th and that is the
only reason it was seen. `toCalendarDate` reads the parts with the clock that parsed them. Proved by
writing the five cases first and watching four fail.

**Schedule import has never worked from a browser.** The upload sends the filename in `x-file-name`;
`Access-Control-Allow-Headers` listed only `content-type, authorization`, so Chrome refused the
preflight and the request was never sent. This is not new — screen 3 has shipped with it — and it
survived because every test of the import has run from a script, where CORS does not exist. Found by
handing the real file to the page's own file input through `DataTransfer` and reading the console.
`tests/invariants/cors.test.ts` now asserts the preflight for each custom header the web apps send.

**`removeTestEvents` could not delete an event with a schedule.** `sessions.room_id` references
`rooms`, and rooms were deleted first — `sessions_room_id_fkey`. No test event had ever had an agenda
before; now every test that walks the wizard will. The table list is ordered child-first.

Verified end to end rather than asserted: 11 rows, 0 blocking, 8/14 columns auto-mapped, committed to
1 room (`Virtual`, created by the file), 1 event day `2023-05-16`, 11 sessions, 1 speaker and 11
assignments, first session 08:00 America/New_York. Re-importing the same file: 0 created, 0 updated,
11 unchanged, no duplicates. Then the same file through the browser, in the wizard: upload → preview →
`Import 11 sessions` → the button flips to Save & continue → step 3 shows `Rooms: Virtual`.

CI green, 187 unit tests (was 171); `test:invariants` 53 pass, 0 fail, 0 skipped — the three
password-reset skips pass here because this run uses the file mail transport. Probe events removed,
no orphaned sessions or speakers.

**The committed fixture is synthetic.** `tests/fixtures/preseria-v1.3.csv` reproduces the template's
structure exactly — banner row, headers on row 2, two annotation rows, `mm/dd/yyyy`, `h:mm AM/PM`,
an email column with the name columns empty, a quoted title containing commas — with invented
sessions and `presenter@example.invalid`. The file Travis supplied carries a real presenter's
address and a real conference's session titles, and BUILD_SPEC §17 forbids committing client
content as a fixture. The structure is what the tests exercise; the content was never the point.

**Left undone, deliberately.** Only presenter 1 is imported; the template's presenter 2 columns are
recognised and left unmapped rather than silently dropped, because a second presenter is a speaker
assignment and the import screen is not where that is decided. **Worth telling DXG:** their template's
eleventh column is labelled `Presenter 2 Last Name` but sits between `Presenter 1 First Name` and
`Presenter 2 Email` and is marked REQUIRED — it is presenter 1's surname, mislabelled. The mapper
lands on the right field by first-occurrence, so the file imports correctly, but the label is wrong at
source and should be fixed there.

## 2026-09-21 (forty-ninth) — an incomplete agenda is finished on the screen, and the import becomes mandatory

Travis imported a schedule, found mandatory fields missing, and asked for three things: let the user
fill them in, refuse to let the event proceed on a half-imported schedule, and hand out a template
they can fill in and upload. D-027, which supersedes D-026's skippable clause.

**Step 2 now blocks steps 3 and 4.** D-026 made it skippable and I flagged the cost; Travis reversed
it, and the replacement reasoning is better: the rooms, days and sessions of an event *are* the
agenda, so an event without one is not partly configured, it is empty. The rule is enforced on the
forward button **and** on the step chips — a chip is a navigation control, and a rule on only the
button is a suggestion with a way round it. The "opened the wizard before the spreadsheet existed"
case is answered by the draft persisting and by the template.

**Missing values are filled in the preview table.** Each staged row now reports which of
`session.title`, `room.name`, `session.date`/`session.start` it has no usable value for, and an input
appears in exactly those cells — nothing else becomes editable, so there is no hunting through a row
for what is wrong. An unreadable date counts as missing: the cell is there, nothing usable came out.

**Corrections are cell values re-validated on the server**, via `POST /imports/{uploadId}/cells`. The
obvious alternative — patch the staged row in the browser — would have meant a second implementation
of the date parsing and the venue-timezone conversion in client code, which is precisely what was
silently a day out until yesterday. It would also have left the diff wrong: changing a room or a time
changes the `(room, start, title)` match key, so `create` vs `unchanged` has to be recomputed, and only
the server can. An override is read at the one point every field is pulled from the row, so a typed
cell is indistinguishable from the file having said it.

**The blank template is generated from the importer's own field list**, not stored as a file, so it
cannot offer a column we do not read or omit one we now require. It deliberately mirrors the vendor
template's shape — banner, headings, format hints, REQUIRED/OPTIONAL, one example row — because that
is the layout DXG works in, and because it then exercises the same `findHeaderRow` path as the files
we actually receive rather than testing an easy case forever. The example row is marked `EXAMPLE` and
dropped on import, so filling the sheet in underneath it does not create a session called
"EXAMPLE — delete this row".

**Our own template caught a mapping bug of yesterday's family.** `Presenter Organization` mapped to
`speaker.name` — the substring pass tries `speaker.name` first and the header contains "presenter" —
so the organization became the display name and the correctly-mapped first/last name columns were
discarded by the `speaker.name ||` precedence. "Dana Reyes" imported as "Example Institute". **The
round-trip test I wrote an hour earlier did not catch it, because it asserted only the required
columns and the email.** It now asserts every column against the field its heading names, and
`organization` joined the decisive-keyword list.

**Two more on the same screen, fixed in passing.** The preview rendered every session time in a
hardcoded `America/New_York`, so an event in Berlin showed New York clock times — the preview now
carries the event's timezone. And `Download error report` raised a toast listing row numbers; it now
downloads the CSV `SCREEN_SPECS` §3 describes.

**A React defect of my own, found by driving the page.** `Fix` was declared inside `ImportView`, so it
was a new component *type* on every render and React remounted the input each time the preview
changed, discarding what had been typed. Moved to module scope and keyed on the server's value.

**One thing I got wrong twice before getting it right.** The first two attempts to verify the edit in
the browser failed and I twice suspected my own code. It was the harness: the `computer` type action
left the field without focus, so `.blur()` was a no-op and the handler never fired. A genuine
`focus()` + `blur()` committed immediately, and a real user's click does the same. Worth recording
because the conclusion "the feature is broken" was wrong both times, and the thing that settled it was
calling React's own `onBlur` prop directly to separate my logic from the event plumbing.

Verified end to end: a file with one good row and three broken ones reports `missing` per row,
refuses to commit naming rows 3/4/5, accepts three typed corrections that accumulate, converts a
corrected `03/14/2027 3:00 PM` to `2027-03-14T19:00:00Z` (EDT), and then commits 4 sessions. In the
browser: steps 3 and 4 show `not-allowed` with "Import the schedule first", the forward button is
disabled with a reason, two values typed into the table persisted to the database as
`Typed On The Screen` / `Ballroom C`, and once complete the import committed and every chip unlocked.
The template round-trips: downloaded, filled, re-uploaded, 0 missing, 0 columns mapped by hand,
`Dana Reyes` intact.

`tests/invariants/schedule-import.test.ts` (8 cases) proved by reverting the override application:
**3 of 8 fail without it, 8 of 8 with it.** CI green, 194 unit tests; invariants 61 pass, 0 skipped.
Probe events removed, no orphans.

## 2026-09-21 (fiftieth) — the mapping table goes, the data speaks for itself

Travis: "remove this column mapping, we need to show the imported data properly." D-028.

**Why it deserved to go, beyond the clutter.** The card made every operator audit the mapper's work on
every import, in the mapper's vocabulary (`speaker.email`, `room.name`), before they were allowed to
look at their own agenda — and it was a weak check anyway. `session.title ✓` says a column was mapped,
not that it was mapped *correctly*. **Both mis-mappings this project has actually hit** —
`Presenter 1 Email → speaker.name` and `Presenter Organization → speaker.name` — **would have shown a
full row of ticks.** What catches those is seeing an email address where a presenter's name belongs,
which is exactly what the table now shows.

The preview is now "Sessions read from `<filename>`", with Row · Session · Room · Date · Time ·
Presenter · Track · Action. Presenter carries name over address over organization; time shows a range.
The inline inputs from D-027 still appear in place of whichever cell is missing.

**One piece of the old card survives, and it is the piece doing real work.** Those selects were also
the only way to correct a heading the mapper did not recognise. Deleting them outright means a file
whose room column is headed `Whereabouts` has *every* row missing a room, an input in every one of
those cells, and no way to say once what the column is. So a scoped repair remains: when a **required**
field has no column at all, one select per missing field — "Which column is this?" — and choosing
re-reads the file. On a file we understand it does not appear at all.

Said plainly, because it is a real narrowing: optional fields are no longer re-mappable, and a column
mapped to the *wrong* field can no longer be corrected directly — only by the per-cell edits from
D-027, or by fixing the heading and re-uploading.

**Two display faults fixed with it,** both making correct data look wrong. A file with no end-time
column gets `ends_at = starts_at` from the importer, which rendered `09:00–09:00` — a zero-length
session rather than an unknown end. And a presenter with an address but no name rendered `— address`,
which reads as a missing value beside a present one instead of the one fact we have. Both were only
visible by looking at the rendered table, not the code.

**Lint proved the removal was clean**, the same way the Admin split did in the forty-second entry: it
immediately reported `IMPORT_FIELDS` and the old combined `time()` helper as unused, which is exactly
what should fall away when the mapping table leaves.

Verified in the browser: a well-understood file shows no mapping card and two rows reading
`Opening Keynote · Ballroom A · Mar 14 · 09:00–10:00 · Dana Reyes / dana@example.invalid /
Example Institute · Plenary · create`. A file with `Whereabouts` instead of a room heading shows
"Which column is this?" with a select listing every source column; choosing `Whereabouts` re-read the
file, filled both rooms, cleared the banner and enabled import. A row with no end time shows `10:30`
alone, and a presenter with no name shows the address without a leading dash.

CI green, 194 unit tests. Probe events removed.

## 2026-09-21 (fifty-first) — the template becomes DXG's own sheet

Travis: "blank demo template doesn't match with the example session data, we need to every field same as
like that", with the Preseria sheet attached again. D-029.

The generated template offered ten columns of our own choosing. It now reproduces the Preseria import
template v.1.3 column for column — the same fourteen headings in the same order, the same format-hint
row, the same REQUIRED/OPTIONAL row. Organisers receive that sheet, fill it in and send it back; a
template with different column names is a second format to reconcile, not a help.

**Carried and deliberately unmapped:** `Presentation Start`/`End`/`Duration` describe a presentation
*inside* a Preseria session, and this platform's schedule is sessions and slots with no equivalent, so
folding them into the session's own times would be inventing a meaning. The `Presenter 2` columns are
recognised and unmapped because only presenter 1 becomes the assigned speaker. Carrying them
named-but-unmapped is deliberately different from dropping them — the operator can see the column was
read and not used.

**One heading is corrected, and it is the only deviation.** DXG's eleventh column is labelled
`Presenter 2 Last Name` but is presenter 1's surname: it sits between `Presenter 1 First Name` and
`Presenter 2 Email` and is marked REQUIRED where every presenter 2 field is optional. Reproducing the
wrong label in a template *we* hand out would invite organisers to put the second presenter's surname
in the first presenter's column — a fault we would be manufacturing rather than inheriting. Ours reads
`Presenter 1 Last Name`, and a test asserts DXG's original label maps identically so files already in
circulation cannot regress. **Confirmed by Travis** when the byte-identical alternative was offered as
a one-word change — so the one-cell difference from Preseria's sheet is a decision, not drift, and
should not be tidied away by whoever next notices it.

**Dropped:** `Track` and `Presenter Organization` are no longer offered, because DXG's sheet has
neither. The importer still reads both if a file supplies them.

Verified against the real file rather than a description of it: headings compared cell by cell against
`Preseria Import Sheet - Sessions and Presentations.csv` — 13 of 14 identical, the fourteenth the
deliberate correction; hint row identical; REQUIRED/OPTIONAL row identical bar their own inconsistent
casing (`Optional` in columns 12–14, `OPTIONAL` in 6–8; ours is uppercase throughout and the parser is
case-insensitive); **auto-mapping identical for both sheets**. Live against the running API: template
served as `text/csv`, filled in and re-uploaded gives 2 rows / 0 incomplete / 0 warnings with
`Dana Reyes` and `Sam Ito` intact and 8:00 AM reading as `12:00Z` (EDT); DXG's own sheet with the
original mislabel still imports 11 rows / 0 incomplete with column 11 mapping to `speaker.last_name`;
a blank template imports nothing (`import.empty`).

**The invariant suite caught my own stale fixture,** which is the whole reason it exists: it still
filled the template in the *old* ten-column layout, so `Example Institute` landed in the first-name
column and the assertion that the presenter is `Dana Reyes` failed. Nothing wrong with the code — the
test row had to move with the template. Updated to the fourteen-column order.

CI green, 196 unit tests; invariants 61 pass, 0 skipped. Probe event removed.

**A note on the run, not the code.** Docker Desktop hung mid-verification and the API went unreachable
with its ports still listening — `curl` returned 000 and `docker ps` never returned. Nothing to do with
this change; recorded because "the API is down" looked at first like something the work had broken.

## 2026-09-21 (fifty-second) — the validation list goes; problems move onto the row

Travis, with a screenshot of eleven identical validation paragraphs: show it in the data table, colour
the bad rows, put an Edit action on them, and open a modal with the whole row in it. D-030.

**The card scaled with the wrong thing.** One paragraph per issue meant eleven sessions with no
presenter name produced eleven copies of the same sentence, stacked above a table that already had
eleven rows. The facts were real; the presentation made them worthless — nothing distinguished the rows,
the list was longer than the data it described, and every row number was a cross-reference the reader
had to resolve by hand.

Now: a blocked row is filled with the blocking colour, a warned row with the warning colour, and both
carry **Edit** beside the status chip. **Two colours, not one** — a blocked row stops the import and a
warned row does not, and colouring them alike would repeat the card's mistake in a different form.

**The modal replaces D-027's inline inputs, and is better for a reason that only showed up in use.**
An input rendered into the offending cell is direct, but it shows a value with nothing around it: an
operator typing a room cannot see the session it belongs to or the date beside it, which is exactly the
context needed to know *which* room it should be. The dialog states the row's problems, marks missing
fields `· required`, and shows all ten mapped fields as the evidence. `StagedRow` gained `cells` — every
mapped field's current value — which replaced the ad-hoc `date_cell`/`start_cell`/`end_cell` trio.

**One request per row.** `/cells` now takes `{row, cells}` as well as `{row, field, value}`. Three fields
as three requests would re-read the file three times and let the responses race — last to arrive winning
rather than last edit made. Save is refused while any required field is still empty.

**Lint caught a capability I was about to drop silently.** Removing the card left `applySuggestion`
unused — the "Room 'Ballroon B' … closest match: Ballroom B" one-click fix, which SCREEN_SPECS §3 calls
for. It moved into the editor as a button next to the box it fills, rather than disappearing with the
card that happened to host it. A sloppy slice of mine also took `blockingRows` and `unmappedRequired`
out with it; type-check named all three before anything ran.

Verified in the browser with a file carrying one clean row, one warning-only row and two blocked rows:
validation card absent, backgrounds `rgba(0,0,0,0)` / amber 12% / red 12% / red 12%, three Edit buttons
on exactly the three problem rows. Opening row 5 showed all ten fields populated
(`Bad Date Here` / `Ballroon A` / `not-a-date` / `3:00 PM` / … / `rae@example.invalid`), the message
"Could not read a date and time from 'not-a-date 3:00 PM'", and `· required` on date and start. Typing
a date enabled Save; saving closed the dialog, cleared row 5's colour and Edit button, and moved the
banner from "2 of 4" to "1 of 4".

The multi-cell save is proved by reverting it: **the new test fails without it and passes with it.**
CI green, 196 unit tests; invariants 63 pass, 0 skipped.

Also fixed: the banner still said "fill the highlighted boxes … each one is checked as you leave it",
which described the inputs that no longer exist. It now points at Edit.

**Not mine:** an event called "Test Event 1" (draft, created 05:40 UTC today) is in the database and was
left alone.

## 2026-09-21 (fifty-third) — the row editor becomes the sheet row, and two silent defaults die

Travis, on the editor: columns still missing (session location, session start/end, presentation
start/end/duration), add a second presenter, drop the organization. D-031.

**Half of "missing" was mislabelling.** `Session Location`, `Session Start` and `Session End` were all
on screen — as "Room / location", "Start time" and "End time". Same fields; to someone holding the
spreadsheet they were filled from, different ones. The editor now uses DXG's own headings throughout,
grouped Session / Presentation / Presenter 1 / Presenter 2.

**The other half was genuinely absent, and I would not put editable boxes on screen for data with
nowhere to go.** `slots` carried only `position`. A Preseria presentation inside a session is exactly
what a slot is, so migration `010_slot_times.sql` adds nullable `starts_at`/`ends_at` with a
`CHECK (ends_at >= starts_at)` — additive, and a slot with no time of its own runs with its session,
which was the only case that existed before. Duration is minutes and is consulted only when no end
time is given: a sheet carrying both and disagreeing means the published end wins.

**A second presenter is a second `speaker_assignments` row on the same slot**, which that table has
always allowed and the import never used. Two people presenting one talk share the talk, its file and
its approval. D-026 and D-029 both said this was not the import screen's decision; Travis has now made
it. Collapsed behind **+ Add another presenter**, opening by itself when the file already names one,
and **Remove clears the fields as well as hiding them** — a hidden box holding a value the operator
thinks they deleted is how a wrong presenter gets imported.

**Position decides which presenter a column belongs to, not the number in the heading.** Forced by
D-029: DXG's sheet labels presenter 1's surname `Presenter 2 Last Name`, so matching on the ordinal
would file it under presenter 2 and leave presenter 1 with no surname — worse than before presenter 2
existed. First email column is presenter 1's, second is presenter 2's, whatever the headings say.
Both sheets then map identically; two tests hold it.

**Two defects, both found by running the importer and reading the output.**

`toDateTime` defaulted a missing clock to 09:00. On the optional `Presentation Start` that gave a slot
time to every row leaving it blank — which is how I noticed: "Closing", with both presentation cells
empty, came back with a slot starting at 9:00 AM. Chasing it found the worse case: on `Session Start`
a blank cell produced a usable `starts_at`, so the row passed the required-field check that the
template's REQUIRED row, `REQUIRED_FIELDS` and the row editor all promise to enforce. **`Session Start`
was never actually required.** Four cases written first, one failed, fixed.

And `session` alone was a synonym for `session.title`, so on a sheet with no explicit title column
`Session Start` claimed the title on the substring pass. My own new test exposed it. Session times are
decisive now, checked after the presentation ones so the qualifier settles which time a column is.

Verified end to end: a three-row file mapped all fourteen columns (including DXG's mislabelled
eleventh to presenter 1's surname and the real presenter 2 block to `speaker2.*`), and the database
holds `Panel On Imaging` session 09:00–11:00 / presentation 09:30–10:15 / **Dana Reyes + Sam Ito**,
`Lightning Talk` 11:35–11:55 from a 20-minute duration with no end time, and `Closing` with no
presentation time at all. In the browser the editor shows all four groups under the sheet's headings,
`+ Add another presenter` adds the Presenter 2 block, and Remove takes it away.

CI green, 206 unit tests; invariants 63 pass, 0 skipped. Probe events removed.

## 2026-09-21 (fifty-fourth) — pickers, one line per group, no Track

Travis on the editor: presentation start/end/duration on one line, time pickers, duration as a
5-minute slider, presenters' name and email on one line, session info on one line, drop Track. D-032.

Fifteen identical text boxes in a two-column grid, scrolling. Now a line at a time — title and
location; date, start and end; the presentation's three; each presenter's three — with the control
chosen per field.

**Times are `<input type="time">`, the date `<input type="date">`.** Both hand back values the importer
already reads — `HH:MM` satisfies the clock rule, ISO satisfies `toCalendarDate` — so no parsing changed
to accommodate them. **The date picker was not asked for**; included because it is the same one-line
change against the same mistake, and mm/dd/yyyy typed by hand is the most error-prone cell in the sheet.
Trivial to revert.

**A picker cannot show what it cannot parse, and blanking it would destroy the evidence.** A cell
reading `half past three` has no representation in a time input; rendering an empty one would silently
discard the thing the operator opened the row to fix. `toTimeInput`/`toDateInput` return null for such a
value and the field falls back to a text box holding it, outlined in the blocking colour, with "Not a
time we can read — clear it to use the picker." Verified: that row shows `type=text`, value
`half past three`, and the note.

**The slider goes to 240, not the template's 999.** Five-minute steps over 999 minutes is two hundred
positions to land on 45. A file carrying more is **shown, not clamped**, with a note and a Clear button
— silently rewriting an operator's data to fit our control is the one thing a picker must never do.
Zero means "not set", so the slider at rest and an empty cell agree.

**Track is gone from the editor** — DXG's sheet has no such column, so it was a box nobody could fill
from the file in front of them. The importer still reads a Track column when a file has one, and an
existing value survives editing because only changed cells are sent.

Verified end to end: the modal shows `date`, `time`, `time`, `time`, `time`, `range` and text inputs in
the right places with `03/14/2027` rendering as `2027-03-14` and `1:00 PM` as `13:00`; no Track;
filling a title, setting `13:15` on the presentation time picker and dragging duration to 45 saved in
one request and cleared the row. After import the database holds `Filled Through The Pickers` with
session 13:00–14:00 and presentation **13:15–14:00** — the end derived from the slider — alongside
`Panel On Imaging` 09:30–10:15 with Dana Reyes + Sam Ito, and `Bad Time` running with its session
because its start was unreadable.

CI green, 206 unit tests; invariants 63 pass, 0 skipped. Probe event removed.

## 2026-09-21 (fifty-fifth) — presenters become a list; the editor's groups are boxed apart

Travis: can't add presenter 3, duration should default to 5, separate the session / presentation /
presenter sections, narrow the modal. D-033.

**`speaker2.*` was a second set of fields bolted beside the first, so there could never be a third.**
Presenters are a list now — `PRESENTER_PREFIXES` generates the fields, `buildPreview` collects everyone
a row names into `StagedRow.presenters`, and the commit loops over them. Six is the cap: the schema
would take any number, but the mapper, the template and the editor each have to enumerate them, and six
is already three times what any DXG sheet has carried. A seventh column maps to nothing rather than
silently becoming the sixth.

**Removing a presenter shifts the ones below it up.** Clearing in place was easier and wrong: it would
leave presenter 3's details in a block the next render labels "Presenter 2", or leave a hidden block
still holding a name — which is how someone nobody meant to keep gets imported. Proved in the browser
by filling three, removing the middle, and watching `Third` move into presenter 2's slot; the import
then wrote exactly the two that remained.

**A bug the naive generalisation introduced and the loop made obvious:** `row.organization` applied to
every presenter, putting presenter 1's employer against the name of each co-presenter. DXG's sheet has
one organization column and it sits inside presenter 1's block, so it is presenter 1's.

**Boxed, not merely headed.** A heading over a continuous run of inputs still reads as one long form,
and this form has two sets of times in it — a session's end and a presentation's start sat adjacent and
looked like the same kind of thing.

**Slider floor is 5**; "not set" stays reachable through Clear and is still what an untouched slider
means. Dialog down to 560px, and three-up lines survive it by wrapping on `auto-fit` with a floor
rather than being crushed — one line at 560, two on a phone, no breakpoint.

**Found by looking at the screenshot rather than the code:** with the slider and `Clear` sharing a
third of 560px, the button was clipped off the edge of the dialog. Moved onto the label line and
checked by measuring its rect against the dialog's.

Verified end to end: a three-presenter file mapped all three blocks and the database holds `Panel Of
Three` with Dana Reyes + Lee Ng + Sam Ito on one slot; the edited row holds the two that survived the
remove. Adding stops at six and the button disappears.

CI green, 208 unit tests; invariants 63 pass, 0 skipped. Probe events removed.

## 2026-09-21 (fifty-sixth) — presenter fields lose the ordinal they already have

Travis: label them name and email, not "Presenter 1 Name", under each presenter.

The block is titled "Presenter 2" and then said "Presenter 2 First Name", "Presenter 2 Last Name",
"Presenter 2 Email" inside it. Visible labels are now `First Name` / `Last Name` / `Email`.

**The accessible name stays fully qualified.** A short visible label inside a longer accessible one is
what WCAG 2.5.3 asks for, and it keeps a field unambiguous when a screen reader reads it out of the
block's context — `aria-label="Presenter 2 Email"` over a visible `Email`. The session and presentation
fields are unchanged, since nothing above them repeats their names.

Verified in the browser: visible labels read `First Name` / `Last Name` / `Email` twice over, while the
six inputs report accessible names `Presenter 1 First Name` … `Presenter 2 Email`.

CI green, 208 unit tests.

## 2026-09-21 (fifty-seventh) — the Presentation box drops its ordinal too

Same as the fifty-sixth, for the Presentation group: it was headed "Presentation" and then said
"Presentation Start", "Presentation End", "Presentation Duration" inside it. Now `Start` / `End` /
`Duration`, with the accessible names still fully qualified (`Presentation Start`,
`Presentation Duration in minutes`).

**The Session box is deliberately not changed**, and the asymmetry is the point: `Session Start` and
`Presentation Start` are the two fields in this dialog most easily confused, and shortening both would
leave the box heading as the only thing telling them apart. Left as a choice rather than an oversight,
so it is not "tidied" later.

Verified: visible labels read `Start` / `End` / `Duration`; the three inputs report
`Presentation Start`, `Presentation End`, `Presentation Duration in minutes`.

CI green, 208 unit tests.

## 2026-09-21 (fifty-eighth) — the cross-event hole, closed properly

The defect found at the top of this session and left open since. D-034, superseding the half of D-025
that was finished.

**D-025 protected the routes that name an event and left the ones that name a resource.** Eighteen
`/events/{eventId}/…` routes passed through `scopeFor` with an event to check; twenty called
`scopeFor(req)` with nothing. Reproduced before the fix, with an account holding no role on the event:
the three parent surfaces returned 403 while `/slots/{id}`, `/file-versions/{id}/findings` and
`/file-versions/{id}/comments` returned 200 and an internal comment POST returned 201.

**The event is resolved from the resource now, in middleware, keyed by URL shape** — a table mapping
each prefix to the SQL that finds its owning event. Matching on the path rather than Express route
params is forced (`app.use` never receives params) and is also the point: a route added under an
existing prefix inherits the rule, which is what D-025 claimed and did not deliver.

**The middleware was inert when first written and nothing would have told me.** Registered above the
session middleware, `principal` was always undefined and every request fell through — a check that
passes everything, which is worse than none because it looks like one. Caught by reading the
registration order; the suite was green either way, because the routes it covered were refused by
`scopeFor` regardless. This is the third time this project has hit that shape of bug.

**Roles are held on an event now.** `actorFrom` filters the principal's roles to the request's event
before the domain sees them, so `atLeast("presentation_manager")` asks whether they manage
presentations *here*. Before, a room technician here who managed presentations anywhere else could
waive blocking findings and roll back approved versions on this event.

**And the escalation that made the rest moot:** `POST /admin/users/{id}/roles` takes its event in the
body, so the resolver cannot see it and the flat question was being asked — a project manager on one
conference could grant themselves any role on another. Scoped.

**`security.cross_event_attempt` is now written** on every refusal, against the event reached for.
BUILD_SPEC I-4 asks for "blocked, logged and alerted"; blocking and logging exist, alerting does not
and is not claimed.

**Two tests first passed for the wrong reason.** The role-scoping cases were being refused by the path
resolver before the role check was reached, so reverting the role fix changed nothing. They needed an
actor who genuinely *is* on the event and holds the wrong role there — hence the suite creates two
accounts: an outsider with no role on MedTech, and an understudy who is a room technician on MedTech
and a project manager elsewhere.

**A regression the suite caught immediately:** the resolver matched `/imports/{id}/cells`, whose id is
an upload-cache key rather than a `schedule_imports` row, so every typed correction became a 404. Those
two routes take their event from the cache and pass it to `scopeFor` explicitly; the pattern is
narrowed to `/commit`, the only import route whose id is a real row.

Proved one half at a time: reverting the path resolver fails 7 of 11; reverting event-scoped roles
fails the waive case; reverting the role-grant scoping fails the escalation case. Legitimate work
unaffected — checked m.vega, c.delgado and t.okafor against their own events (all 200, including
`/slots/{id}`) and against events they hold no role on (403).

CI green, 208 unit tests; invariants **76** pass, 0 skipped. 96 `security.cross_event_attempt` records
in the dev database, all written by these runs.

**Left behind on purpose:** two deactivated `probe-outsider-*` accounts. Each refusal writes an audit
record against the account, so `removeTestAccounts` retires rather than deletes it — which is the
helper's correct policy (history stays) and means one deactivated account accumulates per suite run.

**Still open: RLS is inert.** Migration 005 is correct but the app connects as `PGUSER=pmp`, the
compose superuser, which bypasses every policy. This entry closes the application-layer hole
everywhere; the database-layer one needs the app to stop connecting as a superuser and is untouched.

## 2026-09-21 (fifty-ninth) — Schedule import leaves the sidebar

Travis: remove it from the left nav, it already shows when creating an event.

Right, and for a reason beyond the duplication: the sidebar entry pointed at
`/events/:id/import` for the **currently selected** event, so following it mid-wizard meant importing
into a different event than the one being created. Since D-027 the import is step 2 and an event
cannot be activated without it — the sidebar was offering as a destination something the product takes
you to.

**It was also the only link to that screen anywhere in the app,** so removing it outright would have
made screen 3 unreachable. Re-import is a real workflow: agendas are revised constantly before an
event, and `commitImport` matches on (room, start, title) and updates rather than duplicating,
machinery built for exactly that. The command centre now carries `Re-import agenda` beside
`Open review queue`, which is where someone looking at an event would go.

Logged as a deviation in `VISUAL_ACCEPTANCE.md` — §2.1 fixes the sidebar's names and order and the
baseline lists Schedule import third. The screen inventory is unchanged; this is a navigation change,
not the removal of a screen.

**Step 2 of the wizard is renamed `Agenda`** (same request, immediately after). Inside the wizard the
step is the thing being set up, not the act of loading it — `Basics`, `Deadlines & workflow` and
`Branding & template` are all named for what they configure, and this one was named for a mechanism.
The standalone screen keeps `Schedule import`, because there the import is what you came to do.

Verified: sidebar reads Portfolio → Create event → Command center, the wizard reads
`1. Basics · 2. Agenda · 3. Deadlines & workflow · 4. Branding & template`, and the command centre's
`Re-import agenda` points at `/events/{id}/import`. CI green, 208 unit tests.

**A flake seen and chased, not papered over.** One invariants run reported 5 failures in
`password-reuse.test.ts`; in isolation that suite passes 5 of 5, and three consecutive full runs
afterwards were 76/76. It is the TOTP contention recorded in the forty-seventh entry — the suites share
`admin@example.invalid`'s counter, and the new `cross-event.test.ts` adds a fifth call site competing
for it. `signInStaff` retries, but the retry budget is finite and the pile-up is now larger. Not
introduced by this change and not fixed here; recorded because a green run after a red one is not
evidence the red one was nothing.

## 2026-09-21 (sixtieth) — a review of Create event, and four things it found

Travis asked for the create-event flow to be reviewed again and the imported agenda checked. Walked it
end to end with a five-session file in DXG's template shape, then read the database.

**The import itself is sound.** 3 rooms, 2 event days, a quoted-comma title intact, a presentation
window of 10:30→11:10 inside its 10:30–12:00 session, 13:05→13:45 derived from a 40-minute duration
with no end time, 6 speakers and 6 assignments including a co-presenter on one slot, and a provisional
name for an email-only presenter. Nothing wrong with what lands.

**What was wrong was what the screens said about it.**

**1. The command centre header was a hardcoded string** — `Tampa Convention Center · Day 2 of 3 ·
Doors 08:00`, on every event, whatever its venue and however long it ran. Beside a live indicator, on
the event's home screen. SCREEN_SPECS §4 specifies `name · venue · Day N of M · doors`; three of those
are real data and the fourth is recorded nowhere. The venue is now read through `events.venue_id`
(`eventSummary` joins `venues`), the day is computed in the event's own timezone, and **Doors is not
shown at all** rather than invented. `Day N of M` appears only while the event is running — before and
after there is no current day, and choosing one would be the same fabrication in a smaller font; the
date range shows instead. Verified across three cases: a running event reads `tampa · Day 1 of 6`, a
future one `Orlando Civic Hall · May 3 – May 4, 2027`, and MedTech — which genuinely has no venue —
omits it rather than filling the gap.

**2. `NEW SPEAKERS` undercounted.** It said 5 for a file that created 6: the count added only presenter
1's address, so every co-presenter was invisible to the one number an operator uses to decide whether
to commit. Counts everyone now; the recheck file reads 4 for four distinct addresses.

**3. The preview showed only presenter 1.** `Imaging Advances` displayed "Sam Ito" with no hint that
Lee Ng was about to be created and assigned. The presenter column lists everyone the row names.

**4. The presentation window was invisible in the preview.** A row carrying its own 10:30–11:10 looked
identical to one running with its session. Shown as a second line — `talk 10:30–11:10`.

2 and 3 were the same defect in two places: the preview still described a one-presenter world the
importer had stopped living in.

**And the TOTP flake, fixed rather than recorded a third time.** Six invariant suites sign in as
`admin@example.invalid`, `node --test` gives each file its own process, and `freshCode`'s bookkeeping is
module-level — so it cannot see the other five. One run burned 69 seconds and failed five tests.
`tests/helpers/signIn.ts` now records the last-consumed step per account in a file guarded by an
exclusive-create mutex, and claims *and spends* the step under that lock — picking a code and then
racing another process to the server is the collision itself.

**The faster fix was tried and backed out, which is worth recording.** One TOTP code per 30 seconds per
account is a floor, so six sign-ins cost six windows; sharing one verified session across the suites
would have cost one. It also coupled suites that were independent — `auth-separation.test.ts:61` logs
the staff session out in its teardown, which killed every other suite mid-run. Two runs reported 63 and
68 tests where there are 76, which is the failure mode to fear: not red, just quietly less. Reverted.

Cost accepted: `test:invariants` goes from ~70s to ~135–180s. Three consecutive runs at 76 pass, 0
fail, 0 skipped, and the count is stable, which it was not before.

CI green, 208 unit tests. Walkthrough events removed.

## 2026-09-21 (sixty-first) — RLS stops being decorative

The last piece of the isolation story, open since the first entry of this session. D-035.

**Migration 005 wrote the whole thing in August and none of it ran.** Row security enabled and FORCEd
on every tenant table, a policy per table granted `TO pmp_app`, append-only tables revoked — and the
application connected as `pmp`, the schema owner and a superuser. A superuser bypasses row security, so
a session scoped to a client id that does not exist read every event, speaker and file version in the
database. Measured before and after: `{events: 3, speakers: 3, file_versions: 4}` became
`{0, 0, 0}`, while platform context still sees all six events.

`pmp_app` was created `NOLOGIN`, which is why it was never used. `011_app_role_login.sql` gives it
LOGIN, re-grants on every table and sequence — 005's one-time `ON ALL TABLES` never covered what
migrations 006–010 added — sets default privileges so the next migration is covered without anyone
remembering, and re-applies the append-only REVOKEs **after** the blanket grant, which would otherwise
hand back exactly what 005 took away. `packages/db` now has two pools: the application's, and the
owner's for migrations and the seed.

**An hour lost to a credential in the wrong place, and worth writing down.** The migration originally
ended with `ALTER ROLE pmp_app WITH LOGIN PASSWORD '…'`. A role is cluster-wide and a migration is
per-database, so migrating a *second* database silently rotated the password the first was using. It
presented as "password authentication failed" on a database nobody had touched, twice, and I twice
"fixed" it by re-running the ALTER by hand — which is exactly the kind of patch that hides a cause.
Reproduced deterministically in the end by measuring the verifier before and after. The credential now
lives in `scripts/ensureAppRole.ts`, called by `db:migrate` and `db:reset`; the migration expresses
privileges and nothing else. Verified the real hazard is gone: migrate the primary, migrate a second
database, and the primary still authenticates.

**`tests/invariants/rls-isolation.test.ts` — the suite BUILD_SPEC I-4 names, finally writable.**
Isolation between tenants cannot be tested with one tenant and the seed has one client, so it makes a
second. Twelve cases: each client sees only its own rows through a bare `SELECT` with no `WHERE`
clause; a scope pointing at nobody sees nothing; a write into the other client is refused by `WITH
CHECK` rather than by the application; another client's row cannot be touched because it is not there
to touch; and four that assert what the application can no longer do — `SET ROLE` to the owner, create
a table, rewrite or delete an audit record, read the migration ledger. **Reverting the connection to
the owner fails all twelve**, which is the point: the suite is worthless without the fix and says so.

**My own suite then broke two others, which is the more useful lesson.** Its teardown deleted probe
events and probe clients in *one* transaction, so the clients delete failing on a foreign key rolled
back the events delete too — and each run left another pair of tenants behind. Nine clients later,
`POST /events` started refusing to guess which one an event belonged to (`events.client_required`), and
the cross-event and schedule-import suites failed with a 400 that had nothing to do with them. Two
transactions now, and events are found by their client rather than by their own name.

Verified: 208 unit tests, **88 invariants** (two consecutive runs, 0 failed, 0 skipped, and the client
count back to 1 afterwards), the whole staff surface 200 in the browser, and the command centre
rendering MedTech normally. A fresh database through migrate → ensureAppRole → seed works end to end;
`db:reset` itself was not run, because it destroys the volume and there are events in this database
that are not mine.

**Still not closed, and 005 already said so:** `users`, `event_roles`, `venues`, `client_grants` and
`retention_policies` carry a `USING (true)` policy. RLS is on and the posture is explicit, but those
tables have no `client_id` and stay app-mediated until the role × permission matrix (P0-E8) is signed
off.

## 2026-09-21 (sixty-second) — an unfinished event goes back to the wizard, not to a command centre

Travis, clicking one of the three abandoned `Test` drafts in the portfolio: this should take me to
the create event flow. D-036.

**Reproduced first, and the destination was the smaller half of it.** The command centre for a draft
with no rooms, no sessions and no talks showed a green `● live` dot, `0 / 0` collected, `0 / 0` rooms
ready and *"Nothing at risk — every talk is synchronized onsite."* Four statements about an event that
has not been set up, three of them reassuring. The sixtieth entry fixed exactly this shape of thing in
the header beside that same dot; this is the rest of the screen doing it.

**The setup those drafts still needed had no entrance at all.** The wizard kept everything in React
state and always opened at step 1, so `/events/new` could only ever make a *new* draft — a fourth one
beside the three. Nothing in the product could reach an existing one.

**Redirecting at the command centre rather than only relabelling the card.** The portfolio link is
not the only way in: the sidebar's event switcher lists drafts, and so does a bookmark. `/events/{id}`
on a draft now redirects to `/events/new?event={id}`; the card additionally reads `Continue setup →`
so the destination is not a surprise before the click.

**Resuming needed the draft to carry back what was typed** — `EventDraft` held name, rooms, tracks,
days and settings, and the venue, timezone and both dates were written at creation and never read
again. It carries them now, with `branding` for step 4 and a **`sessions` count**, which is the
durable form of the question D-027 gates steps 3 and 4 on: `imported` only knows about an import done
in this browser session, so a resumed draft with a complete agenda would have found steps 3 and 4
locked against it.

**The half that would have gone wrong quietly: editable boxes that save nothing.** Re-showing step 1
without a way to store it is the trap D-033 took out of the row editor, and worse here — a wrong date
is a common reason to abandon setup in the first place. `PATCH /events/{id}` takes `basics`, sharing
one `checkBasics` with creation so the two cannot drift, and the wizard sends it only when a field
actually changed.

**Changing the dates reconciles the event's days, and refuses rather than cascades.** Missing days are
inserted, uncovered ones deleted — unless one carries sessions, which is `events.days_conflict` naming
the day it would have dropped. Unreachable from the wizard (step 1 sits behind an agenda-gated step 2)
and reachable from the endpoint, which is the point. After activation `basics` is refused outright.

**A venue is not renamed in place when something else points at it**, because `duplicateEvent` copies
`venue_id` — editing a duplicated draft's venue would otherwise rename it under the event it came from.

**Two wrong statuses, found by the tests and not by reading.** `statusFor` matched `.conflict` only, so
`events.days_conflict` went out as 400 "malformed", which it is not; it accepts `_conflict` now.
`events.not_a_draft` joined the 422 group the same function's own comment describes.

**Proved by reverting: 10 of 10 fail without the change, 10 of 10 pass with it.** The two most useful
failures returned `200` — before this, a `basics` body was accepted and silently ignored on a draft
*and* on an activated event.

**Also fixed, one line, because it was a dead control sitting beside a working one:** the portfolio's
`+ Create event` button was `disabled` with `title="Create event — M1-4"`, left over from before the
wizard existed. The sidebar has linked to the same screen for days.

Verified end to end in the browser: the three drafts read `Continue setup →`; one resumed at step 2
with `Test` / `tst` / `America/New_York` / 25–26 Sep in step 1's boxes; editing the venue to
`Tampa Convention Center` and the end date to 28 Sep saved in one request and moved **Days 2 → 4**,
with the database holding both and one `events.configured` audit record naming the basics. A draft's
command-centre URL redirects; an active event's does not, and NeuroSummit — which is active with no
sessions — now reads "No talks yet" instead of claiming every talk is synchronized onsite.

CI green, 208 unit tests; invariants **98** pass, 0 skipped. Probe events removed.

**Not mine, and changed anyway:** the `Test` draft dated 25–26 Sep is one of the three that were
already in this database. Verifying the edit path meant editing it — its venue is now
`Tampa Convention Center` and it ends 28 Sep rather than 26 Sep.

## 2026-09-21 (sixty-third) — an event opens on what it is, and a room technician stops being able to close the portal

Travis: clicking an event should show its details, not the command centre. There was no such screen —
the inventory has *Presentation detail* for a talk and nothing for an event — so the choice was put to
him between an expand-in-place card, reusing the wizard, and a real screen. He chose the screen.
D-037.

**The gap is bigger than the click.** Everything the wizard sets was written once and visible nowhere
afterwards: the timezone every displayed time in the product renders in, the upload deadline that
closes the speaker portal, the reminder cadence, the accent colour, the rooms and days the agenda
created. The command centre answers only "how is this going", and since the sixty-second entry the
wizard refuses an activated event — so a wrong timezone on a live event could not be found at all.

**Screen 18 shows the load-bearing fields locked, not hidden.** Name and venue are labels and stay
editable; timezone and dates are what the schedule is set against, so they are displayed with the
reason they cannot be changed here. Hiding them would conceal the thing every time depends on, and
rendering them as inputs the endpoint then refuses is the D-033 trap wearing a different hat. The
sixty-second entry's blanket refusal is **narrowed** to exactly those three fields, which is the rule
that entry gave a reason for, applied to the fields the reason was about.

**And then the reason this took longer than a screen: the routes it was about to put a UI on were
ungated.** `POST /events`, `PATCH /events/{id}`, activate and duplicate asked for a staff session and
an event scope and nothing else, though SCREEN_SPECS §2 has said PjM/PM/Admin since it was written.
Probed before fixing: **`t.okafor`, a room technician on MedTech Forward and nothing else there, set
that event's upload deadline to 1999-01-01 and its accent colour, and got 200 for both.** That is an
account with custody of one room locking every speaker on the event out of uploading. Gated on
`atLeast("presentation_manager")`.

**Three lessons from the proving, and they cost more than the fix.**

**1. A revert-to-prove run on an authorisation invariant performs the writes it expects to be
refused.** The first version of the suite asserted the refusals against MedTech Forward, so reverting
the gate renamed the seeded event, moved its deadline to 1999, turned its accent red and — through the
new day reconciliation — took it from one event day to three. All four were found and restored, the
last one only because the new screen displayed `Days 3` for an event the database had said was 1
earlier the same session. The suite now writes only to a probe event it creates and deletes.

**2. A test of mine passed for the wrong reason, which is the fourth time this project has hit that
shape.** "A room technician cannot activate" stayed green with the gate reverted, because the
technician held no role on the probe event and `scopeFor` refused it before any role was consulted. A
refusal by the scope check proves nothing about the role check. The account is granted
`room_technician` *on that event* now, so the gate is the only thing left that can refuse it. With the
fix reverted, four cases fail and three stay green — the discriminating signature, not all-red.

**3. Two new suites broke two old ones, both by contention I introduced.** `admin@example.invalid`
went from six sign-ins to eight; the step lock holds for up to a full 30-second window per contender,
so the honest queue became 240s against a 150s ceiling and every suite reported "could not claim an
authenticator step". The ceiling now clears any plausible queue — a *crashed* holder is caught by the
60-second staleness check, which is a different question and unaffected. Separately, my suite signed
in as `t.okafor`, which `mfa.test.ts` reserves with a comment explaining exactly why: it drives the
raw second factor outside the lock, so another suite spending a code breaks the replay test it is
about to run on purpose. Moved to `c.delgado`.

**A pre-existing race closed on the way past:** `POST /events` guesses the client only when one
exists, and `rls-isolation.test.ts` creates a second while it runs — so any suite creating an event
without naming a client fails with `events.client_required` whenever the two overlap. The sixty-first
entry stopped those probe tenants accumulating; it did not stop them existing. Three suites now name
the client.

Verified in the browser end to end on a disposable event: the details screen filled with
`UI Details Probe` / `Old Venue Name` / `America/Chicago`, editing the venue, deadline and cadence
saved in one request, and the database held `New Venue Name`, `2027-07-15` and `T-7 only` with the
dates and timezone untouched and one `events.configured` audit record. MedTech renders its real rooms,
`3 / 3 collected` and one day.

CI green, 208 unit tests; invariants **105** pass, 0 skipped, **three consecutive full runs**, which is
what the contention fixes had to demonstrate rather than assert. Probe events removed; MedTech Forward
restored to its seeded name, settings, branding and single event day.

## 2026-09-21 (sixty-fourth) — "Sessions 0" was a fair question, and the answer was a hole

Travis, reading `Sessions 0` on OrthoWorld's details screen: is a session required on each event?

**Two doors, two answers.** Through the wizard, yes — D-027 makes step 2 mandatory and `commitImport`
is what writes sessions, so the product's own path cannot produce an event without them. At the API,
no: `activateEvent` asked for `rooms.length > 0 && days > 0` and never counted sessions. So
`POST /events` → `PATCH {rooms}` → activate produced a live event with no agenda — **and that is not a
hypothetical path, it is the one my own `event-configuration.test.ts` used two entries ago to get a
live event to test against.**

**The rule was written down twice and enforced nowhere that counts.** D-027: an event without an
agenda "is not a partly-configured event, it is an empty one". SCREEN_SPECS §2, as an acceptance
criterion: "an event cannot be activated". Both were true of the forward button and the step chips and
false of the one function where activation happens. Same shape as D-025, where the rule lived in one
layer and the other never asked, and as migration 005, which was correct and never ran.

**What it produced:** no sessions → no slots → no talks. Nothing to collect, review, sync or archive,
`0 / 0 collected` for ever, and a card on the portfolio indistinguishable from an event whose speakers
simply have not uploaded — which is the one screen a project manager scans to see what needs chasing.

Now refused, naming what is missing rather than the rule: rooms, days and sessions all arrive in the
same commit, so this is one condition stated three ways, but "it has no sessions" is something an
operator can act on and "this event needs an agenda" is not.

**A duplicate is refused too, by design rather than by accident.** FR-EVT-002 copies structure and no
content, so a duplicated event has rooms, tracks and days and an empty agenda — exactly the shape this
refuses. It has no talks either. Given its own case rather than reasoned about.

**Left inconsistent on purpose, and said out loud:** the seed writes `status: 'active'` straight into
its INSERT and never calls `activateEvent`, so NeuroSummit and OrthoWorld stay live with zero sessions.
Nothing in the product can create that state any more; the seed is not in the product, and quietly
rewriting fixtures to fit a new rule would hide exactly the question Travis asked.

**A leftover the duplicate test created, found by counting rows rather than by reading output:** two
clean runs left four events where there should have been three. `events.duplicated_from` points from a
copy back at its source, so a cleanup that happened to reach the source first was blocked by that key
and *archived* it instead — the helper's correct fallback, silently accumulating a probe event per run.
The copy has its own name prefix now and is removed first, child before parent.

Proved by reverting: exactly one case fails, the new one, and the other eight stay green.

CI green, 208 unit tests; invariants **107** pass, 0 skipped, two consecutive full runs, and the event
count back to three afterwards.

**Not mine:** a draft called `Test Event` (Tampa, 21–23 Sep 2026) was created from the browser by
`admin@example.invalid` at 11:01 UTC today. Left alone.

## 2026-09-21 (sixty-fifth) — the row editor's header stops being the title's passenger

Travis, on the row editor with a real conference title in it: improve the modal header.

**What it was doing.** `.chd` is the shared card header — `display:flex` with
`justify-content:space-between` — written for a short name beside a short meta string. The meta here
is whatever the spreadsheet put in the title cell, and a hundred and eleven characters of
`15P - (In)Congruence Between Rigorous Research and Secondary School Realities: Assessing
Implementation Fidelity` is an ordinary one. Under the shared rule the title took the width it wanted,
wrapped to three lines of monospace, and squeezed `Row 6` into `Row` / `6` stacked in the corner — the
row number is what the dialog is *about* and it had become the smallest thing in its own header.

**Now:** the number never shrinks, the title takes one line and ellipses, and the header is 46px
instead of three lines of it. Nothing is lost by truncating — `Session Title` is the first field in
the dialog, in full and editable — and the whole string is on the element's `title` for a hover.

**The accessible name carries the untruncated title**, because there is no hovering an ellipsis with a
screen reader: `aria-label="Edit row 2: 15P - (In)Congruence Between …"` in full. Same principle as
the fifty-sixth entry, where short visible labels kept fully-qualified accessible ones.

**`minWidth: 0` is the whole trick and is easy to omit.** A flex item will not shrink below its
content's width without it, so `text-overflow: ellipsis` never fires and the text simply overflows the
box. Commented in place, since the next person to touch this will be tempted to delete it as noise.

Scoped to this dialog rather than to `.chd`: every other card header in the product pairs two short
strings and is fine as it is.

Verified by reproducing first — the broken header photographed at 800px with `Row` / `2` stacked —
then measuring rather than eyeballing: `rowLabelWraps false`, `titleTruncated true`, the full string in
both `title` and the dialog's `aria-label`, nothing overflowing the header, at **1202px and at 375px**,
with a short title (no ellipsis, same 46px) as the control. The long title was measured at 375px too,
by swapping the text in place and reading the box back.

CI green, lint and type-check clean. Probe event removed.

**Still not mine:** the `Test Event` draft from 11:01 UTC is untouched.

## 2026-09-21 (sixty-sixth) — a fair question about a slider, and three 500s behind it

Travis, from the row editor: presentation start 5:10 PM, end 5:25 PM, duration 55 min — does this make
sense? D-039.

**No, and the data was never in danger.** The importer consults a duration only when no end time was
given, so the row imports as 17:10–17:25 and the 55 is discarded — the published end wins, because it
is the one an attendee was told. **The screen simply never said so where it mattered.** The rule was a
sentence at the top of the box; underneath it a live, draggable slider read `55 min` next to a
fifteen-minute window. An operator could drag a number that would be thrown away, and a careful one
stopped to ask whether the product had noticed.

Now: with a readable End present the slider is **disabled** and reads `not used`, and a note gives the
three facts — what the times come to, what the file said, and that clearing the End makes the duration
count. The file's number is **not** replaced with the real window; that is what the sheet said, and
D-032 already refused to rewrite an operator's data to fit this control.

**The first attempt was worse than the problem.** `not used — the times give 15 min` on the label line
wrapped into a six-line column, because that line shares a third of the dialog's width with the label
and the Clear button. Short status on the line, sentence in the note below.

**Then the part that was not asked about.** Checking what the importer really does with that pair
turned up three files that pass the preview with **zero blocking errors** and fail the commit with
`500 Unexpected server error`, naming no row, after the operator has reviewed everything and pressed
Import:

1. a presentation ending before it starts — `slots` has `CHECK (ends_at >= starts_at)`;
2. a session ending before it starts — `sessions` has `CHECK (ends_at > starts_at)`;
3. **a file with no Session End column at all**, which is the nastiest, because nothing about it looks
   malformed: `endsAt` falls back to the start, so `ends_at` equals `starts_at` and the strict check
   refuses it.

**Number three was a split between two lists that each claimed to be the source of truth**, and it is
the fifty-third entry's finding again: `TEMPLATE_COLUMNS` marks Session End REQUIRED, DXG's sheet
prints REQUIRED under it, and `REQUIRED_FIELDS` did not have it. Adding it there was still not enough
— the per-row `missing` list is written field by field rather than derived from the constant, so the
template changed and the enforcement did not. Fixed in both places, with the comment explaining why
the duplication exists at all.

**And the commit's idea of "blocking" was a hand-maintained subset of the preview's.** `commitImport`
asked `!row.title || !row.room || !row.starts_at` and never saw the issues list — reasonably, since it
takes its rows from the browser and a client is not a place to keep a rule. It now refuses a row whose
own instants run backwards: the same question the database asks, in the same terms, one layer earlier
and with the row number attached.

**A useful false start:** the first run of the new tests failed identically after I had edited the
service, which looked exactly like a stale dev server. It was not — the process had restarted on the
write, and dumping the API's actual response showed the preview emitting the blocking issue correctly.
The failures were real and in two different places (`missing`, and the commit-side check), and I would
have "fixed" a restart that was never broken.

Verified in the browser with Travis's own numbers: row 2 shows `Duration not used` with the slider
greyed and the note reading "The times above give 15 min. The file says 55."; row 3, which gives a
duration and no end, is unchanged — `45 min`, slider live. Clearing the End on row 2 re-enables the
slider and returns the label to `55 min`, which is the advice the note gives, so the advice is known
to work. The preview table already showed the truth all along: `talk 17:10–17:25` against
`talk 13:00–13:45`.

Proved by reverting: the three new cases fail without the guards, and the zero-length presentation case
stays green in both directions — `slots` allows `>=` where `sessions` demands `>`, and the suite draws
the line where the schema does rather than somewhere rounder.

CI green, 208 unit tests; invariants **112** pass, 0 skipped. Probe events removed.

## 2026-09-21 (sixty-seventh) — the duration slider goes, because duration is not a fact

Travis: duration can be calculated from the session start and end, so the slider is not needed — am I
right? Right, and for a better reason than redundancy. D-040.

**Checked before answering: a duration is stored nowhere.** No migration creates a column for it;
`slots` has `starts_at` and `ends_at` and nothing else, and the importer only ever turns a duration
into an end. So it was never a second fact about a presentation, only a second *spelling* of the one
the times already give — which is precisely how a row comes to read 5:10 PM → 5:25 PM beside "55 min",
the contradiction asked about three hours earlier.

**The one case where it is not derivable is still not a case for an input.** A row with a start and no
end has nothing to compute from, and there the file's duration decides. But setting the End says the
same thing, and the End picker is the control immediately beside it. What is lost is arithmetic — 45
minutes from 13:07 is now 13:52 typed by hand — and the slider could not express that anyway, being
fixed to 5-minute steps since D-033.

**Still shown, because the file's number is evidence**, and always labelled with where it came from:
`15 min · from the times above` · `45 min · from the file — ends 13:45` · `90 min · from the file —
not used, the presentation has no start` · `not set`. A file that disagrees with the times gets a line
saying so and saying which wins.

**Deleted with it:** the range input, `DURATION_MIN/MAX/STEP`, the floor of 5, the over-240 clamp note,
the Clear button, the disabled state and the "not used" wording from this morning. Two of Travis's own
decisions superseded at his request — and not on taste: the field they governed turned out to be
derived rather than stored, which neither knew.

**Two smaller things the change turned up.** `label` is styled as an element rather than a class, so
the caption-only markup had to stay a `<label>` (with no `htmlFor`, since there is no longer a control
to point at) or it would have rendered unstyled beside two real fields. And the box's own helper text
still said "Duration is only used when there is no end time", which had quietly become a sentence about
a control that no longer exists — now "a duration in the file fills the end in when the file gives no
end", which describes the importer rather than the screen.

Verified against every state the field can be in, with a five-row file: times agreeing, times
disagreeing with the file, duration with no end, nothing at all, and a duration with no start. No
`input` element remains in the field in any of them.

CI green, 208 unit tests; invariants 112 pass, 0 skipped. Probe events removed.

## 2026-09-21 (sixty-eighth) — the duration box loses its prose, and a talk can no longer escape its session

Travis, three things: remove the Presentation box's note, show the duration in a box like an input
field, drop the "from the file — not used…" lines, default it to `0 min`, and stop an operator setting
presentation times outside the session's. D-041.

**The duration now keeps the shape of the fields beside it.** Start, End and Duration describe one
thing; a line of prose between two boxes read as a different kind of statement. A disabled input,
value only. `0 min` where nothing is set — a presentation with no times of its own has no length of
its own, and zero says so in the same shape as every other value.

**What the removed text cost, recorded rather than argued.** The lines naming a number's origin are
gone, and so is the one that appeared when a file's duration disagreed with its times. A sheet
claiming 55 against a fifteen-minute window now shows `15 min` and no trace of the 55. The resolution
is unchanged — the published end has always won — but the disagreement is no longer visible. A
deliberate trade of evidence for quiet, restorable in one line.

**And the part that was a real hole.** `slots` and `sessions` carry their times independently with no
constraint relating them, so a presentation starting before its session opened, or running past the
end of it, imported cleanly — and unlike the sixty-sixth entry's three cases, **no database error was
waiting to catch this one.** It would have reached the room schedule and the speaker's portal looking
authoritative.

Held in both places on purpose: `min`/`max` on the pickers makes the rule *reachable* — an operator
cannot step or type outside it, and an out-of-range value turns the field the blocking colour. That
last part needed a stylesheet rule, because nothing styled `:invalid` at all, so until now the browser
knew the value was wrong and the operator could not see it. Scoped to `time` and `date` inputs: a
blanket rule would have lit up every merely-empty field elsewhere in the product. Then `buildPreview`
raises a blocking issue and `commitImport` refuses the row against the instants it is about to insert,
because `min`/`max` is a hint that a pasted value walks straight through.

**An older test had to be rewritten, and the reason is worth keeping.** "A presentation that ends
before it starts" used 5:25 PM → 5:10 PM inside a 8:00–10:00 session, so once this rule existed the row
tripped two at once while the test asserted it tripped exactly one. Moved inside the session, so each
case still isolates the rule it names.

Verified in the browser: the pickers carry `min="09:00" max="11:00"` from the session's own times, the
session's own pickers stay unbounded, a value of 08:30 turns the border from `rgb(226,232,236)` to the
blocking `rgb(214,69,69)` and reports "Value must be 9:00 AM or later.", the duration reads `45 min`
derived from 09:30–10:15 and `0 min` on a row with no presentation times, and the Presentation box
contains no prose at all.

Proved by reverting: the three bounds cases fail without it, the rest stay green.

CI green, 208 unit tests; invariants **116** pass, 0 skipped. Probe events removed.

## 2026-09-21 (sixty-ninth) — the wrong time stops being offered

Travis, shown *"The presentation ends at 03:15 and starts at 09:30 — it cannot end before it starts"*:
make the boundary so the time cannot be selected outside the session, and disable Save when there is
an error. D-042.

**The error he saw was yesterday's fix working, which is the point.** The sixty-eighth entry bounded
the presentation pickers by the session, but `min`/`max` on a time input only *marks* a value invalid:
stepping past the bound is refused, typing past it is not. The value stuck, the row saved, and the
server explained afterwards what should never have been on offer.

**Every clock is now fenced by the ones it has to agree with** — `slot.start` by the session start and
by the earlier of the slot end and the session end; `slot.end` by the later of the slot start and the
session start, and by the session end; and the session's own pair by each other, which closes the
backwards-session case the same way.

**The fences are mutual, and that is what keeps them from being a cage.** A row that arrives 10:25 →
10:10 has both fields out of range and no legal move in sight; because each bound reads the other
field's *current* value, correcting either one releases the other. Checked rather than assumed: fixing
only the end moved the start's `max` from 10:10 to 10:45 and the untouched start went valid on its own.

**Save reads `:invalid` from the inputs** rather than a second copy of the rules, so the button and the
red borders cannot disagree. It is deliberately *not* gated on the problems the server returned for the
row — those are what the operator opened the dialog to fix, and gating on them would make a blocking
row permanently unfixable. That was the one way this request could have been implemented into a trap.

**The server rules stay.** A pasted value ignores `min`/`max`, and nothing in a browser is a rule. What
changed is that an operator working normally will never meet those messages again.

Verified in the browser: on a good row the four pickers carry exactly the bounds above; setting the end
to 03:15 — Travis's case — turns it red, reports "Value must be 9:30 AM or later." and disables Save
with a tooltip naming the red boxes; putting a good value back re-enables it.

**A gap stated rather than papered over:** none of this client behaviour has an automated test, because
the repo has no component-test harness at all — `npm test` runs `node --test` over the packages and app
sources, and BUILD_SPEC §16's Jest/Testing Library layer has never been built. The rules these fences
mirror are covered by the API suites; the fences themselves are covered by the browser session recorded
here. That is weaker and should not be mistaken for equivalent.

CI green, 208 unit tests; invariants 116 pass, 0 skipped. Probe event removed.

## 2026-09-21 (seventieth) — the option itself goes, not just the answer

Travis, with a screenshot of Chrome's time dropdown listing 07 08 09 10 11 12 01 on a field bounded to
a 09:00–11:00 session: we should not give the user the option to select a time outside the session.

**He is right, and the previous fix could not do it.** `min` and `max` do not filter that dropdown —
Chrome lists every hour of the day and uses the bounds only to mark the result invalid after the fact.
The sixty-ninth entry made the wrong value refused; it could not make it unoffered, and that gap is
the whole of this request. Worth recording as the pattern: *a constraint the control does not render
is not a constraint the user experiences.*

**The presentation's two clocks are now a list of the session's own times**, five-minute grid, bounded
exactly as before — twenty-five options for a two-hour session, with `— runs with the session` as the
empty one. The session's own clocks stay native inputs: a presentation's time is chosen from inside a
known window, which is what a list is for, while a session's time is simply stated and would need 288
options nobody scrolls.

**A file's out-of-window time is kept and named** — `11:45 AM — outside the session`, red, Save
refused — rather than dropped into the list, which would silently replace the operator's data with the
first legal option, or hidden, which would show a value the row does not hold. Picking any legal time
removes it and the option goes with it.

**Save's gate had to widen**: `input:invalid` is the browser's verdict on `min`/`max` and says nothing
about a `<select>`, so it now reads `input:invalid, [aria-invalid="true"]` and covers both controls
with one check.

Verified in the browser on a 09:00–11:00 session: the presentation fields render as `SELECT` and the
session's as `INPUT`; the end offers 10:25 AM → 11:00 AM and stops, the start stops at its own end
(10:40 AM); a row carrying 11:45 AM shows it as `11:45 AM — outside the session` with
`aria-invalid="true"`, border `rgb(214,69,69)` and Save disabled, and choosing 10:55 AM clears all
four of those and shrinks the list from ten options back to nine.

CI green, 208 unit tests; invariants 116 pass, 0 skipped. Probe event removed.

## 2026-09-21 (seventy-first) — the empty option loses its words, not its job

Travis: remove the "— runs with the session" option, keep only time.

**Done literally first, and it broke the screen**, which is why the option survives as a blank rather
than not at all. A `<select>` holding a value no option matches does not render empty — it falls back
to the first option. With the empty one gone, a row carrying **no** presentation time displayed
`9:00 AM` in both fields while holding neither: `startValue "09:00"`, `selectedIndex 0`, against a
draft still holding `""`. The dialog stated a time the row did not have, and one touch of the field
would have written that invention into it — the same defect as the hardcoded command-centre header,
arriving through a dropdown.

So the option is `<option value="" />`: no text, which is what was asked for — the list is times and
nothing else — while an empty row still looks empty and a time already set can still be cleared, for
a talk that turns out to run with its session.

Verified both ways on a 09:00–11:00 session: a row with 10:25–10:40 shows `10:25 AM` and `15 min`; a
row with no presentation times shows blank, value `""`, `0 min`; and the option labels read `""`,
`9:00 AM`, `9:05 AM` with no prose anywhere in the list.

CI green, 208 unit tests; invariants 116 pass, 0 skipped. Probe event removed.

## 2026-09-21 (seventy-second) — the dashboard's picker, ported and re-tinted

Travis: check the DXG dashboard's date and time picker and implement the same style. D-044.

**Found rather than guessed at:** `dxg-rfp-tool-dashboard` uses `react-datepicker` 9.1.0 with
`date-fns`, ~420 lines of `dxg-datepicker` CSS, a custom month/year header and a 15-minute `Time`
column. The baseline prototype in this repo has no picker at all — its one "calendar" match is
Tailwind preflight — so there was nothing here to copy from.

**Two runtime dependencies is a BUILD_SPEC §17 "ask first", so it was asked.** Travis chose the same
library with this app's colours over a verbatim teal copy and over hand-rolling. Eight packages arrive;
the control-center had four. The two `npm audit` findings are pre-existing `postcss` via `next` and
have nothing to do with this.

**Re-tinted, not copied:** every hex in the ported CSS is now a token reference, so the dashboard's
teal `#1DBFD3` becomes this product's cyan `--blue`. VISUAL_ACCEPTANCE §2.4 wants colours derived from
the baseline's tokens, and a verbatim copy would have put a second accent on every screen with a date
on it. The `.dark` block is dropped and `lucide-react`'s chevrons are inline SVG.

**The thing worth recording is what the library cannot do.** `includeTimes`, `filterTime` and
`minTime`/`maxTime` all feed `isDisabledTime` — they add a `--disabled` class and block the click,
while the list stays the full ninety-six entries of a day. I tried `filterTime` first and the DOM said
96 with a screenshot that looked correct, because the list happened to be scrolled to the selected
time; `includeTimes` behaved identically. Reading `dist/index.js` settled it. The disabled rows are
hidden in CSS instead, with the selected one exempt so a value the file supplied cannot disappear from
the field that exists to correct it.

**This retires the hand-rolled `<select>` from the seventieth entry**, which existed only because a
native time input would not withhold an option. The rule is unchanged and still enforced server-side.

Verified in the browser on a 09:00–11:00 session: the calendar renders the dashboard's shape —
`September 2027 ⌄` with `‹ ›`, SU–SA, the selected day in this app's cyan — and the time column
renders 96 rows of which **7 are shown**, 09:30 AM to 11:00 AM, with 10:15 AM selected. A row whose
file supplied 11:45 AM shows **8**: the seven the window allows plus its own out-of-window value, kept
and selected. The three-up Presentation row needed `.dxg-field-wrap{display:block;width:100%}` —
react-datepicker wraps its input in an inline-block div, which collapsed the row and clipped the
Duration box beside it.

Also applied to the wizard's start and end dates, each bounded by the other, and to the event details
upload deadline, bounded by the event's own start.

CI green, 208 unit tests; invariants 116 pass, 0 skipped; `next build` clean. Probe event removed.

## 2026-09-21 (seventy-third) — walking create event with the new picker, and the field that never had one

Travis: check the create event flow with the new picker. Walked all four steps end to end in the
browser, on a real event, and read the database afterwards.

**It works, and one field was found not to have been a picker at any point.** Step 3's *Speaker upload
deadline* was a free-text box with `Feb 27, 2027 · 23:59` as its placeholder — not a date input, so
nothing about D-044 touched it. Whatever was typed was stored verbatim in
`settings.upload_deadline`, and **Event details reads that same setting through a date field**, so the
two screens disagreed about the shape of one value and a deadline set in the wizard did not display on
the details screen at all. Now the same `DateField`, bounded by the event's own start, and the
round-trip is checked: `09/01/2026` in the wizard, `2026-09-01` in the database, `09/01/2026` back on
the details screen.

**The rest of the walk, verified rather than eyeballed.** Step 1's two dates bound each other — with
the start on 09/12, the end calendar struck through 1–11 and **clicking a struck-through day did
nothing** (value stayed empty, calendar stayed open), while the 14th took. Step 2 read a three-row
agenda, one row deliberately missing a title: `Rows 3 · Incomplete 1 · New speakers 3`, forward
disabled. The row editor showed the missing title in the blocking colour with Save refused, and its
presentation clock offered **exactly that row's session window** — 11:00 AM to 12:00 PM, nothing else
— which is the bound coming from the row being edited rather than from the event. Fixing the title
enabled Save; the import reported `3 created · 0 updated · 0 unchanged`; steps 3 and 4 opened; the
event activated and landed on its command centre reading `Tampa Convention Center · Sep 12 – Sep 14,
2026`.

The database holds 3 days, 1 room, 3 sessions, 3 speakers, `upload_deadline 2026-09-01`, accent
`#44C7F4`, and `Opening Plenary` with its own 09:15–10:00 talk window inside a 09:00 session. `Panel On
Imaging`, which gave a duration and no presentation start, correctly has no slot times: a duration
fills an end, and there was no start for it to fill from.

**Self-inflicted, and worth recording because it cost twenty minutes.** The `next build` I ran to prove
the new dependency wrote a production build into the same `.next` the dev server was using, and the
dev server then failed with `Cannot find module './673.js'` on every route. Clearing `.next` was not
enough — the running process holds its own state — so it needed a restart. **Never run `next build`
against a tree with `next dev` live on it**; build in CI or stop the dev server first.

**An observation, not a defect:** with the End date empty, the calendar fills today's cell the same
cyan as a selection, because react-datepicker marks it `--keyboard-selected` and the ported theme
styles that identically to `--selected`. That is the DXG dashboard's own behaviour, so it is left
alone; distinguishing them (outline versus fill) is a one-rule change if Travis wants it.

CI green, 208 unit tests; invariants 116 pass, 0 skipped. Walkthrough event removed.

## 2026-09-21 (seventy-fourth) — "here" stops looking like "chosen"

Travis, on the observation left at the end of the last entry: use an outline for
keyboard-selected instead of a fill.

react-datepicker marks a day `--keyboard-selected` to say *this is where the keyboard is*, and with an
empty field that is today. The ported theme filled it exactly like `--selected`, so an untouched End
date showed today's cell looking chosen — the screen stating a value the field does not hold, which is
the defect this project keeps removing, arriving this time through a stylesheet.

An outline now says "here" and a fill says "chosen", and neither says the other. Scoped
`:not(--selected)`, because a day can carry both classes and a real selection must keep its fill; the
hover rule is split the same way, so hovering where the keyboard is takes the ordinary pale tint rather
than painting itself like a selection.

**A deliberate deviation from the dashboard**, which fills both — recorded rather than silently
diverged. The dashboard's date fields are rarely empty; this product's End date starts empty every
time, which is exactly when the two readings collide.

Verified by measuring both states: with an empty field today's cell is `rgba(0,0,0,0)` with ink text
and an inset `rgb(68,199,244)` 1.5px ring; after choosing the 18th that cell is `rgb(23,147,196)` with
white text, and the two are visibly different in the same calendar.

CI green, 208 unit tests. The invariant suites were not re-run: nothing outside the stylesheet changed.

## 2026-09-22 (seventy-fifth) — the agenda has a second way in

Screen 3 had one entrance: upload a spreadsheet. An event whose schedule is small, or not yet in a
file, had to be turned into a spreadsheet first purely to satisfy the importer. **Enter manually**
now sits beside **Choose file…** (D-045).

**It is the same import with an empty file**, not a second screen. A manual agenda carries the
template's headings and no data rows; the rows come from a new `blankRows` input to `buildPreview`,
and everything after that is the path a file already takes — auto-mapping, validation, the row
editor, the match key, the venue-timezone conversion, the all-or-nothing commit. By the time anything
is written a typed row and an uploaded row are indistinguishable, so there is no second validator to
keep in step.

**The indirection has a reason worth keeping visible.** The obvious implementation — write blank lines
into the CSV body — cannot work: `parseCsv` drops a row whose every cell is empty, so the blank rows
were gone before they could be filled in, and the first attempt produced an import with no rows. Typed
rows are therefore appended after parsing, and a regression test asserts the parser still drops blank
lines so the reason does not quietly stop applying.

**Three things the UI had to learn.** Rows may be added and removed only on a typed agenda — on a file
import the row numbers belong to the file, and renumbering them would detach corrections from the rows
they were typed for, so both routes refuse with `import.not_manual`; removing a row re-keys the
overrides above it, so values typed into row 3 stay with that row when it becomes row 2. **Edit** is
offered on every row of a typed agenda rather than only a problem one, since the editor is how the row
was filled in and hiding it once the row validates would leave no way back to a value that is wrong
rather than missing. And typed rows are numbered from one: a file's rows keep their file numbers so an
error names a row the operator can go and look at, but a typed agenda has no file, and its first row
being called "Row 2" was the headings row leaking onto the screen.

Smaller things the same pass fixed, all visible only once the screen was used this way: `Import 1
sessions` now pluralises; the red banner's file-import explanation ("open Edit on each one… all-or-
nothing") is suppressed on a typed agenda, where the note under the Import button already says it and
the row in question is the one just opened; and the post-commit line no longer promises that
"re-importing the same file" reports every row unchanged when there was no file.

New endpoints: `POST /events/{id}/imports/blank`, `POST /imports/{id}/rows`,
`DELETE /imports/{id}/rows/{row}`.

**A bug this uncovered, fixed in the same pass (D-046).** The screen decided whether an import could
proceed from `row.missing` alone, so a room matching nothing on the event — `blocking`, but with no
missing field, since the cell is filled and merely wrong — left the Import button enabled. Reproduced
end to end: one row, `Main Hal` against an event holding `Main Hall`, `{"created":1}`, and a second
room created from the typo. A row is now blocked if it is missing a required value **or** carries any
blocking issue, which is what SCREEN_SPECS §3 always said. Pre-existing and not specific to typed
agendas; a hand-typed room name is simply a likelier typo than a spreadsheet column, which is how it
surfaced. **`POST /imports/{id}/commit` still does not re-validate**, so this guarantee is the
screen's and not yet the server's — logged in D-046 as separate work.

Verified end to end in the browser against Test Event: entered a session by hand, added a second,
removed it, committed, and confirmed the session, its auto-created room and its speaker in Postgres
with the time converted to the venue's zone (9:00 AM America/New_York → 13:00Z). The file-upload path
was re-run unchanged, and both new routes were confirmed to refuse a file import.

CI green, 212 unit tests (4 new), 116 invariants.

## 2026-09-22 (seventy-sixth) — the time list stops offering to scroll sideways

Travis pointed at a horizontal scrollbar under every time dropdown. Two things made it.

react-datepicker sets `overflow-y: scroll` on the time list and says nothing about the other axis,
and CSS then computes `overflow-x` to `auto` rather than leaving it `visible` — an axis cannot stay
visible while the one across from it scrolls. That is harmless until something overflows, and
something did: the time-only column is the library's 85px, less a 15px scrollbar and the items' 10px
padding either side, leaving 50px for a label like `02:00 AM` that measures 51. One pixel, on sixteen
of the ninety-six rows.

**The column is widened rather than the pixel clipped.** `overflow-x: hidden` alone would have
removed the bar and left the label cut — invisibly here, visibly on any platform whose font renders a
shade wider. The time-only box goes to 92px, which gives 57px for a 51px label; `overflow-x: hidden`
stays as a guard against sub-pixel rounding putting the bar back.

**Two specificity notes, both found by measuring rather than reading.** The library pins the box's
85px through `__time-container __time __time-box`, which outranks a two-class rule — the override has
to match that selector rather than reach for `!important`. And the `--with-time` block, which sets
95px the same way, has the same problem and is unreached anyway: nothing in the app applies that
class, since every picker here is date-only or time-only. Left in place, scoped around rather than
deleted.

Verified in the browser: list `scrollWidth` 77 against `clientWidth` 77 where it was 71 against 70,
and zero items reporting a clipped label where sixteen did. The date picker is untouched.

CI green, 212 unit tests. Invariants not re-run — nothing outside the stylesheet changed.

## 2026-09-22 (seventy-seventh) — the unreached date-and-time picker styles go

Six rules, forty-eight lines, styling a `--with-time` variant nothing has ever applied: the grid that
was to sit a calendar beside a time column, the month container's placement in it, the time column's
96px and its border, the box's 95px, the list's 252px height and the Today button's spanning row.
Every picker in the app is date-only (`DateField`) or time-only (`TimeField`), and the class appears
in no component, no page and not in the prototype baseline.

Two of them were already known to be inert twice over — the box's 95px is written the same way the
time-only 85px was, at a specificity the library's own `__time-container __time __time-box` beats, so
it would not have applied even to a picker carrying the class.

Noticed while fixing the horizontal scrollbar (seventy-sixth), where the question "does this width
reach the other picker?" turned out to have no other picker behind it.

Removed rather than left as a comment: a variant that has never rendered is not a style to maintain,
and the next person to widen a time column should not have to work out which of two blocks is live.
If a date-and-time picker is ever wanted, react-datepicker's own layout is the starting point, not
this.

Verified by measuring the pickers before and after: the time-only box is 92px either way, its list
77/77 with no horizontal scrollbar and no clipped label, and the date picker is 270px with 35 days
and no time column. The create-event wizard's two date fields render unchanged.

CI green, 212 unit tests; the control centre also builds clean, which is where the stylesheet is
actually compiled. Invariants not re-run — nothing outside the stylesheet changed.


## 2026-09-22 (seventy-eighth) — the commit repeats the rule the screen holds

D-046 left the room check as the screen's guarantee. It is the server's now.

**The gap was one rule, not the absence of validation.** `commitImport` already repeated six of the
seven blocking rules the preview applies — empty title, empty room, unreadable date, backwards
session, backwards presentation, presentation outside its session — precisely because the rows arrive
from a browser. It missed the seventh: a room matching nothing on the event. One rule, and it was the
one the typo needed.

The event's rooms are now read once before anything is written, so a room invented by row 1 cannot
validate row 2, and a row naming an unknown room is refused with those names in
`detail.unmatched_rooms`. The condition matches the preview's — only once the event has rooms, since
the first import into an empty event is what defines them, and that path still works.

**A second route to the same duplicate, found while fixing the first.** Validation compares with
`normalise`, which folds separators and repeated spaces; the commit resolved the room with SQL
`lower()`, which does not. "Grand  Ballroom" with two spaces passed the check, missed the lookup and
was created as a new room — the same duplicate by a different door. Both ends use `normalise` now,
against a map read once instead of a query per row, which also stops two rows naming the same new
room on an empty event creating it twice.

Four invariants over HTTP, since the hole was reachable without the screen. Each was run with the
check disabled first and fails there, so none of them can pass for the wrong reason. The two
positive-path cases — an empty event taking the name it is given, an existing room being joined —
pass either way, which is the point of having them.

CI green, 212 unit tests; invariants 120, up from 116.


## 2026-09-22 (seventy-ninth) — a cancelled dialog adds nothing

Travis found it by doing the obvious thing: open **+ Add session**, change your mind, close it. The
row stayed. Three times through and the table read *missing · missing · missing*, three blocking rows
to remove by hand before anything could be imported.

**The order was wrong, not the rows.** The button appended the row and then opened the editor over
it, so the row existed before the operator had committed to anything — fine for correcting a row that
came from a file, wrong for inventing one. The editor now opens over a row-shaped object held only in
the screen, and saving is what appends it, in one request carrying its cells
(`POST /imports/{id}/rows` takes them now). Cancel makes no request at all.

**And the same complaint once rather than three times:** starting manual entry and cancelling
immediately used to leave one empty row, because an import must hold at least one. That now drops the
preview and returns to the three ways in — but only while the row is untouched, so cancelling an edit
of a row that already has values never throws the agenda away. Checked both.

Walked in the browser: three add-then-cancel cycles leave exactly one row; adding and saving creates
the row complete, presenter and all; cancelling an edit of a filled row keeps everything. Two
invariants pin the endpoint side, including that an added row arrives already converted to the
venue's timezone rather than blocking and then filled.

CI green, 212 unit tests; invariants 122, up from 120.


## 2026-09-22 (eightieth) — and leaving with something typed asks first

The seventy-ninth entry stopped a cancelled dialog *adding* a row. It did not stop one *losing*
work: a half-filled session was still discarded in silence, which was the remaining half of the same
complaint.

Cancel and the backdrop now both ask **Discard what you have typed?**, offering **Discard** and
**Keep editing**. Only when the boxes differ from the row behind them — `changed` already computes
exactly that, for a session being invented as well as a row being corrected — so an untouched dialog
closes on one click and the question never becomes the thing you learn to click through.

Two details worth keeping. The question **replaces** the buttons rather than joining them, because a
"Discard" beside the "Save row" it undoes is a misclick waiting to happen. And the **backdrop** goes
through the same check: a click anywhere outside the card is the easiest dismissal to hit by
accident and was the quietest way to lose a filled-in session.

Six paths walked in the browser: untouched Cancel closes with no question; typed Cancel asks; typed
backdrop-click asks; Keep editing returns with the typing intact; Discard on a never-saved first row
drops the agenda and returns to the three ways in; Discard on a saved row returns to the table with
the original value and the edit not applied.

No automated coverage — this is React state in a component, and the frontends have no test runner
wired into `npm test` (CLAUDE.md names Jest for them; nothing is configured). Verified by hand
instead, path by path.

CI green, 212 unit tests, 122 invariants — unchanged, as nothing outside the dialog moved.


## 2026-09-22 (eighty-first) — the drop area does one thing

Travis: the agenda step is congested, move **Enter manually** out of the upload box. It had three
buttons of equal weight inside one dashed border, under two lines of explanation. It was also
incoherent — a dashed border promises a file can be dropped there, and two of the three buttons had
nothing to do with files.

The box is the upload now, and the other two routes are one line under it. Worked against an
uploading-media checklist at the same time (D-048): an upload icon and a real drop target; a visible
drag state (cyan border, tinted field, "Drop it here") held by a depth counter, because
`dragenter`/`dragleave` fire per element crossed and a plain boolean flickers off as the pointer
passes over the text inside; constraints stated before anyone tries and checked in the browser, so a
`.pptx` is named and refused without being uploaded first; and real upload progress.

**Progress needed `XMLHttpRequest`** — still the only way to watch a request body go out — and it
reports two phases on purpose. Bytes arriving is not the end of the wait: the server then parses and
validates every row, so a bar that filled and stopped would sit there while the longest part of the
wait happened silently. It says "Uploading… X of Y" and then "Reading the file…".

Also fixed on the way past: a filename outside Latin-1 would have thrown before a byte was sent, as
neither `fetch` nor XHR will put it in a header. Unrepresentable characters become underscores; the
name is display text and only the extension picks the parser.

Verified in the browser: drag state on and off; a dropped `.pptx` refused by name; a 68 MB file
refused against the 64 MB limit; a dropped CSV read into a two-row preview; and a 41.9 MB upload
showing the bar, the byte counts and the switch to "Reading the file…" before landing as a valid
preview. Wizard step 2 checked too, since that is where the complaint came from.

CI green, 212 unit tests, 122 invariants; the control centre builds clean.

**Note to self:** running `npm run build -w @pmp/control-center` while `next dev` is serving that
workspace overwrites its `.next` and every page starts 500ing with `Cannot find module './673.js'`.
Done it twice now. Clear `.next` and restart the dev server, or build when the dev server is down.


## 2026-09-22 (eighty-second) — a row can be taken out of an uploaded agenda

Travis, against a file import: add an option to remove an entry. D-045 had allowed removal only on a
typed agenda, and that protected the wrong thing — an agenda arrives with rows that cannot be
completed or should not be imported, the commit is all-or-nothing, and one such row held up
everything. The only way out was to fix the spreadsheet and upload it again.

**It works on any row now because it stopped renumbering.** The first implementation deleted the row
and shifted the ones below it up, which is what ruled a file out: an error naming row 12 must mean
the twelfth row of the operator's spreadsheet, and `overrides` is keyed by row number, so a slip in
the re-keying reattaches a correction to the wrong session. A removed row is skipped in
`buildPreview` instead, before anything is read from it — so it leaves the table, the counts, the
issues and the commit together — and every other row keeps its number. The re-keying code is deleted.

One line says how many rows went and puts them back. The last row cannot go: the removal is applied,
the result inspected and the cache restored if the import came out empty, rather than a second count
that could disagree with `buildPreview`.

**Edit moved to every row** while in here. It showed only on rows with problems, so correcting a row
made its Edit disappear — no way back to a value that is wrong rather than missing, which is the
state a row is in immediately after being corrected.

Walked it: a six-row file, removed the row that could not be completed, watched the rest keep their
file numbers 2–6; typed a correction into row 6, removed row 2, and confirmed the correction was
still on row 6; put everything back and got all six rows with the correction intact; and removed the
two blocking rows of a five-row agenda to watch Incomplete rows reach 0 and Import become available.

CI green, 212 unit tests; invariants 126, up from 122 — including the case that would have broken
under renumbering.


## 2026-09-22 (eighty-third) — the agenda's location is taken as given

Travis, on an agenda of online sessions: *Room “Virtual” doesn't match any room on this event.* The
importer refused any location the event did not already have. An event's first import defined its
locations and no later one could add another, so an agenda naming "Virtual" could not be imported at
all — and the message had no "Closest match" clause, meaning the importer had already worked out it
was not a typo of anything, and blocked it anyway.

His call: there is no room to match against, it is a session location — which is what DXG's own sheet
calls the column. So the location is created rather than refused.

**The typo protection survives as advice, using a signal that was already there.** `closestRoom` only
speaks within an edit distance of two and stays silent on a tie, and nothing acted on the difference.
Now a near miss reads *“Main Hal” is not on this event. Did you mean Main Hall?* and anything else
reads *“Virtual” is new — it will be added to this event*. Warnings, not blockers.

This reverses the commit half of D-046 — the rule it enforced is gone, so there is nothing to repeat
— but keeps the part that mattered more: the commit resolves a location through `normalise`, not SQL
`lower()`, so "Main  Hall" joins the existing location rather than forking it. With unknown locations
now created, that is the only thing between a stray space and a duplicate.

The table column reads **Location** now, matching the row editor and the sheet.

Checked with an agenda mixing three "Virtual" rows and one "Main Hal" typo against an event holding
"Main Hall": four rows, zero incomplete, Import available, and the two messages distinct on the rows
they belong to.

**Worth knowing:** locations are `rooms` rows and Room sync reads readiness from an agent heartbeat,
so "Virtual" will sit there permanently offline. Nothing breaks, but a virtual location is not a room
anyone installs an agent in and the screen has no way to say so — a "no agent expected" flag would
fix it. Not built.

CI green, 212 unit tests; invariants 127.


## 2026-09-22 (eighty-fourth) — an import is recorded when it commits

Clearing Test Event turned up 82 `schedule_imports` rows against four sessions. `buildPreview`
inserted one and handed back its id, so a record was written for every look at a file — and the
preview is rebuilt on every correction, re-map, row added and row removed. Travis: only record
commits.

The insert moved to `commitImport`, where an agenda actually becomes sessions. That forced the
commit to stop being keyed by the record the preview had inserted: it is `POST
/imports/{uploadId}/commit` now, the same staging-session id the correction routes already use, and
`import_id` is gone from the preview.

**Authz moved with it.** The cross-event middleware resolved this route's event by looking up the
`schedule_imports` row, which no longer exists by then, so that pattern is gone — and with it the
last `/imports/…` entry, every id under that prefix now being a cache key. The event comes from the
cache and goes to `scopeFor`, which refuses a caller with no role on it. Stronger than what it
replaced: a request body can claim any event, a cache entry cannot, and the route no longer reads
`event_id` from the body.

**One behaviour genuinely changed.** A commit needs a live staging session now. It used to work from
the client's copy alone, so a preview could be committed after the API had restarted and forgotten
the upload; it answers `import.expired` instead, which is what every correction route already does.

The record itself is better than the one it replaces: `diff` is the real outcome rather than the
preview's prediction, `row_errors` is empty by construction, and `status` is `committed` rather than
a `validated` row flipped later. The mapping survives by carrying the one each preview settles on in
the cache — without it an auto-mapped agenda would have recorded none, which the first attempt did.

Measured: upload, five re-validations, then commit — one row, where the same sequence wrote seven
before. Walked in the browser too: a two-row agenda imported, one record, `committed`.

CI green, 212 unit tests; invariants 129.


## 2026-09-22 (eighty-fifth) — two things the import screen no longer needs

Travis, on the agenda step: remove the locked-steps warning and the error-report download.

The warning spent three lines explaining a disabled button and a saved draft, above a step that
already says both without words — **Save & continue** is visibly disabled and *Draft so far* reads
`Rooms — none, import an agenda`. The behaviour is untouched; only the paragraph went.

`Download error report` was a CSV of row · column · severity · problem to carry back to whoever
produced the agenda, and it made sense when fixing a row meant fixing the file and uploading it
again. The row editor fills a row in place now, a correction is re-validated by the code that
rejected it, and a row that cannot be saved is removed from the import — nobody is trapped on this
screen, so a list to take away from it answers a question nobody asks. `saveBlob` stays for the
blank-template download.

The commit row is now just **Import N sessions** and, when something blocks, the sentence saying so.

Checked both: the wizard step 2 reads as one line, the drop area and the two alternates; the import
screen with a blocking row shows the button and the explanation and nothing else. SCREEN_SPECS §3
specified both and has been corrected.

CI green, 212 unit tests, 129 invariants.


## 2026-09-22 (eighty-sixth) — a typed row is saved to the event, not staged

Travis asked why a typed agenda had both **+ Add session** and **Import 1 session**. The honest
answer was that three buttons used two verbs between them and only one of them wrote anything:
**Save row** filled a row, **+ Add session** added another, and **Import** — borrowed from the file
path — was the finishing step. His call: saving a row should be the finish.

So a typed agenda has no commit. `saveTypedRow` writes the session as the row is saved; staging and
all-or-nothing stay for a file, where half a spreadsheet is not a schedule.

**Two decisions he made that shaped it.** A saved row remembers its session id, so renaming and
re-saving updates that session — under the importer's `(location, start, title)` key a rename
changes the key and quietly makes a second session, which is the case the new invariant covers. And
**Remove** now deletes: it turns `danger`, names the session and where it is, warns that presenter
assignments go too, and asks. A staged row needed no confirmation because nothing existed yet.

The per-row work — resolving a location, a track, a day, the presenters — was pulled out of
`commitImport` first and shared, so the two paths build a row the same way rather than drifting. The
invariants were run against that refactor alone before anything new was added.

Three consequences. A typed agenda writes **no** `schedule_imports` record, because there is no
import; each session is audited individually with `via: typed_agenda`, which says more than one bulk
row would. The wizard's later steps, which unlock on the event having a schedule, now hear about the
first saved row through the same callback the commit used. And the last row still cannot be removed,
since the preview needs one row to exist — so a typed agenda's final session has to be deleted from
another screen. Odd; left alone rather than guessed at.

Walked it: saved a row and watched the session appear with the chip reading "on the event" and no
Import button; renamed and re-saved, one session not two; added a second, deleted it through the
confirmation, and checked for orphaned slots and assignments (none) and the audit trail
(created → updated → created → deleted).

CI green, 212 unit tests; invariants 133, up from 129.


## 2026-09-22 (eighty-seventh) — four more things off the agenda screen

Travis, in quick succession: drop the "1 session is on the event…" line, the wizard's "The event
builds itself from the agenda…" intro, the "N new · 0 updated · 0 unchanged — matched on room +
start + title · times in America/New_York" meta, and the Track column.

Each said something the screen already showed. The first restated under the table what the row's own
`on the event` chip says per row. The second described a mechanism above a drop area that already
says what to do. The third repeated the KPI row directly above it, plus a match key that is
machinery and a timezone the row editor states where times are actually typed — and taking it out is
what stopped the table overflowing. The fourth rendered an em dash on every row of every agenda,
because DXG's sheet has no track column and the row editor offers no track field. A file carrying a
Track column still creates its tracks; only the column went.

The typed-agenda footer went with the first one in the wizard, where Back and Save & continue are
directly below and an empty row of buttons would just be a gap.

Checked: seven headers, seven cells, no overflow; the typed path shows only "+ Add session" and
"Open command center →"; wizard step 2 is the drop area and the two alternates and nothing else.

CI green, 212 unit tests, 133 invariants.

**Then removed too, on asking:** the wizard's *Draft so far* panel listed a `Tracks` row showing the
same em dash for the same reason. It is Name, Days and Rooms now — the three things importing an
agenda actually fills in. The `tracks` field stays on the draft payload and on Event details and the
client portal, which show it where tracks exist.


## 2026-09-22 (eighty-eighth) — Bulk remind actually sends

Travis asked what the wizard's `Reminders` field does. The answer was "nothing" — `settings.reminders`
is stored and never read, no scheduler exists, and `T-14 · T-7 · T-2 · missing-file only` is a
description of an intention. Worse, while reading that path: **Bulk remind** on the Speakers screen
raised *"Reminder queued to the N speakers without a file"* and made no request at all. He asked for
that fixed.

It calls `POST /events/{id}/comms/send` with `missing_only: true` rather than gaining its own route,
so it inherits the guards that belong to sending — no invitations before the event has a day and a
room, nothing written to a bounced address, nobody sent the same batch twice — and it reports what
actually happened rather than asserting success.

Verified against the local stack: ten speakers without files, ten mail files written to `.data/mail`,
ten `communications` rows at `sent`, toast reading *"Reminder sent to 10 speakers"*. Pressed again:
no new mail, and *"Nobody was emailed — 10 already received this batch"*.

**Checked before sending anything**, since `.env` says `MAIL_TRANSPORT=ses`: nothing in this repo
loads `.env` — no dotenv, no `--env-file`. The database only works because `packages/db`'s defaults
match compose exactly. So `senderFromEnv()` sees nothing, falls to `FileSender`, and the local stack
cannot send real mail — safe, but by luck, and the SES settings added for the September webhook test
have never taken effect (D-056).

**Left alone, recorded as D-055:** `already_sent` has no time bound, so a speaker can be reminded
once per template, ever. Right for an invitation, wrong for a reminder — the three-reminder schedule
the wizard describes cannot be sent even manually. It touches Communications too and is a decision
about emailing speakers repeatedly.

CI green, 212 unit tests, 133 invariants.


## 2026-09-22 (eighty-ninth) — the resend guard becomes a cooldown

The guard that stops a speaker being emailed twice had no time bound: ever received this template,
skipped forever. FR-COM-002 asks for a T-14/T-7/T-2 cadence, so only the first of the three could be
sent — the product could not do the thing the SOW names, even by hand.

SCREEN_SPECS §9 states the rule as idempotent by `(batch_id, speaker_id)`: re-running *a batch* must
not re-send, a later one may. There is no `batch_id` column, which is why it had been approximated as
"this template, ever". It is 24 hours on `(speaker, template)` now — long enough that a double-click
or an impatient second press sends nothing twice, short enough that any real cadence goes out, the
closest pair in the SOW's being five days apart. Recorded in SCREEN_SPECS as the approximation it is
rather than left looking like the spec's rule.

Adding the column was considered and rejected: nothing re-runs a batch, so it would be a column
nothing reads — the same mistake `settings.reminders` already makes on this screen.

Verified in the browser end to end: ten speakers reminded, a second press sending nothing and saying
why, then the sends aged past the window and a second reminder going out to all ten. Four invariants
cover both halves.

**Two things writing that test surfaced.** `removeTestEvents` deleted an event's structure outside
its savepoint, so the first suite that actually sends mail failed the whole run instead of archiving
the event — and `speaker_tokens`, which sending mints, was missing from its delete list. Both fixed.
And the probe event is reused rather than recreated each run: sending writes `communication_events`,
append-only with DELETE refused to `pmp_app`, so a probe that has sent can only ever be archived.

CI green, 212 unit tests; invariants 137, up from 133.


## 2026-09-22 (ninetieth) — an event opens on one screen

Travis: opening an event should show all of it, and the command centre is not needed as a separate
thing. Two screens described one event — screen 4 answered *how it is going*, screen 18 answered
*what it is*, and neither showed the other.

**Folded 18 into 4, which is the opposite of what the words suggested, for a reason worth stating.**
Screens 1–17 are the client's own prototype and D-010 makes it the baseline — *"the real build
follows its screen structure and terminology (e.g. 'Command center')"*. Command centre is one of the
seventeen and is the example D-010 names; event details is the eighteenth, added by us. Removing ours
keeps the client's inventory whole, removing theirs would have been a scope change needing DXG's
agreement for nothing gained. Travis chose that reading once it was put to him.

`/events/{id}` carries the setup above the live picture now; `/events/{id}/details` redirects rather
than 404s, because it was linked from the portfolio and is bookmark-shaped. The portfolio's `Open →`
points at the merged screen; a draft still goes to the wizard.

**One thing worth having checked rather than assumed:** the setup form now sits on a screen that
re-fetches every five seconds. A value typed into the venue field survives it — `router.refresh()`
re-renders with new props while React keeps component state — and editing, saving and persistence
were walked end to end, then the seeded venue put back.

CI green, 212 unit tests, 137 invariants.


## 2026-09-23 (ninety-first) — a magic link signs the speaker in

Travis asked how a speaker logs in. Answering it turned up that the main way they do — the link in an
invitation or reminder mail — did not work at all: following it pre-filled the code and the portal
then said the code was wrong, which is the worst shape of bug, because the speaker has no reason to
doubt a link they were sent.

A presenter has two kinds of credential and only one was looked up. An access code is typed, so it is
stored normalised — case folded, grouping dashes dropped, O read as 0 and I and L as 1. A magic-link
token is a UUID nobody types, stored exactly as minted. `presenterLogin` hashed only the normalised
form, so the UUID was uppercased and stripped before hashing and matched nothing. Proved by hashing
both and comparing, not inferred.

The lookup tries both forms now. That repairs the links already in inboxes — including the ten
reminder mails sent from this machine yesterday — where re-minting in the code alphabet would not,
and would have traded a UUID's entropy for twelve characters on a credential that travels by email.

Five invariants cover it, and the magic-link case was run against the unfixed lookup first to confirm
it fails there. Walked the real journey afterwards: `/t/<uuid>` → `/login?code=<uuid>` with the field
pre-filled → signed in as the presenter.

**Left alone, recorded in D-059:** `npm run demo:link` has been broken since MFA became mandatory. It
reads the `{"step":"mfa_required"}` 200 as a successful sign-in, never gets a session, and blames
missing seed data for what is an auth failure.

CI green, 212 unit tests; invariants 142, up from 137.
