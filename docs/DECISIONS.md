# DECISIONS.md — Durable Architecture Decisions

## D-001 (2026-08-30): Reuse RFPilot stack — Status: ACCEPTED
Decision: Node.js/TypeScript/Express backend (API + BullMQ worker + outbox dispatcher), Next.js 16 frontends, PostgreSQL/Redis/S3, AWS CDK. Rationale: proven in production for the same client (RFPilot), single team skill set, reusable deployment patterns. Owner: Travis.

## D-002 (2026-08-30): Room Agent in Electron/Node — Status: PROPOSED (provisional until G0-1 PoC passes)
Decision: The Windows Room Agent will be an Electron (Node/TS) app; PowerPoint control via COM from Node (winax or PowerShell bridge), SQLite + content-addressed cache. Rationale: single-language codebase. Risk: COM fidelity — retired by Phase 0 PoC (P0-A). Fallback: thin local sidecar helper for COM only.

## D-003 (2026-08-30): PostgreSQL-only domain store (no MongoDB) — Status: ACCEPTED
Decision: Unlike RFPilot, all domain data lives in PostgreSQL with RLS-based client/event isolation; files in versioned S3; Redis strictly for BullMQ job transport (recoverable from outbox); no authoritative state or caching layer in Redis unless a future decision adds one. Rationale: strongly relational domain (schedule, workflow states, audit chain); simpler operational surface.

## D-004 (2026-08-30): No external Blueprint; we own workflow states and data model — Status: ACCEPTED (state machine itself pending DXG sign-off)
The SRS was generated with Claude Code and the client is tech-agnostic; the "Blueprint data model" and "19-state workflow" it references are not real external documents. We design the state machine (docs/WORKFLOW_STATES.md, Phase 0) and the physical schema ourselves, and present them for client sign-off. Defaults chosen: AWS SES for email, ClamAV for malware scanning.

## D-005 (2026-08-30): Six decomposed lifecycles instead of one state field — Status: ACCEPTED (design), pending DXG sign-off on WORKFLOW_STATES.md
The "19-state workflow" is implemented as six independent lifecycles (processing, inspection, review, per-room sync, session, archive) with orthogonal flags (final lock, restricted-from-distribution). See docs/WORKFLOW_STATES.md.

## D-006 (2026-08-30): No direct DB access across the RFPilot boundary — Status: ACCEPTED (permanent)
All RFPilot integration is via versioned APIs/events only; shared OIDC IdP for staff SSO is PROPOSED. See docs/RFPILOT_INTEGRATION.md.

## D-007 (2026-08-30): G0-8 infrastructure decisions — Status: ACCEPTED (C1 account choice pending Travis confirmation)
From the G0-8 review (docs/infra/G0-8_REVIEW.md): us-east-2 primary / us-east-1 DR; Next.js SSR on Fargate (no Vercel for this product); separate Agent stack; Object Lock governance-mode 3y on audit exports; no RDS Proxy day one; PagerDuty for paging; CloudWatch Logs Insights for MVP; cdk-nag AwsSolutions pack only; per-merge staging deploys; single web service initially. G0-8 verdict: PASS WITH CONDITIONS (C1 dedicated-account confirmation, C2 D2 ratification, C3 re-cost after pilot profile).

## D-008 (2026-08-30): Development-phase infrastructure — one server, shared RFPilot account, ≤$100/mo — Status: ACCEPTED
While in development with 0 users: a single EC2 instance (docker compose: api/worker/dispatcher/cron/postgres/redis/clamav) + one versioned S3 bucket in the RFPilot AWS account (295229565954, us-east-2), everything tagged product=pmp with an $80/$100 billing alarm. See docs/infra/DEV_BOOTSTRAP.md. This OVERRIDES the G0-8 C1 dedicated-account recommendation (C1 resolved: shared account by Travis's decision) and DEFERS the five-doc target infrastructure to pilot preparation — the target designs stand unchanged as the pilot/production plan; SRS NFRs bind at pilot, not during development. Owner: Travis.

## D-009 (2026-08-30): No AWS deployment yet — local Docker is the development environment — Status: ACCEPTED
Development runs entirely in local Docker (docker-compose.yml at repo root: postgres:16 with db/migrations auto-applied, redis, clamav; app services join as they are scaffolded). The Pmp-dev-Bootstrap CDK stack (deploy/aws/) stays drafted and synth-verified but is NOT deployed until Travis decides a shared dev server is needed; the $100/mo cap from D-008 then applies. Cost until then: $0.

## D-010 (2026-08-30): Client-given prototype is the UX baseline — Status: ACCEPTED
DXG was given a 17-screen clickable prototype (preserved as prototype/client-baseline.html): Portfolio, Create event, Schedule import, Command center, Speakers, Presentation detail, Inspection, Review & approval, Communications, Archive builder, SRR (Speaker Ready Room, Check-in, USB intake), Room sync, Room Agent view, Speaker portal, Client portal, plus a built-in 19-step scripted demo. This is the screen inventory (P0-E9) and walkthrough vehicle (P0-E11) of record; the real build follows its screen structure and terminology (e.g. "Command center"). The Client portal appears as a distinct surface in the baseline — implemented as role-gated views per SPEC §2, but its screens/content follow the baseline. The earlier internal sketch (prototype/index.html) remains a workflow-interaction study only.

## D-011 (2026-09-15): Production build specification baseline — Status: ACCEPTED
`docs/BUILD_SPEC.md` (implementation contract) + `docs/SCREEN_SPECS.md` (17 per-screen build contracts, transcribed from `prototype/enhanced.html`) + `docs/ROADMAP.md` (sequenced delivery plan) are the Phase-1 planning baseline. `docs/SPEC.md` remains the interpretation/open-questions document; where the two overlap on implementation detail, BUILD_SPEC wins. Behaviour changes are made in these documents before code, per the spec-first workflow. Owner: Travis.

## D-012 (2026-09-15): Single repository with npm workspaces — Status: PROPOSED
Decision: this product ships as one repository (`apps/api|worker|dispatcher|control-center|speaker-portal|room-agent`, `packages/contracts|domain|db|ui`) rather than RFPilot's four-repo layout. Rationale: the API, two web apps and the desktop agent share one versioned contract and one domain state machine, and must version together — an agent built against N-1 contracts is a correctness risk (FR-AGT-003 N/N-1 policy), and cross-repo drift is the main way that risk materialises. Shared domain logic (the six lifecycles, derived status) must exist exactly once. Trade-off accepted: CI runs more per PR; mitigated by workspace-scoped test filters. Revisit if the agent's release cadence has to decouple from the platform's. Owner: Travis.

## D-013 (2026-09-17): Frontend scaffolding started ahead of the G0-6b visual approval — Status: ACCEPTED (Travis's call)
Context: a client demonstration was required at short notice and the prototype had already been shown. Travis directed that development start and the remaining gate items follow. G0-6b (`VISUAL_ACCEPTANCE.md` §3, 17/17 screen approval) was written to block frontend scaffolding; four screens (Portfolio, Command center, Review & approval, Room sync) were built before it. Mitigation: they are built strictly from the baseline's extracted tokens, terminology and navigation — the fidelity the gate exists to protect — so approval feedback should mean adjustment rather than rebuild. Consequence: the visual acceptance sheet must now be re-run against the **built app** for these four screens, not only the enhanced prototype, and any deviation the sheet raises is a defect on them. The gate still stands for the remaining thirteen screens. Owner: Travis.

## D-014 (2026-09-17): Two principals, no self-service signup — Status: ACCEPTED (Travis's direction)
The product has exactly two kinds of user: **DXG staff** and **presenters**. There is no signup anywhere; every credential is created by DXG. Staff accounts are created by a platform admin or project manager, and presenter credentials are generated by staff from the speaker record. This replaces any assumption that speakers self-register or that staff accounts appear from an identity-provider sync.

## D-015 (2026-09-17): Staff sign in with an in-platform password, not OIDC — Status: ACCEPTED (supersedes SECURITY_MODEL §2 staff clause)
`SECURITY_MODEL.md` §2 specified OIDC with mandatory MFA for DXG staff. OIDC requires an identity provider we do not have and cannot obtain unilaterally — adopting it now would mean no staff can sign in at all until DXG provisions a tenant and issues client credentials. Decision: email + password held by the platform (scrypt, salted, parameters stored with the hash so they can be raised), sessions in an httpOnly cookie with a 12-hour idle and 24-hour absolute expiry, lockout after five failed attempts with a growing window. **MFA is not yet enforced**; `users.mfa_secret` and `mfa_enrolled_at` exist so turning it on is not a schema change on live data. NFR-SEC-02 requires MFA, so this is a deviation to close before the pilot, not a decision to drop it. SSO can be added later as an additional method without changing the session model. Owner: Travis.

## D-016 (2026-09-17): Presenter credential is a DXG-generated access code — Status: ACCEPTED
A presenter receives an access code generated by DXG (for example `K6G6-6G46-XCRU`) and signs in with their email address plus that code. The same value is what the emailed link carries, so one credential serves both doors: click the link, or type the code if the email is lost. Rationale: it satisfies "credentials generated by DXG" literally, it gives presenters nothing to invent or reset at 7am on event day, and email-plus-code means a forwarded or overheard code is not by itself enough. Codes are stored hashed with only the last four characters kept as a hint, expire (45 days by default), are revocable, and issuing a new one retires the previous. The alphabet excludes characters people confuse when reading a code aloud (O/0, I/1/L, S/5, Z/2, B/8), and input is normalised for case, spacing and dashes. Owner: Travis.

## D-017 (2026-09-17): MFA is TOTP, enforced for every staff account — Status: ACCEPTED (closes the D-015 deviation)
NFR-SEC-02 requires MFA for DXG staff. Implemented as TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30-second step) written against the Node standard library: no dependency, no SMS cost, no identity provider, and no third party ever sees a secret. Enforcement is unconditional — an enrolled account's password yields only a short-lived challenge that grants nothing, and an unenrolled staff account can reach the enrolment endpoints and nothing else. There is deliberately **no development bypass**: the seed pre-enrols the development accounts with a known secret (`npm run demo:totp` prints the current code), so local work uses a real second factor rather than a way around one.

