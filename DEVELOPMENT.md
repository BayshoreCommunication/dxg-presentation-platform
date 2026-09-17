# DEVELOPMENT.md — running the platform locally

Status: M0 in progress. The backend spine (domain state machines, database layer, API) and
**All seventeen screens of the client baseline now run on real data** — the ten Control Center
screens, the four Onsite screens, the Room Agent room view and the Client portal in the Control
Center app, plus the Speaker portal in its own app. The product runs end to end: create an event,
import an agenda, invite speakers, collect and inspect files, review and approve, run the Speaker
Ready Room, sync and play in a room, and deliver the archive to the client.

What is *not* finished is behind those screens, not between them — see Notes at the bottom.

## Prerequisites

Node 24+, Docker Desktop running.

## First run

```bash
npm ci
npm run db:up          # postgres :5434, redis :6380
npm run db:migrate     # applies db/migrations in order (idempotent)
npm run db:seed        # synthetic MedTech Forward 2026 fixture — no real content
npm run db:heartbeat   # marks room agents as freshly online
npm run dev            # api :4000 · control center :3000 · portal :3001 · mail dispatcher
```

Open http://localhost:3000 for staff. For the speaker portal, mint a link:

```bash
npm run demo:link            # Raman by default; pass a name, e.g. -- Osei
```

## Signing in

There is no signup. Every credential is created by DXG.

`npm run db:seed` prints the development staff logins and a presenter access code for
each speaker. Staff sign in at http://localhost:3000/login; presenters at
http://localhost:3001/login, or by following their link, which pre-fills the code and
asks only for their email address.

A forgotten password is self-service: **Forgotten your password?** on the sign-in page emails a
link that works once and expires in 30 minutes. In development the dispatcher writes mail to
`.data/mail/*.json` instead of sending it, so the link is readable there — nothing leaves the
machine. Resetting a password does **not** replace the second factor: an enrolled account still
needs its authenticator afterwards.

Staff accounts are created on **Admin → Staff accounts** (`/admin/users`), which needs a platform
admin or project manager — the seed includes `admin@example.invalid` for this. Creating an account
issues a temporary password shown once; the account must change it and enrol an authenticator
before it can reach anything. The same screen resets a forgotten password, hands back an account
whose authenticator is lost (with a reason, because that is an account-takeover path), unlocks a
locked-out account, and grants or removes event roles.

To issue a presenter credential the way DXG does, use the Speakers screen (or
`POST /speakers/:id/credentials`). The code is shown **once** — afterwards only its last
four characters are stored, so it cannot be recovered, only replaced.

## Demo script (≈3 minutes)

`npm run demo:reset` puts the data back to its starting state, so the walkthrough can be
repeated as often as needed.

1. **Portfolio** (`/`) — the event, its collection percentage and unresolved-warning count,
   all computed from the database.
2. **Command center** (`Open →`) — KPI row, today's risk list and room readiness. Every status
   pill is derived by `packages/domain`, the same code the API and reports use. Room readiness
   combines file state with agent heartbeat freshness: it is computed, never asserted.
3. **Review & approval** — pick the talk with the HEVC codec warning. The finding, its slide
   reference and the suggested fix come from `inspection_findings`. Press **A** (or the Approve
   button).
   - The toast reports how many rooms the delta manifest was queued for.
   - Behind that one click: the previous approved version was superseded, a `room_files` row was
     queued for the room, `sync.rebuild_manifest` and `file_version.state_changed` went to the
     outbox, and a workflow transition plus a hash-chained audit record were written — one
     transaction, all or nothing.
4. **Back to the Command center** — Approved has incremented and the talk now reads
   *Approved — delivering*. Nothing was hand-updated; the status is recomputed from the data.
5. **Room sync** — the same readiness, per room.

### Speaker portal (the collection half)

`npm run demo:link` prints a personal magic link (`/t/<token>`). Tokens are stored hashed,
bound to one speaker and one event, and expire — paste a wrong one and the portal says so.

6. **The speaker's view** — their talk, room, time in the event's timezone, requirements and
   deadline. No staff chrome, no other speakers' content; it is a separate application, so no
   staff code is shipped to speakers at all.
7. **Upload a .pptx.** The file is hashed in the browser, uploaded in parts, and the server
   verifies the whole-file SHA-256 before anything is stored.
