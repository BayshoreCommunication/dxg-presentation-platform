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