Details worth keeping: a code is accepted once (the step counter is recorded, so replaying a code inside its 30-second window is refused); ten single-use recovery codes are issued at enrolment, stored hashed and shown once; removing MFA needs both the password and a live code; the challenge expires in five minutes and dies after five wrong codes.

~~**QR codes are not offered**~~ — **superseded 2026-09-20 by D-021.** The original reasoning: rendering one needs a dependency, and sending the secret to a third-party image service would defeat the point. Enrolment showed the secret grouped for typing, which every authenticator app accepts via "enter a setup key". Owner: Travis.

## D-018 (2026-09-17): SES via the AWS SDK, events via signed SNS — Status: ACCEPTED
Email sends through Amazon SES (SESv2) using `@aws-sdk/client-sesv2` — the first runtime AWS dependency in this repo, and consistent with D-001 (RFPilot uses `@aws-sdk/*`). The alternative, hand-rolling SigV4 against the SES HTTP API, would mean writing request-signing code by hand for a security-critical path; not worth the saved dependency. The SDK is imported lazily so development, which uses the file transport, never loads it.

Configuration is validated at construction, not at first send: `AWS_REGION` and `MAIL_FROM` are required and the transport refuses to start without them. `SES_CONFIGURATION_SET` is warned about loudly because **without a configuration set SES publishes no delivery, bounce or complaint events at all** — the platform would believe every message landed. Credentials come from the standard AWS chain (instance role in production), never the repo.

Delivery events arrive from SES through SNS and are **signature-verified before anything is recorded**. This is not ceremony: a bounce suppresses future mail to that speaker, so an unverified event is a way to silently cut a presenter off from their upload link. Verification checks the signature against the certificate, that the certificate URL is genuinely an `sns.<region>.amazonaws.com` HTTPS `.pem` (checked *before* fetching, so a forged URL is never even requested), that the topic is on the `SNS_TOPIC_ARNS` allowlist, and that the timestamp is recent enough not to be a replay. The platform's own event shape still works in development and is refused in production unless `ALLOW_DIRECT_EMAIL_EVENTS=on`. Owner: Travis.

## D-019 (2026-09-20): Outgoing mail sends as `noreply@av-rfpilot.com` — Status: ACCEPTED (Travis's call)
The platform sends from `noreply@av-rfpilot.com`, the address RFPilot production already uses, superseding `presentations@dxg-agency.com`. The deciding factor is control: `av-rfpilot.com`'s DNS is ours at GoDaddy, while `dxg-agency.com` sits at Namecheap where we cannot publish records — the custom MAIL FROM setup on that domain sat `PENDING` for its full 72-hour window and lapsed without the records ever appearing.

Two costs come with it and are accepted rather than unnoticed. **Speakers receive event mail from a vendor domain rather than their event agency's**, which is a trust and recognition cost on the exact message — "upload your presentation" — that most needs to be believed; `MAIL_REPLY_TO` pointing at a real DXG address is the mitigation and is still unset. **The identity is shared with another product**, so MAIL FROM attributes, DKIM rotation, suppression-list entries and sender reputation are all common: a bad speaker list can damage RFPilot's deliverability and vice versa. The `pmp-email` configuration set separates telemetry, but reputation is per-identity.

One concrete regression came with the switch and is not yet fixed: `av-rfpilot.com`'s apex SPF is `v=spf1 include:spf.em.secureserver.net ?all`, which **does not authorize SES**, whereas `dxg-agency.com` already published `include:amazonses.com`. Mail therefore authenticates on DKIM alone, with no second path. Separately, `_dmarc.av-rfpilot.com` carries two DMARC records, which per RFC 7489 §6.6.3 means DMARC is not applied at all. Both are single DNS edits at GoDaddy and are tracked in `docs/infra/EMAIL.md`. Owner: Travis.

## D-020 (2026-09-20): Speaker replies go to `dxgrfptool@gmail.com` — Status: ACCEPTED (Travis's call), revisit
`MAIL_REPLY_TO=dxgrfptool@gmail.com`. Mail is sent from `noreply@av-rfpilot.com` (D-019), a vendor domain shared with RFPilot, so a speaker who hits reply needs to land somewhere a human reads.

The obvious choice was an address at `dxg-agency.com`, and it is not available: **that domain publishes no MX records at all and cannot receive mail**. A reply-to there would bounce every speaker reply, silently, on the exact message — "upload your presentation" — where a confused speaker is most likely to reply rather than follow the link. That ruled out the whole `@dxg-agency.com` family, not just one address.

`dxgrfptool@gmail.com` is the documented service address for this project and is verified to receive mail. The cost, accepted knowingly, is that external speakers see a gmail address on an otherwise professional communication. **This is a stopgap.** When DXG provides a branded, monitored mailbox it is a one-line env change; `docs/infra/EMAIL.md` carries the note. An address at `av-rfpilot.com` would also work — that domain does have MX — but only if the mailbox genuinely exists, and inventing one has the same silent-bounce failure as `dxg-agency.com`.

Verified by sending through the platform's own `SesSender`, not the CLI, so the whole path `MAIL_REPLY_TO` → `sesConfigFromEnv()` → `ReplyToAddresses` is known to work (`MessageId 010f01a0bd42259b-…`). `packages/email/src/config.test.ts` now covers the env-to-config half so a refactor cannot drop it unnoticed. Owner: Travis.

## D-021 (2026-09-20): Enrolment shows a QR code, rendered locally — Status: ACCEPTED (Travis's call, supersedes the D-017 QR clause)
The authenticator enrolment screen now leads with a scannable QR code, with the typed secret kept underneath as the fallback. This reverses the D-017 clause, at the owner's request, on the condition D-017 itself named — manual entry of a 32-character base32 secret is the most error-prone step in the flow, and it is the step a brand-new colleague meets first.

**The security half of the original reasoning is preserved, not overridden.** D-017 objected to QR codes on two grounds: that rendering needs a dependency, and that a third-party image service would mean handing someone else the secret. The second was the real objection and still stands — the code is generated **in the browser**, from an `otpauth_uri` the API already returned and the UI was discarding. Nothing is sent anywhere; no image service is involved.

The dependency is `qrcode-generator` (MIT, **zero dependencies**, single module, types included), chosen over the more popular `qrcode` which pulls in three transitive packages including a CLI argument parser. Hand-rolling a QR encoder was considered and rejected: unlike the ZIP reader and TOTP this repo does hand-roll, a subtly wrong QR fails silently at the scanner rather than in a test, and correctness could not be established without a reference implementation to compare against. A library that is scanned millions of times a day is the safer choice here.

Verified end to end rather than by eye: the QR was rebuilt independently from the secret displayed on screen, and matched the rendered SVG exactly — 49 modules, viewBox `0 0 57 57`, 1258 dark modules — then enrolment was completed with a code derived from that secret and the account confirmed enrolled. Owner: Travis.

## D-022 (2026-09-20): A password change must actually change the password — Status: ACCEPTED (Travis's finding)
`changeOwnPassword` and `completePasswordReset` both enforced length and a common-password list, and neither checked that the new password *differed from the current one*. So the forced first-use change could be satisfied by re-entering the temporary password.

That is worse than it looks, and worse on this path than on any other. The temporary password is **chosen by an administrator, handed over out of band, and left sitting in whatever chat or email carried it** — it is the one password on the system that is known to at least two people and has crossed an untrusted channel. The whole purpose of forcing a change is to retire it. Re-entering it cleared `must_change_password`, so the account was recorded as resolved while remaining exactly as exposed as the day it was created; nothing in the platform would ever flag it again.

Both paths now compare the candidate against the stored hash with `verifyPassword` — not against the supplied plaintext, so the reset-by-token route is covered too, where no current password is submitted at all. The refusal is `auth.same_as_old`, mapped to 422 alongside the other policy refusals. The wording differs by case: on a forced first-use change it names the temporary password and says why it is not private; afterwards it is the ordinary "different from your current one", because by then it is the person's own.

Proved rather than asserted: `tests/invariants/password-reuse.test.ts` fails 3 of its 5 cases with the fix reverted and passes all 5 with it in place. One of those three is the one that matters most — with the check absent, reusing the temporary password *succeeded* and cleared the forced-change flag. Owner: Travis.

## D-023 (2026-09-20): Password minimum lowered to 6, dictionary widened to match — Status: ACCEPTED (Travis's call)
`checkPassword` required 12 characters; it now requires 6, at Travis's request. The 12 was a choice in code rather than a stated requirement — no SRS or NFR names a length — so this contradicts nothing written down.

**Stated plainly because it is a real reduction:** six is below the 8 that NIST SP 800-63B gives as a floor for user-chosen secrets, and these are staff accounts that can read and change every speaker's material for an entire event. Two existing controls carry the weight that length no longer does. TOTP is enforced for every staff account with no development bypass (D-017), so a guessed password alone buys a five-minute challenge and nothing else. Sign-in locks after five failed attempts with a growing window, which makes online guessing expensive. Neither helps against an offline attack on a stolen hash, where length is what matters — scrypt's cost parameters are the only defence there, and they are stored with each hash so they can be raised without a migration. Raising the minimum later is a single constant, `MINIMUM_LENGTH`.

**The dictionary had to widen, and this is the part that would have been easy to miss.** The common-password list was written under a 12-character minimum, so nothing shorter could ever reach it. At six, `123456`, `qwerty` and `abc123` — the most-guessed passwords in every breach corpus — are suddenly long enough to pass the length rule, and the list is the only thing left refusing them. Lowering the floor without widening the dictionary would have been strictly worse than either change alone. Thirty short entries added.