8. **Press "Simulate connection loss" mid-upload**, then **Resume**. The client asks the server
   which parts already landed and continues from there — the panel says *"Resumed from 5 MB —
   not from zero."*
9. **Watch the findings come back.** They are produced by actually parsing the PowerPoint
   package: slide count, slide size vs the room profile, embedded media, a QuickTime video that
   the room's H.264 profile does not guarantee, and linked media that would not travel with the
   deck.
10. **Switch back to the staff Review queue** — the version is waiting there with those findings.

Worth demonstrating if the room is technical:

- Upload a `.docx` — refused before a single byte is sent.
- Upload a file containing the EICAR test string — quarantined, with the previous approved
  version untouched and still `active` in the room.
- Break the checksum — nothing is stored at all.

### Room Agent (the onsite half) — the chain that justifies the product

**Room Agent → Ballroom A.** This is the view a room technician has on the room machine. The
Windows Electron client is M5 and its playback half is gated on the G0-1 PoC; the view, the data
and the rules below are the real ones.

11. **Before anything**, the room shows `v2 · current · ready`.
12. **Have a speaker upload a new version and DXG approve it.** Press **Manual sync** on the room
    view: the file is downloaded and its whole-file checksum verified.
13. **The room does not switch.** v3 sits as *update pending ack*, v2 still reads *current ·
    ready*, and a change alert explains why. Press **Launch** at this point and the room still
    plays v2 — the agent never resolves a "closest matching" file.
14. **Press "Acknowledge & sync v3".** Only now does v3 become the copy the room plays, v2 moves
    to *previous versions kept: 1* for rollback, and Room sync goes green again.

That sequence is the product's core promise — a room never silently swaps an approved file — and
it is enforced server-side, not by the screen. Signing in as a content reviewer and pressing
acknowledge returns *"acknowledge requires one of: room_technician, presentation_manager,
project_manager, platform_admin."*

### Speaker Ready Room — the last-minute-change story

**Speaker Ready Room** in the sidebar shows who is expected, what is still unresolved, and which
stations are busy. **Check in** a speaker to open their check-in.

15. **USB intake, step 1 — scan.** Pick a file and press **Scan drive & import**. Leave the reason
    blank and it is refused: *"Accepting a USB version requires a reason — nothing was recorded."*
16. **Step 2 — comparison.** After a clean scan the incoming version is compared with the approved
    one: slides, embedded media, slide size, file size, each with its delta. The numbers come from
    parsing both files, not from a fixture.
17. **Step 3 — outcome.** The new version goes to *re-approval*. Check the Room Agent view: the
    room is still playing the approved copy. Nothing about the room changed.
18. **Sign off.** Confirming the final onsite version produces a receipt with the version, its
    checksum, the station and the technician — and locks the talk. Open the speaker's portal link
    and try to replace the file: *"This presentation has been confirmed as the final onsite version
    in the Speaker Ready Room, so it can no longer be replaced here."*

Step 18 is worth doing live: one action in the Speaker Ready Room changes what a speaker sees in a
different application, because both read the same rule.

Try also: feed USB intake a file containing the EICAR test string — it is quarantined, the approved
version stays active, and the intake says so plainly.

### Presentation detail and Inspection — the paper trail

Click any row on the Command center risk list to open **Presentation detail**.

19. **Version history** shows every version ever received — size, checksum, where it came from
    (speaker portal or USB intake), its findings, its state, and which one is in the room. Nothing
    is ever overwritten.
20. **Open inspection report.** Each finding is explained in plain language with the slide it is on
    and a suggested fix, because the finding came from parsing the file rather than from a label.
21. **Request revision (prefilled)** writes the finding to the speaker as a comment *and* moves the
    review state in one action — so a speaker is never asked to fix something the workflow has not
    moved on (or the reverse). Open the speaker's portal link: the talk now reads *Needs revision*.
22. **Waive finding** needs a Presentation Manager and a reason. A content reviewer is refused by
    name; a blank reason records nothing; and a waiver, once made, stays visible with its author and
    reason forever.
23. **Roll back to this** on a superseded version restores it byte-identically — the rolled-back
    version steps aside in every room and the restored one is queued back to them with the same
    checksum it always had.

### Schedule import and Speakers — the front door

**Schedule import** takes a real .xlsx or .csv. A sample with deliberate problems is in
`db/seeds/sample_agenda.csv`.

24. **Upload it.** Columns are auto-mapped (the sample maps 9 of 9), and every column can be
    overridden from a dropdown — changing one re-validates without re-uploading.