**An existing test was passing for the wrong reason,** which this exposed: "common passwords are rejected however long" asserted `too_short` against two eleven-character entries, so the old length rule caught them before the dictionary was ever consulted. At six they reach the dictionary and the assertion is now `too_common` — the test finally checks what its name claims. Owner: Travis.

## D-024 (2026-09-20): The first platform admin is created by a script, not an endpoint — Status: ACCEPTED
A deployed installation starts with no accounts and no way to make one: Staff accounts requires a platform admin, and there is none. `scripts/bootstrapAdmin.ts` closes that gap.

**Why not an endpoint.** A bootstrap route cannot authenticate its caller — there is nobody to authenticate against yet — so it would be a URL that mints an administrator, guarded at best by a shared secret in configuration. The script requires database credentials, which is a higher bar than anything HTTP could check, and it leaves no route to forget to remove afterwards.

**Why it is not a back door.** It refuses outright the moment any `platform_admin` exists, naming the account that already holds it. Running it twice cannot mint a second administrator, so it is safe to leave in the repository and in the image.

**Why it asks for a client and an event.** `event_roles.event_id` is NOT NULL with a foreign key to `events`, so on an empty database there is nowhere to hang a role. Rather than invent a placeholder event that would then appear in every listing forever, the script creates the first real one from details supplied on the command line — which is what the first administrator was going to do first anyway. An existing event of the same name is reused rather than duplicated.

**An inconsistency this exposes, recorded rather than fixed.** `rolesFor` reads `SELECT DISTINCT role FROM event_roles WHERE user_id = $1` with no event filter, so a `platform_admin` on any one event is a platform admin everywhere. The storage is per-event; the effect is global. That is why granting the role on the first event is sufficient, and it is also a latent trap: revoking the role on one event does not revoke it. Making `event_id` nullable for platform-wide roles would be the principled fix — `event_roles` appears in no RLS policy, so it is contained — but it is a migration and a change to the grant UI, and belongs in its own decision rather than smuggled into a bootstrap script.

The account is produced exactly as every other account is: a temporary password printed once, `must_change_password` set, no authenticator. Verified on a throwaway database with migrations and no seed — the account signs in, reports `must_change_password: true` and `mfa_enrolled: false`, and is refused everything with `auth.mfa_required` until it enrols. The creation is written to the hash-chained audit as `admin.bootstrapped` with a null actor, because there was no one to act. Owner: Travis.

## D-025 (2026-09-20): Roles are enforced per event, not flattened across all of them — Status: ACCEPTED
`rolesFor` read `SELECT DISTINCT role FROM event_roles WHERE user_id = $1` with no event filter, so the principal carried a flat set of roles and every authorisation check asked only *what* the account could do, never *where*. Holding any role on any one event therefore granted that role's powers on every event in the installation.

**This was a live cross-event hole, not a tidiness problem.** Demonstrated before the fix: `c.delgado`, a content reviewer on one conference and nothing else, read a second conference's summary and speaker list — a different client's material, separated by nothing but the absence of a link to it. SRS §5 is explicit: "Access shall be event-scoped and least-privilege. Client and event isolation is mandatory." So this contradicted a stated requirement rather than an assumption.

**Enforced at `scopeFor`, deliberately, rather than in each service.** That function is the single point every event-scoped route already passes through on its way to the database, so a route added tomorrow inherits the rule instead of having to remember it. Eighteen routes were fixed by one check. It throws a typed `ScopeError` carrying its own status and code; the error handler was widened to render a typed 4xx faithfully instead of flattening everything into "Malformed request".

**`platform_admin` remains platform-wide, and the exception is necessary rather than convenient.** Someone has to create the first event and grant roles on it, which is by definition done from outside any event — `scripts/bootstrapAdmin.ts` depends on exactly this. Every other role, project manager included, is now held on an event or not at all.

**The event list had to follow.** The portfolio listed every event and then fetched a summary for each, so once per-event scoping landed, a manager on one event got a page of refusals. `GET /events` now returns only the events the account holds a role on. That is the same requirement applied one level up: a list of things you cannot open is useless, and naming another client's event to someone with no role on it is itself a small disclosure.

Twelve cases in `tests/invariants/event-scope.test.ts` across nine surfaces. Verified by reverting the check and re-running: **10 of 12 fail without it, 12 of 12 pass with it.** **Half-finished, and superseded 2026-09-21 by D-034** — this closed the eighteen routes that name an event in their path and left the twenty that name a resource instead, and it kept `rolesFor` flat so the check could only ask *whether* a role was held here, never *which*. Owner: Travis.


## D-026 (2026-09-20): The agenda defines the rooms — the wizard stops asking for them — Status: ACCEPTED (Travis's call)
The create-event wizard's step 2 was two free-text boxes, "Rooms" and "Tracks". It is now the schedule import, run against the draft event. Steps 1, 3 and 4 are unchanged.

**The manual step was not just redundant, it was actively harmful.** `commitImport` already creates rooms, tracks and event days from the committed agenda — that code predates this change and is untouched by it. So typing rooms in first did not save work; it created a second list that the spreadsheet then had to agree with. `buildPreview` treats an unrecognised room as a *blocking* error when the event already has rooms, so a project manager who typed `Ballroom B` and received a file saying `Ballroon B` got a blocked import — on data they did not author and often could not correct at source. Removing the box removes the disagreement: on an event with no rooms the importer creates what the file names, and the typo-suggestion path stays for the re-import case, where a mismatch genuinely means something changed.

~~**Step 2 is skippable, deliberately.**~~ — **superseded 2026-09-21 by D-027.** The original reasoning: an event can be activated with no agenda and imported later from screen 3, so making the import mandatory would turn a draft into a trap for anyone who does not yet have the spreadsheet.

~~**What this costs.**~~ — the cost described here (an event reaching `active` with zero rooms) no longer arises, because D-027 makes the import mandatory.

**The import could not actually read DXG's file, and that was found by running it rather than by reading it.** The supplied Preseria template (`v.1.3`) has a banner on row 1, the real headers on row 2 and two annotation rows (`max 255 chars.` / `REQUIRED`) below. `buildPreview` destructured `const [headers, ...dataRows] = sheet`, so it mapped the banner as the header row and validated `REQUIRED` as a session. Three defects fell out of that, none of which any existing test could see:

1. **The header row is now found, not assumed** — the first rows are scored against the field synonyms and the best-scoring one wins, with annotation rows below it dropped.
2. **A blank header no longer matches anything.** `normalise("")` is `""`, and `"".includes("")` is true, so under the fuzzy pass every empty trailing column claimed the next unused field: the banner row's eight empty cells were mapped to `session.title`, `room.name`, `session.start`, `session.end`, `speaker.name`, `speaker.email`, `speaker.organization` and `track.name` in order.
3. **`Presenter 1 Email` mapped to `speaker.name`,** because the fuzzy pass tries `speaker.name` first and `"presenter 1 email"` contains `"presenter"`. `Presenter 2 Email` then took `speaker.email`. The platform would have filed presenter 1's address as their display name and **sent every upload invitation to the second presenter** — a silent wrong-recipient bug on the one message the whole product exists to deliver. Exact-match now runs ahead of substring match per column, and an unmapped column is preferred over a wrong one.

`speaker.first_name` and `speaker.last_name` were added as first-class fields, since the template splits them and joining in the mapping layer was the only alternative.

**Two further defects surfaced only by running the thing.** Neither was visible in the source, and neither was reachable before this template arrived:

4. **Every imported session was a day early on any server east of Greenwich.** `toDateTime` produced its date with `new Date(value).toISOString().slice(0, 10)` — an instant resolved in the *server's* timezone, then read back in UTC. On this machine (Asia/Dhaka, UTC+6) `05/16/2023` became `2023-05-15`, and `03/01/2026` became `2026-02-28`. Production runs on UTC and would never have shown it; every agenda imported during development was silently wrong. `toCalendarDate` now reads the parts with the same clock that parsed them, and matches `mm/dd/yyyy` explicitly rather than leaving the one genuinely locale-ambiguous format to the engine.
5. **Schedule import could not work from a browser at all.** `Access-Control-Allow-Headers` listed `content-type, authorization`; the upload sends the filename in `x-file-name`, so the preflight failed and the request was never sent. This was not introduced here — screen 3 has had it since it shipped, and it went unnoticed because every test of the import ran from a script, where CORS does not apply. `tests/invariants/cors.test.ts` now asserts the preflight against the running API for each custom header the web apps send.

The second of those is the more useful lesson: a suite that never acts as a browser cannot see a defect that only a browser has. Owner: Travis.


## D-027 (2026-09-21): The import is mandatory, and an incomplete agenda is finished on the screen — Status: ACCEPTED (Travis's call, supersedes the D-026 skippable clause)
Three changes, one intent: the wizard should not let an event exist on a half-imported schedule, and should give the operator everything they need to complete one.

**Step 2 now blocks steps 3 and 4.** D-026 made it skippable, reasoning that a mandatory step traps anyone who opens the wizard before the spreadsheet exists. Travis's call reverses that, and the reasoning that replaces it is stronger: the rooms, days and sessions of the event *are* the agenda, so an event without one is not a partly-configured event, it is an empty one. The trap the original clause worried about is answered instead by the draft persisting — leave and come back — and by the template below, which means "I do not have the spreadsheet yet" now has an answer inside the product. The rule is enforced on the forward button *and* on the step chips, because a chip is a navigation control and a rule on only the button would be a suggestion.

**A missing required value is filled in on the screen, not in Excel.** The agenda usually arrives from someone other than the person importing it, so "go and fix the file" can mean an email and a day's delay for a blank cell. Each staged row now reports exactly which of `session.title`, `room.name`, `session.date`/`session.start` it has no usable value for, and the preview table puts an input in precisely those cells.