25. **Validation.** Row 3 has “Ballroon B”: the platform says it matches no room and offers
    **Ballroom B**. Applying the fix edits the staged row only — it never commits anything. Row 4
    has no speaker email: a warning, because the session should import while invitations wait. Row 5
    has no room at all: blocking.
26. **Import is all-or-nothing.** While a blocking row remains, the button is disabled and says why.
27. **Re-import the same file.** Every row that matched comes back as *unchanged* — matching is on
    room + start + title, so a second import updates rather than duplicating.

Worth saying: the times in that spreadsheet are venue wall-clock times. They are converted through
the event's own timezone, so a 10:30 session is 10:30 in Tampa — not 10:30 UTC sitting four hours
wrong in every room list.

**Speakers** shows the directory with organization, talk count and live status, search across name,
organization and email, a chase list (*Bulk remind*), and **possible duplicates** with a merge that
preserves both file histories and every assignment.

### Archive builder and Client portal — the handover

**Archive builder** scopes the package to approved finals only.

28. **Scope** shows what is in and, more usefully, what is out — each exclusion with its reason:
    no approved version, restricted from distribution, speaker withheld permission, release
    permission not set. Nothing is silently dropped.
29. **Build package.** Every file is read from storage and checksum-verified as it is packaged; if
    stored bytes no longer match their recorded checksum the build stops and nothing ships. The
    result is a real `.zip` that `unzip` opens, with a `manifest.json` listing each file's talk,
    speaker, room, version, checksum, size and approval record.
30. **Deliver to client portal** issues a link that expires in 7 days.
31. **Client portal** (`/client/<eventId>`) — a separate surface with no staff navigation at all.
    Collection percentage, approvals, collection by track, and the package. The download button is
    disabled until the package is delivered and after the link expires, and it says which.

### Create event and Communications — the start of an event

**Create event** is the four-step wizard: Basics, Rooms & tracks, Deadlines & workflow, Branding.

32. **Step 1 creates a draft.** A draft sends nothing to anyone. Bad input is refused with a
    reason — an unknown timezone, or an end date before the start date.
33. **Step 2** warns that invitations cannot go out until the event has a day and a room. That is
    not just wizard copy: try sending a batch on an event with no rooms and the API refuses —
    *"a speaker link would point at nothing."*
34. **Activate** turns the draft into a live event and drops you on its command center.

**Communications** shows the template with its merge fields, and — more useful — **who the batch
would actually reach**, resolved now rather than when the batch was scheduled.

35. **Send batch.** Each recipient gets their own secure link; a batch never contains a shared URL.
36. **Press it again.** Nothing is queued and every recipient reads *already received this batch*.
37. **A bounce arrives** on the provider webhook. The speaker's row flags it, and the next batch
    skips that address with the reason shown.
38. **The reminder template** targets only speakers whose derived status is *Missing* — with a full
    fixture, it correctly reports that there is nobody to chase.

Worth demonstrating: open the client portal as a staff user and the API refuses —
*"The client portal is for client event admins and scoped reviewers."* Expire the link and the
download is refused with a reason, and the package is marked expired. Every download is logged with
who and when.

Worth saying out loud during the demo: the rules being enforced are the ones that matter
onsite. Try to approve something before claiming it and the API refuses with
*"Cannot approve while review is Submitted. Allowed: claim."* Act on a stale copy and it
returns a conflict rather than overwriting someone else's decision. Sign in as a client admin
and approval is forbidden. An `UPDATE` on the audit log is rejected by the database itself.

## Verification

```bash
npm run ci             # lint + type-check + tests (51 domain tests today)
```

## Trying the API

Every request needs a session. Sign in once and keep the cookie:

```bash
curl -s -c /tmp/dxg.jar -X POST localhost:4000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"m.vega@example.invalid","password":"dxg-development-password"}'
```

That returns `{"step":"mfa_required"}` — staff sign-in has two steps. Complete it:

```bash
curl -s -b /tmp/dxg.jar -c /tmp/dxg.jar -X POST localhost:4000/api/v1/auth/mfa/verify \
  -H 'content-type: application/json' \
  -d "{\"code\":\"$(npm run demo:totp --silent | awk '{print $1}')\"}"
```

Then pass `-b /tmp/dxg.jar` on the calls below. `npm run db:seed` prints the accounts, the
development authenticator secret and recovery codes.