**The correction is a cell value, and the server re-validates it.** `POST /imports/{uploadId}/cells` takes `{row, field, value}`, stores it against the cached upload and runs the whole file back through `buildPreview`. The alternative — editing the staged row in the browser — would have meant a second implementation of the date parsing and the venue-timezone conversion in the client, which is precisely the code that was silently a day out until yesterday (D-026 item 4). It would also have left the diff wrong: changing a room or a time changes the `(room, start, title)` match key, so whether a row reads `create` or `unchanged` has to be recomputed, and only the server can do that. An override is read at the single point every field is pulled from the row, so a typed cell is indistinguishable from the file having said it.

**A blank template is generated, not stored.** `GET /events/{id}/agenda-template` builds the CSV from the same field list the mapper uses, so the template cannot offer a column the importer does not read or omit one it now requires — the failure mode of a static file is sending someone away to fill in the wrong thing. It mirrors the vendor template's shape (banner, headings, format hints, REQUIRED/OPTIONAL, one example row) deliberately: that is the layout DXG already works in, and it means the template exercises the same `findHeaderRow` path as the files we actually receive, rather than testing an easy case forever. The example row is marked `EXAMPLE` in its first cell and dropped on import, so filling the sheet in underneath it without deleting it does not create a session called "EXAMPLE — delete this row".

**Our own template caught a mapping bug of the same family as D-026's.** `Presenter Organization` mapped to `speaker.name`, because the substring pass tries `speaker.name` first and the header contains "presenter" — so the organization became the presenter's display name and the `Presenter First Name` / `Presenter Last Name` columns, though correctly mapped, were discarded by the `speaker.name ||` precedence. "Dana Reyes" imported as "Example Institute". The round-trip test that should have caught it asserted only the *required* columns and the email; it now asserts every column of the template against the field its heading names. `organization` joined the decisive-keyword list.

**Two defects fixed in passing, both on this screen.** The import preview rendered every session time in a hardcoded `America/New_York`, so an event in Berlin showed New York clock times — the preview now carries the event's timezone and uses it. And `Download error report` raised a toast listing row numbers; it now downloads the CSV that `SCREEN_SPECS` §3 describes, which is the thing an operator can send back to whoever produced the agenda.

Owner: Travis.

## D-028 (2026-09-21): The column-mapping table is removed; the data shows the mapping — Status: ACCEPTED (Travis's call)
Screen 3 opened with a `Column mapping` card: one row per source column, a `platform field` select, a `mapped ✓` tick. It is gone. The sessions table below it now carries what was actually read from the file — session, room, date, time, presenter with address and organization, track — under the heading "Sessions read from `<filename>`".

**The table asked the wrong person to check the wrong thing.** It made every operator audit the mapper's work on every import, in the mapper's vocabulary (`speaker.email`, `room.name`), before they were allowed to look at their own agenda. And it was a poor check even so: `session.title ✓` tells you a column was mapped, not that it was mapped *correctly*. Both mis-mappings this project has actually hit — `Presenter 1 Email → speaker.name` (D-026) and `Presenter Organization → speaker.name` (D-027) — would have shown a full row of ticks. What catches them is seeing an email address sitting where a presenter's name belongs, which is what the data table now shows.

**One piece of it had to survive, and it is the piece that was doing real work.** The selects were also the only way to correct a heading the mapper did not recognise. Deleting them outright would mean a file whose room column is headed something unexpected has *every* row missing a room, an input in every one of those cells, and no way to say once what the column is. So the repair remains, scoped to the case that actually breaks: when a **required** field has no column mapped at all, one select appears per missing field — "Which column is this?" — and choosing re-reads the whole file. On a file we understand, which is the normal case and the one Travis was looking at, nothing appears.

This is a narrowing, not a restoration by the back door: optional fields are no longer re-mappable, and a column mapped to the *wrong* field can no longer be corrected directly — it is corrected by the per-cell edits from D-027, or by fixing the heading and re-uploading. That is a real reduction in what can be repaired in place, accepted because the case it covers is rarer than the cost of the card was frequent.

**Two display faults fixed with it,** both of which made correct data look wrong. A file with no end-time column gets `ends_at = starts_at` from the importer, which rendered as `09:00–09:00` — a zero-length session rather than an unknown end. And a presenter with an address but no name rendered as `— address`, a missing value sitting next to a present one instead of the one fact we have. Owner: Travis.

## D-029 (2026-09-21): The blank template is DXG's own sheet, column for column — Status: ACCEPTED (Travis's call)
The generated template offered ten columns of our own choosing (`Track`, `Presenter Email`, `Presenter Organization`, …). It now reproduces the Preseria import template v.1.3 exactly: the same fourteen headings in the same order, the same format-hint row, the same REQUIRED/OPTIONAL row.

**Because a template that is not the sheet they already use is a second format, not a help.** Event organisers receive the Preseria sheet, fill it in and send it back; that is the file this platform actually gets. A DXG-branded template with different column names would mean either reconciling two layouts by hand or sending organisers a sheet that does not match the one they already know. Matching it also keeps the template honest about what the importer sees: the same columns, exercised by the same `findHeaderRow` path, rather than an easy case we made for ourselves.

**Columns we carry and deliberately do not map.** `Presentation Start`, `Presentation End` and `Presentation Duration` describe a presentation *inside* a Preseria session; this platform's schedule is sessions and slots with no equivalent sub-presentation time, so folding them into the session's own times would be inventing a meaning. The `Presenter 2` columns are recognised and unmapped because only presenter 1 becomes the assigned speaker — a second presenter is a second speaker assignment, and the import screen is not where that is decided. Carrying them named-but-unmapped is deliberately different from dropping them: the operator can see we read the column and chose not to use it.

**One heading is corrected, and this is the one deviation — confirmed by Travis when offered the flip back.** DXG's sheet labels its eleventh column `Presenter 2 Last Name`. It is presenter 1's surname: it sits between `Presenter 1 First Name` and `Presenter 2 Email`, and it is marked REQUIRED where every presenter 2 field is optional. Reproducing the wrong label in a template *we* hand out would invite organisers to put the second presenter's surname in the first presenter's column — a data fault we would be manufacturing rather than inheriting. Ours reads `Presenter 1 Last Name`. **Files still carrying the original label import identically**, because the mapper takes the first unclaimed match, and a test asserts the two map the same way so this cannot regress.

This was put to Travis explicitly, with the byte-identical alternative offered as a one-word change: "keep Presenter 1 Last Name, don't flip it". It is a decision, not an oversight — anyone who later notices our template differs from Preseria's by one cell should not treat that as drift to be tidied away. The right fix is at DXG's end, where the label is wrong.

**What this drops.** The template no longer offers `Track` or `Presenter Organization`, because DXG's sheet has neither. The importer still reads both when a file supplies them; they are simply not columns we now hand out. If DXG wants them, they are two entries in `TEMPLATE_COLUMNS`. Owner: Travis.

## D-030 (2026-09-21): A problem belongs to its row, and is fixed in a dialog that shows the whole row — Status: ACCEPTED (Travis's call)
The validation card is gone. A row that cannot import is filled with the blocking colour, a row with only warnings with the warning colour, and both carry an **Edit** action beside their status chip; clicking it opens the row in a modal with every mapped field populated.

**The card scaled with the wrong thing.** It listed one paragraph per issue, so an agenda of eleven sessions none of which named a presenter produced eleven identical sentences — "Row 5 · No presenter name…", "Row 6 · No presenter name…" — stacked above a table that already had eleven rows in it. The information was real and the presentation made it worthless: nothing distinguished the rows from one another, the list was longer than the data it described, and the row numbers were a cross-reference the reader had to resolve by hand. Attaching the same facts to the row they belong to costs no information and removes the lookup.

**Two colours, not one.** A blocked row stops the import; a warned row does not. Colouring them alike would have made eleven rows that merely lack a presenter name look as urgent as the one row with an unreadable date, which is the same failure the card had in a different form.

**Why a dialog rather than the inline inputs it replaces.** D-027 put an input directly into the offending cell, which was direct but showed a value with nothing around it: an operator typing a room could not see the session it belonged to or the date beside it — exactly the context needed to know *which* room it should be. The modal states the row's problems, marks the missing fields `· required`, and shows the other eight fields as the evidence for what to put in. It also gives the typo suggestion somewhere to live: "Room 'Ballroon B' … closest match: Ballroom B" is now a button that fills the box, next to the box it fills.

**One request per row, not one per field.** `POST /imports/{uploadId}/cells` now accepts `{row, cells}` as well as `{row, field, value}`. Saving three fields as three requests would re-read the whole file three times and let the responses race — the last to arrive would win rather than the last edit made. Save is refused while any required field of the row is still empty, so the dialog cannot be used to half-fix a row.

**What this costs.** Only rows with a recorded issue offer `Edit`, so a row that imported cleanly but is *wrong* — a title with a typo the validator cannot see — still has to be corrected in the file and re-uploaded. Accepted: putting an edit control on every row of a 200-row table would reintroduce exactly the noise this removes. Owner: Travis.

## D-031 (2026-09-21): The row editor is the whole sheet row — presentation times and a second presenter are imported — Status: ACCEPTED (Travis's call)
The editor showed a field this platform's words called "Room / location" and omitted three columns of DXG's sheet entirely. It now mirrors the template: the same headings, `Session` / `Presentation` / `Presenter 1` / `Presenter 2`, with `Presenter Organization` removed.

**Labels first, because that was the smaller half of the complaint and the easier mistake to make.** "Room / location", "Start time" and "End time" are the same fields as `Session Location`, `Session Start` and `Session End` — but to someone holding the spreadsheet they were filled from, they read as different ones, which is why they were reported missing when they were on screen. A field in this dialog and a column in that sheet are now recognisably the same thing.

**`Presentation Start`/`End`/`Duration` were genuinely absent, and putting editable boxes on screen for them would have been a lie until they had somewhere to go.** A Preseria session holds several presentations; a presentation inside a session is exactly what a slot is — and `slots` carried only `position`. Migration `010_slot_times.sql` adds nullable `starts_at`/`ends_at` with a `CHECK (ends_at >= starts_at)`. Additive: every existing slot keeps its meaning, and a slot with no time of its own runs with its session, which was the only case that existed before. `Duration` is minutes and is consulted **only when no end time is given** — a sheet carrying both and disagreeing means the published end wins, because that is the one an attendee was told.