```bash
EV=22222222-2222-4222-8222-222222222222

curl -s localhost:4000/ops/health
curl -s -b /tmp/dxg.jar "http://localhost:4000/api/v1/events/$EV/talks"        # status derived by @pmp/domain
curl -s -b /tmp/dxg.jar "http://localhost:4000/api/v1/events/$EV/audit:verify" # hash-chain verification
```

The review decision, with optimistic locking and role gates:

```bash
VID=<a file_version id>
curl -s -b /tmp/dxg.jar -X POST "http://localhost:4000/api/v1/file-versions/$VID:transition" \
  -H 'content-type: application/json' \
  -d '{"action":"claim","lock_version":0}'
```

Approving fans out: the previous approved version is superseded, a `room_files` row is queued
for each room, `sync.rebuild_manifest` and `file_version.state_changed` land in the outbox, a
workflow transition and a hash-chained audit record are written — all in one transaction.

## What each package is

| Path | Contents |
|---|---|
| `packages/domain` | Pure domain: the six lifecycles, the transition engine, derived status. No I/O. |
| `packages/db` | Pool, RLS scope helper (`withScope`), migration runner, seed, hash-chained audit. |
| `packages/files` | Storage driver, scanner, tier-1 inspection engine, spreadsheet reader and archive zip writer — one ZIP/OOXML implementation serves PowerPoint inspection, .xlsx import and package building, with no dependency. |
| `apps/api` | Express 5: health, events, talks, speakers, review transition, audit verify, portal + upload, agent heartbeat. |
| `apps/dispatcher` | Drains the outbox and delivers email (file transport in development, SES at M3-5). |
| `apps/control-center` | Next.js staff app (:3000), including the Room Agent room view. |
| `apps/speaker-portal` | Next.js speaker app (:3001), token auth only. |

## Notes

- `withScope` opens a transaction and sets `app.user_id` / `app.client_id` / `app.event_id`, so
  RLS isolation is enforced by Postgres rather than by remembering a WHERE clause.
- `audit_records` is append-only at the database level: an UPDATE is rejected by a trigger even
  for the superuser. Tampering is therefore not something the application has to prevent.
- API actions use the `:action` suffix from `api/openapi.yaml`; the colon is not a path
  separator, so the segment is split in `apps/api/src/index.ts`.
- **Storage is local-disk in development** (`.data/`), behind the same interface the S3 driver
  will implement in M2-2. The upload protocol, content addressing and checksums are the real
  thing; only the backing store differs.
- **The development scanner is a real scanner with a one-signature database** (EICAR). Production
  uses the ClamAV container (M2-5). It is not a bypass: every file passes through a scanner,
  `stored` is unreachable without a clean verdict, and scan errors fail closed to quarantine.
- Inspection is deterministic parsing only. Codec detection currently infers risk from the media
  container; a real codec probe arrives with the media worker (M2-4).
- The **Room Agent screen is served by the control center** rather than the Electron client (M5).
  It identifies as the room technician because the room machine is a different principal from a
  staff session; device credentials arrive with M5-1. `Manual sync` runs the same sequence the
  agent's sync engine will — read, verify checksum, then make visible — minus the network.
- **Launching does not drive PowerPoint yet** (M5-3, gated on G0-1). The launch guard, the
  holding-screen fallback and the launch log are real; the COM call is not there.
- **Email is delivered by the outbox dispatcher**, which writes to `.data/mail/` in development.
  The SES transport is deliberately unimplemented and throws rather than silently succeeding, so
  production cannot look like working email while nobody receives anything (M3-5). Webhook
  signature verification is also M3-5; delivery events can be posted by hand, which is how the
  bounce path is exercised.
- **Asset upload** (event header, slide template) is not built (M1-4).
- **MFA is enforced** for every staff account (D-017). The development accounts are pre-enrolled
  with a known secret so local work uses a real second factor rather than a bypass:
  `npm run demo:totp` prints the current code, and `npm run db:seed` prints the secret and recovery
  codes. Add the secret to any authenticator app to sign in the way staff will.
- **Enrolment shows a setup key, not a QR code** — rendering one needs a dependency, and sending
  the secret to an image service would defeat the point. Every authenticator app accepts a typed
  key.
- **There is no development authentication bypass.** The `x-dev-user` header was removed on
  2026-09-17; every request carries a real session, in development exactly as in production.