**A second presenter is a second assignment, not a second slot.** `speaker_assignments` has always allowed several speakers per slot; the import simply never used it. Two people presenting one talk share the talk, its file and its approval, which is what that table already expresses. D-026 and D-029 said this was "not for the import screen to decide"; Travis has now decided it. The editor keeps the fields collapsed behind **+ Add another presenter** and opens them when the file already named one — three empty boxes on every row of an eleven-row agenda is the noise D-030 just removed. Removing a presenter clears the fields as well as hiding them, because a hidden box holding a value the operator thinks they deleted is how a wrong presenter gets imported.

**Which presenter a column belongs to is decided by position, not by the number in the heading.** This is forced by D-029: DXG's sheet labels presenter 1's surname `Presenter 2 Last Name`. Matching on the ordinal would file it under presenter 2 and leave presenter 1 with no surname — worse than before the second presenter existed. The first email column is presenter 1's, the second is presenter 2's, whatever the headings say; both sheets then map identically, and two tests hold that.

**Two defects found while doing it, both by running the importer rather than reading it.**

1. **`toDateTime` invented 09:00 for a missing clock.** For the optional `Presentation Start` it gave a slot time to every row that left the column blank. Far worse, for `Session Start` it meant a blank cell produced a usable `starts_at` — so the row passed the required-field check that the template's REQUIRED row, `REQUIRED_FIELDS` and the row editor all promise to enforce. **`Session Start` was never actually required.** An absent clock now yields nothing.
2. **`session` alone was a synonym for `session.title`,** so on a sheet with no explicit title column `Session Start` claimed the title on the substring pass. Session times are decided by a decisive rule now, after the presentation ones, so the qualifier settles which time a column is.

Owner: Travis.

## D-032 (2026-09-21): Pickers, one line per group, and no Track in the row editor — Status: ACCEPTED (Travis's call)
The editor was a two-column grid of identical text boxes, fifteen of them, which scrolled. It is now laid out a line at a time — session title and location; date, start and end; the presentation's start, end and duration; each presenter's first name, last name and email — with a control chosen per field rather than one control for everything.

**A time typed as text is a time that can be typed wrong.** `h:mm AM/PM` is the format the sheet asks for and the format the parser accepts, and neither fact helps the person who writes `3.30pm`. Times are `<input type="time">` and the date is `<input type="date">`; both hand back values the importer already reads (`HH:MM` is accepted by the clock rule, ISO by `toCalendarDate`), so nothing about the parsing changed to accommodate them. **The date picker was not asked for** and is included because it is the same one-line change against the same class of mistake — mm/dd/yyyy typed by hand is the single most error-prone cell in the sheet. Easy to revert if it is unwanted.

**A picker cannot show a value it cannot parse, and blanking it would destroy the evidence.** A cell reading `half past three` has no representation in a time input, and rendering an empty picker would silently discard the very thing the operator opened the row to fix. `toTimeInput`/`toDateInput` return `null` for such a value, and the field falls back to a text box holding it, outlined in the blocking colour, with "Not a time we can read — clear it to use the picker."

**The duration slider goes to 240, not the template's 999.** Five-minute steps over 999 minutes is two hundred positions to land on 45; a slider that cannot be aimed is worse than the number it replaced. 240 covers any real presentation. A file carrying more is **shown, not clamped** — the value appears with a note and a `Clear` button, because silently rewriting an operator's data to fit our control is the one thing a picker must never do. Zero means "not set" rather than a zero-minute presentation, so the slider at rest and an empty cell are the same thing.

**`Track` is gone from the editor.** DXG's sheet has no such column (D-029), so it was a box nobody could be asked to fill from the file in front of them. The importer still reads a `Track` column when a file supplies one, and a row's existing value survives editing because only changed cells are sent. Owner: Travis.

## D-033 (2026-09-21): Presenters are a list of up to six, and the editor's groups are boxed apart — Status: ACCEPTED (Travis's call)
`speaker2.*` was a second set of fields bolted beside the first, so there could never be a third. Presenters are now a list: `PRESENTER_PREFIXES` generates the fields, the importer collects everyone a row names into `StagedRow.presenters`, and the commit loops. Six is the cap.

**Six, and the cap is a judgement not a limit of the schema.** `speaker_assignments` would take any number; the mapper, the template and the editor all have to enumerate them, and six columns of each kind is already three times what any DXG sheet has carried. A seventh presenter column maps to nothing rather than silently becoming the sixth — a test holds that.

**Removing a presenter shifts the ones below it up.** Clearing in place was the easier implementation and the wrong behaviour: it would leave presenter 3's details in a block the next render labels "Presenter 2", or — worse — leave a hidden block still holding a name, which is how somebody nobody meant to keep gets imported. Verified by filling three and removing the middle: the third moved up, the count fell, and the import wrote exactly the two that remained.

**The organization belongs to presenter 1 only.** DXG's sheet has one organization column and it sits inside presenter 1's block. Applying `row.organization` across the loop — which the naive generalisation does — would have put the first presenter's employer against the name of every co-presenter.

**The groups are boxed rather than merely headed.** A heading over a continuous run of inputs still reads as one long form, and this form has two sets of times in it: a session's end and a presentation's start sat adjacent and looked like the same kind of thing. A border costs a little height and removes the question.

**The slider's floor is 5, not 0.** A zero-minute presentation is not a thing, so the lowest position the control can reach is the shortest real one; "not set" is still reachable through `Clear`, and remains what an untouched slider means. `Clear` moved onto the label line — beside the slider, in a third of a 560px dialog, it was clipped off the edge, which the screenshot showed and the code did not.

**The dialog is 560px, down from 760.** Three-up lines survive it because they wrap on `auto-fit` with a floor rather than being crushed: one line at 560, two on a phone, no breakpoint to maintain. Owner: Travis.

## D-034 (2026-09-21): Cross-event authorisation, finished — the event is resolved from the resource, and roles are held on it — Status: ACCEPTED
D-025 said the event check belonged at `scopeFor` because "this is the single place every event-scoped route passes through, so a route added tomorrow inherits the rule instead of having to remember it". That was true of the eighteen routes whose path contains `/events/{eventId}/`, and false of the twenty that name a resource directly: `GET /slots/{id}` never mentions an event, so `scopeFor(req)` was called with nothing to check and the guard did not run. Demonstrated before this change: an account with no role at all on an event read that event's talk, its inspection findings and its comments, and **wrote an internal comment on it** — while the three parent-routed surfaces beside them returned 403.

**The event is now resolved from the resource, in middleware, keyed by URL shape.** A table maps each prefix to the SQL that finds the owning event — slots directly, file versions through `files`/`slots`, findings through the version, rooms, room files, SRR check-ins, speakers, archive packages. Matching on the path rather than on Express route params is deliberate: `app.use` middleware never receives params, and a table keyed by prefix means a route added under an existing one inherits the rule for real this time.

**The middleware has to run after the principal exists, and nearly did not.** Registered where it was first written it sat above the session middleware, so `principal` was always undefined and every request fell straight through — a check that passes everything, which is worse than no check because it looks like one. Caught by reading the registration order, not by a test: the suite was green either way, because the routes it covered were refused by `scopeFor` regardless.

**A missing resource is 404 and another event's resource is 403.** Collapsing them would tell a project manager who mistyped a URL that their own talk had vanished. These are staff-only routes behind a session and the ids are UUIDs, so confirming existence is not a practical enumeration risk.

**The refusal is recorded.** BUILD_SPEC I-4 requires cross-event access to be "blocked, logged and alerted"; only the blocking existed. Each refusal now appends `security.cross_event_attempt` to the hash-chained audit against the event that was reached for. Alerting remains unimplemented and is not claimed.

**Roles are now held on an event, which is what `event_roles` always stored.** `rolesFor` selects `DISTINCT role` with no event filter — right for "may this account use the staff area at all", wrong for everything else. `actorFrom` filters the principal's roles to the request's event before handing them to the domain, so `hasAnyRole(actor, atLeast("presentation_manager"))` finally asks whether they manage presentations *here*. Before this, a room technician on this event who managed presentations on any other could waive blocking findings and roll back approved versions on this one. `platform_admin` survives the filter, for the reason D-025 gives.

**Granting a role is scoped too, and it is the escalation that made the rest moot.** `POST /admin/users/{id}/roles` takes its event in the body, where the path resolver cannot see it, so it asked the flat question and a project manager on one conference could grant themselves any role on another. The handler now names the event before authorising.

**Thirteen cases in `tests/invariants/cross-event.test.ts`, proved one half at a time**: reverting the path resolver fails 7 of 11; reverting the event-scoped roles fails the waive case; reverting the role-grant scoping fails the escalation case. Two of those tests first passed for the wrong reason — the resolver refused them before the role check was reached — and needed an actor who *is* on the event but holds the wrong role there, which is why the suite creates two accounts rather than one.

**What this costs.** One indexed lookup per request that names a resource directly, before the handler's own transaction. Negligible against the NFR budgets, and the alternative — threading the event through twenty handlers by hand — is the arrangement that produced this defect.

~~**Still open, and not addressed here: RLS is inert.**~~ — **closed 2026-09-21 by D-035.** `db/migrations/005_rls.sql` is correct, but the application connects as `PGUSER=pmp`, the compose superuser, which bypasses every policy. `scopeFor`'s own comment says "RLS — not a hardcoded id — decides what it can see", and for client-side accounts that is currently backed by nothing. This change puts the application-layer check in place everywhere; the database-layer one still needs the app to stop connecting as a superuser. Owner: Travis.

## D-035 (2026-09-21): The application connects as `pmp_app`, so row security finally applies to it — Status: ACCEPTED
Migration 005 built the entire client-isolation story in August: row security enabled *and* FORCEd on every tenant table, a policy per table granted `TO pmp_app`, UPDATE and DELETE revoked on the append-only tables. Then the application connected as `pmp` — the schema owner, and a superuser.

**A superuser bypasses row security, so every one of those policies has been dead since the day it was written.** Demonstrated at the start of this session and again before the fix: a session scoped to a client id that does not exist read every event, every speaker and every file version in the database. `scopeFor`'s own comment says "RLS — not a hardcoded id — decides what it can see", and for client-side accounts that was backed by nothing at all.

**The fix is one line of configuration and a migration that makes it possible.** `pmp_app` was created `NOLOGIN`, which is why it was never used; `011_app_role_login.sql` gives it LOGIN, re-grants on every table and sequence (005's one-time `ON ALL TABLES` never covered the tables migrations 006–010 added), sets default privileges so the next migration's tables are covered without anyone remembering, and re-applies the append-only REVOKEs *after* the blanket grant — which would otherwise hand back exactly what 005 took away. `packages/db` now has two pools: the application's, and the owner's for migrations and the seed, which are the only things that need DDL.

**The credential is deliberately not in the migration, and the reason cost an hour.** The first version ended with `ALTER ROLE pmp_app WITH LOGIN PASSWORD '…'`. A role is cluster-wide and a migration is per-database, so migrating a *second* database silently rotated the password the first one was using — which is precisely what happened, twice, and presented as "password authentication failed" on a database nobody had touched. It is also the wrong place for a secret: the file is in the repository. `scripts/ensureAppRole.ts` sets it from `PGPASSWORD`, and `db:migrate` and `db:reset` call it.

**What it costs.** Nothing the application does, verified: 208 unit tests, 88 invariants and the whole staff surface behave identically. What the application *cannot* do any more is the point — it owns nothing, cannot create or alter a table, cannot `SET ROLE` back to the owner, cannot update or delete an audit record, and cannot read the migration ledger. Four of the twelve cases in `tests/invariants/rls-isolation.test.ts` assert exactly those refusals.

**The suite is the other half of this decision, and could not have been written before.** Isolation between tenants is untestable with one tenant, and the seed has one client — so it makes a second, proves each sees only its own rows through a bare `SELECT` with no `WHERE` clause, proves a write into the other client is refused by `WITH CHECK` rather than by the application, and takes both away again. **Reverting the connection to the owner fails all twelve.**

**Still not closed:** `users`, `event_roles`, `venues`, `client_grants` and `retention_policies` carry a `USING (true)` policy from 005 — RLS is on and the posture is explicit, but the rows are app-mediated because those tables have no `client_id`. 005 says tightening them waits on the role × permission matrix (P0-E8), and that is still true. Owner: Travis.

## D-036 (2026-09-21): An unfinished event is resumed, not reopened as a running one — Status: ACCEPTED (Travis's finding)
Every card in the portfolio linked to `/events/{id}`, drafts included. Travis: clicking an unfinished
event should go to the create-event flow, not the command centre.

**The command centre cannot describe a draft, and did not admit it.** Opened on an event with no
rooms, no sessions and no talks it rendered a green `live` indicator, `0 / 0` collected, `0 / 0` rooms
ready and *"Nothing at risk — every talk is synchronized onsite."* Every one of those is the
reassuring reading of an absence. It is the same defect the sixtieth entry fixed in the header, in a
different place: a screen stating operational facts it has no basis for.

**And the setup that event still needed was reachable from nowhere.** The wizard held its state in
React only and always started at step 1, so a draft abandoned at any point could not be picked up
again — `/events/new` would have created a *second* draft beside the first. The three abandoned
drafts in the development database are what that looks like after a fortnight.

**The rule lives on the command centre, not only on the card.** A draft that reaches `/events/{id}`
is redirected to `/events/new?event={id}`. Putting it only on the portfolio link would have fixed the
click Travis reported and left the sidebar's event switcher — which lists drafts too — pointing at
the same dead end, along with any bookmark.

**Resuming means the draft has to carry back what was typed.** `EventDraft` was `{id, name, status,
rooms, tracks, days, settings}`, which is not enough to refill step 1: venue, timezone and both dates
were written at creation and never read again. It now carries those, plus `branding` for step 4 and a
`sessions` count — the durable form of the question D-027 gates steps 3 and 4 on. `imported` only
ever knew about an import performed in the same browser session, so on a resumed draft it is null
however complete the agenda is; `commitImport` writes sessions, so counting them is the answer that
survives leaving the screen.

**Step 1 is editable while the event is a draft, and this is the half that could have gone wrong
quietly.** Re-showing the boxes without saving them would have been a form that accepts typing and
discards it — the trap D-033 removed from the row editor, arriving by a different door, and worse
here because a wrong date is exactly the reason someone abandons setup. `PATCH /events/{id}` takes
`basics` now, sharing one `checkBasics` with creation so the two doors cannot drift, and the wizard
sends it only when something actually changed, so returning to a draft and pressing on does not
rewrite its dates or write an audit record claiming it did.

**Editing dates moves the event's days, which is where the danger is.** Days are reconciled to the
new range — missing ones inserted, uncovered ones deleted. A day carrying sessions is refused
(`events.days_conflict`, naming the day), not cascaded: the wizard cannot reach that state, because
step 1 sits behind an agenda-gated step 2, but the endpoint can be called directly and a silent
cascade would drop an imported agenda on a mistyped date. After activation the basics are refused
outright (`events.not_a_draft`) — dates, timezone and venue are load-bearing for sessions, room files
and every deadline computed from them by then, and moving them is a rescheduling job, not a
correction.

**A venue row is never renamed in place unless this event is the only thing pointing at it.**
`duplicateEvent` copies `venue_id`, so editing the venue on a duplicated draft would have renamed it
under the event it was copied from.

**Two things the taxonomy got wrong, found by the tests rather than by reading.** `statusFor` matched
`.conflict` and nothing else, so `events.days_conflict` went out as `400 Malformed request` — which it
is not; the rule now accepts `_conflict` too. `events.not_a_draft` joined the 422 group, per the
comment already in that function: a well-formed request refused by a rule is unprocessable, not
malformed.

Proved by reverting: `tests/invariants/draft-resume.test.ts` fails **10 of 10** without the change and
passes 10 of 10 with it. The two most useful failures are the ones that returned `200` — before this,
`PATCH` accepted a `basics` body on a draft and on an *activated* event alike, and silently ignored
both. Owner: Travis.

## D-037 (2026-09-21): An event opens on what it is; screen 18 exists — Status: ACCEPTED (Travis's call)
Travis: clicking an event should show the event's details, not the command centre. There was no such
screen: the 17-screen inventory (D-010) has *Presentation detail* for a talk and nothing for an event.
Options weighed with Travis were an expand-in-place card and reusing the wizard as a details view; he
chose a real screen, so the inventory grows by one and this is the deviation record for it.

**The gap it closes is larger than the click.** Everything the wizard sets was written once and then
visible nowhere: the **timezone every displayed time in the product renders in**, the upload deadline
that closes the speaker portal, the reminder cadence, the accent colour, and the rooms, tracks and
days the agenda created. The command centre answers one question — how is this event going — and
after D-036 the wizard refuses an activated event, so a wrong timezone on a live event could not be
found, let alone corrected.

**Two kinds of field, and the difference is stated rather than implied.** A **name** and a **venue**
are labels: correcting either changes what people read and nothing else, and both are wrong often,
because an event is created before its venue is confirmed. The **timezone** and the **dates** are
load-bearing — every session time, deadline and room file is set against them. So D-036's blanket
`events.not_a_draft` is **narrowed here to exactly those three fields**, and the refusal names them.
That is not a reversal: it is the rule D-036 gave a reason for, applied to the fields the reason was
about. Name and venue stay correctable for the life of the event; moving an event remains a re-import,
not an edit.

**The screen shows the locked fields rather than hiding them.** Leaving the timezone off would hide
the thing every time in the product depends on; rendering it as an input the endpoint then refuses is
the D-033 trap again. It is shown, locked, and told why.

**And a live authorisation hole, found by probing the routes this screen was about to put a UI on.**
`POST /events`, `PATCH /events/{id}`, activate and duplicate took a staff session and an event scope
and asked nothing further, though SCREEN_SPECS §2 has said PjM/PM/Admin since it was written.
Demonstrated before the fix: **`t.okafor`, a room technician on MedTech Forward and nothing else
there, set that event's upload deadline to 1999-01-01 and its accent colour, and was answered 200.**
The deadline is what closes the speaker portal, so an account whose authority is custody of one room
could lock every speaker on the event out of submitting — or reopen a closed one — and the accent it
also rewrote is on every message those speakers receive. Gated on `atLeast("presentation_manager")`,
which is exactly PjM/PM/Admin; `room_technician` is deliberately not on that ladder, because its
authority is physical custody rather than seniority.

**Creation asks a flat question, and that is the one place it should.** There is no event yet to scope
to, so a manager on any event may create a new one — the same exception D-025 makes for
`platform_admin`, for the same reason: creating an event is done from outside every event and reaches
into nothing that exists.

Proved by reverting the gate: the four cases naming the technician's writes fail, and the three that
do not depend on it stay green — which is the signature to want, since a suite that goes all-red on a
revert is not discriminating between causes. Owner: Travis.

## D-038 (2026-09-21): An event cannot be activated without an agenda — the API says so now, not just the browser — Status: ACCEPTED (Travis's call)
Travis, reading `Sessions 0` on a live event's details screen: is a session required on each event?
It was, and it was not. Two doors, two answers.

**Through the wizard, yes** — D-027 makes step 2 mandatory and `commitImport` is what writes sessions,
so the product's own path could not produce an event without them. **At the API, no**: `activateEvent`
checked `rooms.length > 0 && days > 0` and never counted sessions, so
`POST /events` → `PATCH {rooms}` → activate produced a live event with no agenda. That path was not
hypothetical — `tests/invariants/event-configuration.test.ts` used it to get a live event to test
against, which is how confident the loophole was.

**So the rule was written down and unenforced.** D-027: an event without an agenda "is not a
partly-configured event, it is an empty one". SCREEN_SPECS §2, as an acceptance criterion: "With no
agenda committed … an event cannot be activated." Both true of the forward button and the step chips,
neither true of the one function where activation actually happens. This is the same shape as D-025
(the rule lived in one layer and the other did not ask) and as migration 005 (written correctly and
never run).

**What an empty live event costs.** No sessions means no slots, so no talks: nothing to collect,
review, sync or archive. It reports `0 / 0 collected` for ever and sits on the portfolio
indistinguishable from an event whose speakers simply have not uploaded yet — the one place a project
manager looks to see what needs chasing.

**The refusal names the missing piece rather than the rule.** Rooms, days and sessions all come from
the same commit, so in practice this is one condition stated three ways; it is still listed field by
field, because "this event needs an agenda" is not something an operator can act on and "it has no
sessions" is.

**A duplicated event is now refused too, and that is intended rather than collateral.** FR-EVT-002
copies structure and no content — deliberately, so last year's decks cannot appear in this year's
event — so a duplicate arrives with rooms, tracks and days and an empty agenda, which is exactly the
shape this refuses. It has no talks either; activating it would build the same shell by another route.
Covered by its own case rather than reasoned about.

**The seeded events are untouched and stay inconsistent with this rule**, which is worth stating
plainly: `packages/db/src/seed.ts` writes `status: 'active'` straight into its INSERT and never calls
`activateEvent`, so `NeuroSummit Spring 2026` and `OrthoWorld Congress 2026` remain live with zero
sessions. They are fixtures for the portfolio and Room sync screens. Nothing in the product can now
*create* that state; the seed is not "in the product" and was left alone rather than quietly
rewritten.

Proved by reverting: exactly one case fails — the new one — and the other eight stay green. Owner: Travis.

## D-039 (2026-09-21): The preview refuses what the database would, and the duration says when it is ignored — Status: ACCEPTED (Travis's finding)
Travis, from the row editor: presentation start 5:10 PM, end 5:25 PM, duration 55 min — does that make
sense? It did not, and checking why turned up three ways to crash the import.

**The duration question first.** The rule is sound and predates this: `Presentation Duration` is
consulted only when no end time was given, because "a sheet carrying both and disagreeing means the
published end wins — that is the one an attendee was told". So 5:10–5:25 imports as fifteen minutes
and the 55 is discarded. **The screen never said so anywhere near the control.** The explanation sat
in a sentence at the top of the box, and beneath it a live, draggable slider read `55 min` beside a
fifteen-minute window — an operator could adjust a number that would be thrown away, and a careful
one stopped to ask whether the product had noticed. The slider is disabled when a readable end time
is present, reads `not used`, and a note says what the times give, what the file said, and how to
make the duration count (clear the End). **The file's number is not overwritten with the real
window** — it is what the sheet said, and rewriting an operator's data to agree with our arithmetic
is what D-032 refused to do for this same control.

**And the three crashes, found while checking the rule.** Each passed the preview with **zero
blocking errors** and failed the commit with `500 Unexpected server error`, naming no row, after the
operator had reviewed the whole file and pressed Import:

1. a presentation ending before it starts (`slots` has `CHECK (ends_at >= starts_at)`);
2. a session ending before it starts (`sessions` has `CHECK (ends_at > starts_at)`);
3. **a file with no Session End column at all** — `endsAt` falls back to the start, so `ends_at`
   equals `starts_at` and the strict check refuses it.

**The third is the one worth pausing on, because it was a split between two lists that both claimed
to be the source of truth.** `TEMPLATE_COLUMNS` marks Session End `required: true`, DXG's own sheet
prints REQUIRED under it, and `REQUIRED_FIELDS` — the constant the screen and the row editor consult
— did not include it. That is the fifty-third entry's finding repeated: `session.start` was "never
actually required" for the same reason. Adding it to the constant was *still* not enough, because the
per-row `missing` list is written out field by field rather than derived from it. Both now agree, and
the comment says why the duplication exists (one date parse covers two fields).

**The commit-side check was a hand-maintained subset of the preview's, and now checks the values it
is about to insert.** `commitImport` decided "blocking" from `!row.title || !row.room ||
!row.starts_at` and never saw the issues list at all — it takes rows from the browser, and a client
is not a place to hold a rule. It now also refuses a row whose own instants run backwards, which is
the same question the database asks, in the same terms, one layer earlier.

Proved by reverting: the three new cases fail without the guards and pass with them, while the
zero-length presentation case — legal, since `slots` allows `>=` where `sessions` requires `>` — stays
green in both directions, so the suite is checking the line the schema actually draws rather than a
rounder one. Owner: Travis.

## D-040 (2026-09-21): Duration is shown, never set — the slider goes — Status: ACCEPTED (Travis's call, supersedes the D-032/D-033 slider)
Travis: duration can be calculated from the start and end times, so the slider is not needed — am I
right? Yes, and the reason is stronger than redundancy.

**A duration is stored nowhere.** No migration creates a column for it; `slots` holds `starts_at` and
`ends_at` and that is all. The importer only ever turns a duration into an end time. So it was never
a second fact about a presentation, only a second *spelling* of the one the Start and End already
give — and two editable spellings of one fact is exactly how a row comes to read 5:10 PM → 5:25 PM
beside "55 min", which is the contradiction D-039 was asked about the same day.

**Where it is genuinely not derivable, it is still not needed.** A row with a start and no end has
nothing to compute a length from, and there the file's duration decides the end. But the operator can
say the same thing by setting the End, which sits immediately beside it. The one thing lost is mental
arithmetic — a 45-minute talk from 13:07 now means typing 13:52 — and the slider could not have
expressed that anyway, since D-033 fixed it to 5-minute steps.

**It is still shown, because a file's own number is evidence.** A sheet claiming 55 against a
fifteen-minute window is a disagreement the operator should see, not one the product resolves in
silence. The display always names where the number came from, so the two kinds are never confused:
`15 min · from the times above`, or `45 min · from the file — ends 13:45`, or `90 min · from the file
— not used, the presentation has no start`, or `not set`. When the file disagrees with the times it
says so and says which wins.

**What this deletes:** the range input, `DURATION_MIN`/`MAX`/`STEP`, the floor of 5 (D-033), the
clamp-and-explain path for a file carrying more than 240 (D-032), the Clear button, the disabled state
and the "not used" wording added hours earlier in D-039. The importer is untouched — it still reads a
Duration column from any file that has one, and the precedence rule is unchanged.

**Superseding two of Travis's own decisions**, at his request: D-032 asked for the slider and D-033
set its floor. Neither is reversed on a matter of taste — the reason they are gone is that the field
they controlled turned out to be derived rather than stored, which neither decision knew at the time.

Verified against all five states the field can be in. Owner: Travis.

## D-041 (2026-09-21): A presentation cannot escape its session, and the duration box says 0 — Status: ACCEPTED (Travis's call)
Three requests in one: drop the Presentation box's explanatory note, show the duration in a box like
the fields beside it, and stop an operator setting presentation times outside the session's.

**The duration keeps the shape of its neighbours.** Start, End and Duration describe one thing, and a
line of prose among two boxes read as a different kind of statement. It is a disabled input now,
showing a value and nothing else. **Falling back to `0 min`** rather than an empty box is Travis's
call and is defensible on its own terms: a presentation with no times of its own has no length of its
own — it runs with its session — and zero says that in the same shape as every other value the field
shows.

**What the removed text cost, said plainly.** The note that named a number's origin
(`from the times above` / `from the file — ends 13:45`) is gone, and with it the line that appeared
when a file's duration disagreed with its times (`The file says 55; the times win.`). A sheet claiming
55 against a fifteen-minute window now shows `15 min` and no trace of the 55. The resolution is
unchanged and correct — the published end has always won — but the disagreement is no longer visible
to the operator. Recorded here rather than argued: it is a deliberate trade of evidence for quiet,
and it can be restored in one line.

**A presentation happens inside its session, and nothing enforced it.** `slots` and `sessions` carry
their times independently, with no constraint relating them, so a talk starting before its room opened
or running past the session it belongs to imported cleanly and reached the room schedule and the
speaker's portal looking authoritative. Unlike the D-039 checks, no database error was waiting to catch
this one — it would simply have been wrong.

**Enforced in both places, deliberately.** The pickers carry `min`/`max` from the session's own times,
which is what makes the rule *reachable* — the operator cannot step or type outside it, and an
out-of-range value turns the field the blocking colour (a new `input[type=time]:invalid` rule, scoped
to time and date so that merely-empty inputs elsewhere are unaffected). But `min`/`max` is a hint: the
value still lands if pasted. So `buildPreview` raises a blocking issue and `commitImport` refuses the
row against the instants it is about to insert. Both sides derive the bound from the same two fields
on the same screen, so there is no second copy of the rule to drift.

**Inclusive at both ends**, because a session with one talk filling it is the ordinary case, not an
edge case.

Proved by reverting: the three bounds cases fail without it and the rest stay green. One older case had
to be rewritten — the backwards-presentation row's times sat outside its session too, so it was
tripping two rules at once and asserting it tripped one. Owner: Travis.

## D-042 (2026-09-21): The wrong time is unreachable, not merely refused — Status: ACCEPTED (Travis's call)
Travis, on being shown *"The presentation ends at 03:15 and starts at 09:30 — it cannot end before it
starts"*: instead of an error, make the boundary so the operator cannot select a time outside the
session; and if there is any error, disable Save.

**The error he saw was the system working, and that is the problem.** D-041 bounded the presentation
pickers by the session, but `min`/`max` on a time input only *marks* a value invalid — stepping past
the bound is refused, typing past it is not. So the value was accepted, the row was saved, and the
server explained afterwards what should never have been offered.

**Each clock is now fenced by the ones it must agree with**, not merely by the session:

| Field | min | max |
|---|---|---|
| `session.start` | — | session end |
| `session.end` | session start | — |
| `slot.start` | session start | the earlier of the slot end and the session end |
| `slot.end` | the later of the slot start and the session start | session end |

**The bounds are mutual, which is what stops this becoming a trap.** A row arriving 10:25 → 10:10 has
both fields out of range and no obviously legal move; because each reads the *other's current value*,
correcting either one puts the other back in range immediately. Verified: fixing only the end moved
the start's `max` from 10:10 to 10:45 and the untouched start went valid.

**Save is gated on `:invalid`, read from the inputs themselves.** Not on a second copy of the rules —
the browser's verdict on the `min`/`max` above is the same verdict the red borders show, so the button
and the borders cannot disagree. Deliberately **not** gated on `problems`, the issues the server
returned for the row: those are what the operator opened the dialog to fix, and disabling Save on them
would make a blocking row permanently unfixable.

**The server checks stay, and the reason is worth stating.** A pasted value ignores `min`/`max`
entirely, and nothing in a browser is a rule. `buildPreview` and `commitImport` keep refusing what
they refused before; what changed is that an operator working normally will never meet those messages.
This is the same division as D-027 — the screen makes the correction possible, the server decides
whether it is correct.

**No automated coverage for the client half**, and this is a real gap rather than an omission: the
repo has no component-test harness (`npm test` runs `node --test` over `packages/*` and `apps/*/src`,
and BUILD_SPEC §16's Jest/Testing Library layer does not exist yet). The bounds and the Save gate are
verified in the browser and recorded in PROJECT_STATE; the rules they mirror are covered by the API
suites. Owner: Travis.

## D-043 (2026-09-21): The presentation's clocks become a list of the session's own times — Status: ACCEPTED (Travis's call, amends D-042)
Travis, shown Chrome's time dropdown offering 07, 08, 09, 10, 11, 12, 01 on a field bounded to a
09:00–11:00 session: we should not give the user the option to select a time outside the session.

**With a native time input we cannot.** `min` and `max` do not filter that dropdown — Chrome lists
every hour of the day and uses the bounds only to mark the result invalid afterwards. D-042 made the
wrong value *refused*; it could not make it *unoffered*, and the difference is the whole of this
request.

**So the presentation's two clocks are a `<select>` of the times the session allows**, on a five-minute
grid, bounded exactly as D-042 bounded them: the start runs from the session start to the earlier of
the slot end and the session end, the end from the later of the slot start and the session start to the
session end. A two-hour session yields twenty-five options. The empty option reads
`— runs with the session`, which is what an absent slot time has always meant.

**A time the file supplied that the window does not contain is kept and named**, as
`11:45 AM — outside the session`, with the field in the blocking colour and Save refused. Dropping it
into the list would be silently replacing the operator's data with the first legal option, which is
what D-032 forbade for this same screen; hiding it would leave the field showing a value the row does
not hold. Choosing any legal time removes it, and the option disappears with it.

**The session's own clocks stay native inputs**, and the asymmetry is the point rather than an
oversight: a presentation's time is *chosen from inside a known window*, which is what a list is for,
while a session's is simply stated. Its only bound is its own other end, so enumerating it means 288
options for a day nobody scrolls.

**Save now also refuses a stranded dropdown.** `input:invalid` is the browser's verdict on `min`/`max`
and says nothing about a `<select>`, so the gate reads `input:invalid, [aria-invalid="true"]` — the
same one check covering both controls.

**The server rules are untouched and still decide.** Nothing in a browser is a rule; what changed is
that an operator working normally can no longer produce the value the server would refuse. Owner: Travis.

## D-044 (2026-09-21): The DXG dashboard's date and time picker, ported — Status: ACCEPTED (Travis's call)
Travis: check the DXG dashboard's date and time picker and implement the same style. It is
`react-datepicker` 9.1.0 + `date-fns` 4.1.0 in `dxg-rfp-tool-dashboard`, themed by ~420 lines of
`dxg-datepicker` CSS, with a custom month/year header, 15-minute time intervals and a `Time` caption.

**Two new runtime dependencies, which BUILD_SPEC §17 puts in "ask first".** Put to Travis with the
alternatives; his call was the same library with this app's colours. Eight packages arrive in total —
react-datepicker, date-fns, clsx and five `@floating-ui`/`tabbable` — against a control-center that had
four. The two `npm audit` findings are pre-existing `postcss` via `next`, not these.

**Ported, not copied.** Every colour is re-tinted to this app's tokens: the dashboard's accent is teal
`#1DBFD3` and this product's is cyan `--blue #44C7F4`, and VISUAL_ACCEPTANCE §2.4 requires colours to
derive from the baseline's tokens. Shape, spacing and behaviour are the dashboard's; the palette is
ours, so no screen gains a second accent and no deviation is logged. The dashboard's `.dark` variant is
dropped (this app has no dark scheme) and its `lucide-react` chevrons are inline SVG — four arrows are
not worth a ninth package.

**The field speaks strings, not `Date`s.** `YYYY-MM-DD` and `HH:MM` are what the importer reads and
what every cell already holds, so the conversion happens at the edge of the component and the
calendar's `Date` habit stays out of the row editor. A day is built at noon rather than midnight, since
a midnight `Date` can slip across a daylight-saving boundary and only the calendar day is ever read
back.

**The library cannot shorten its time list, and that had to be found in its source rather than assumed.**
`includeTimes`, `filterTime` and `minTime`/`maxTime` all feed one function, `isDisabledTime`: they add
a `--disabled` class and refuse the click, while the list stays the full ninety-six entries of a day.
Scrolling a whole day to reach the twenty minutes a session allows is offered-but-refused, which is
what D-043 set out to stop — so the disabled entries are hidden in CSS, with the selected one exempt so
a time the file supplied never vanishes from the field that exists to correct it. **Disabled *dates*
are deliberately left visible and struck through**, because that is how the dashboard shows them and it
is what Travis pointed at.

**This replaces the hand-rolled `<select>` of D-043**, which existed only because a native time input
would not withhold an option. The rule it enforced is unchanged and still enforced server-side.

Applied to every date and time field in the product: the row editor's session date, session clocks and
presentation clocks; the create-event wizard's start and end dates, each bounded by the other; and the
event details upload deadline, bounded by the event's own start. Owner: Travis.

## D-045 (2026-09-22): An agenda can be typed in, not only uploaded — Status: ACCEPTED (Travis's call)
Screen 3 offered one way in: upload a spreadsheet. An event whose schedule is small, or not yet in a
file, had to be turned into a spreadsheet first purely to satisfy the importer. **Enter manually** is
the second way in, beside **Choose file…** and the template download.

**It is the same import, with an empty file.** A manual agenda holds the template's headings and no
data rows; the rows come from a new `blankRows` input to `buildPreview`. Everything downstream is the
path a file already takes — auto-mapping, per-row validation, the row editor, the (room, start, title)
match key, the venue-timezone conversion and the all-or-nothing commit. A typed row and an uploaded row
are indistinguishable by the time anything is written, so there is no second validator to keep in step
and no second way for a session to reach the database.

**Typed rows are appended after parsing, not written into the body as blank lines.** `parseCsv` drops
a row whose every cell is empty (`packages/files/src/sheet.ts`), so blank lines in the file would be
gone before they could be filled in — the first attempt produced an import with no rows in it. A
regression test asserts the parser still drops them, so the reason this indirection exists stays
visible.

**Cells are still the unit of edit.** A typed row is filled through the same `POST /imports/:id/cells`
overrides a correction to a file's row uses, which is why no date parsing or timezone maths moved into
the browser.

**Rows may be added and removed only on a manual agenda.** On a file import the row numbers belong to
the file, and renumbering them would detach the operator's corrections from the rows they were typed
for; both routes refuse with `import.not_manual`. Removing a row re-keys the overrides above it, so the
values typed into row 3 stay with that row when it becomes row 2. The last row cannot be removed —
`buildPreview` rejects an import with no rows as an empty file.

**Typed rows are numbered from one.** A file's rows keep their file numbers, so an error names a row
the operator can go and look at. A typed agenda has no file to look at and its first row is internally
row 2 (the headings are row 1), so the screen counts from one instead. The internal number is unchanged
— it is what keys the overrides.

New: `POST /events/:id/imports/blank`, `POST /imports/:id/rows`, `DELETE /imports/:id/rows/:row`.
Owner: Travis.

## D-046 (2026-09-22): A blocking row blocks the import, not only a missing one — Status: ACCEPTED
Found while testing D-045. The screen decided whether an import could proceed from `row.missing`
alone — the required fields a row has no value for. A room that matches no room on the event is also
`blocking`, and is reported as such by `buildPreview`, but it has no missing field: the cell is filled,
just wrong.

So the **Import** button stayed enabled, the commit went through, and the typo became a **second room**
— `Main Hal` beside `Main Hall` — which is precisely the duplicate the room check exists to prevent.
Reproduced end to end before fixing: one row, one typo, `{"created":1}`, two rooms.

The screen now treats a row as blocked if it is missing a required value **or** carries any issue of
severity `blocking`, which is what SCREEN_SPECS §3 has always said ("a commit with blocking errors is
refused"). The same predicate colours the row and counts the KPI, so the banner, the chip, the disabled
button and the server's own verdict cannot disagree.

**Pre-existing, and not specific to typed agendas** — an uploaded file with an unrecognised room had
the same hole. D-045 made it much easier to reach, because a room typed by hand is a likelier typo than
a spreadsheet column, which is how it surfaced.

**The API is still open.** `POST /imports/{id}/commit` takes the staged rows from the client and does
not re-validate them, so the guarantee is currently the screen's, not the server's. Closing that is
separate work: it means re-running validation inside the commit transaction and refusing the call,
which is the only way the rule holds against anything but our own UI. Owner: Travis.
