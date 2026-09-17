# DEVELOPMENT.md — running the platform locally

Status: M0 in progress. The backend spine (domain state machines, database layer, API) and
**thirteen working screens** exist — Portfolio, Schedule import, Speakers, Command center,
Presentation detail, Inspection, Review & approval, Room sync, Room Agent, Speaker Ready Room,
Check-in and USB intake in the Control Center, plus the Speaker portal upload screen in its own app
— running on real data, from importing an agenda through to a file playing in a room.

Four screens are still prototype-only (`prototype/enhanced.html`): Create event, Communications,
Archive builder, Client portal.

## Prerequisites

Node 24+, Docker Desktop running.

## First run

```bash
npm ci
npm run db:up          # postgres :5434, redis :6380
npm run db:migrate     # applies db/migrations in order (idempotent)
npm run db:seed        # synthetic MedTech Forward 2026 fixture — no real content
npm run db:heartbeat   # marks room agents as freshly online
npm run dev            # api :4000 · control center :3000 · speaker portal :3001
```

Open http://localhost:3000 for staff. For the speaker portal, mint a link:

```bash
npm run demo:link            # Raman by default; pass a name, e.g. -- Osei
```

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

The dev user is chosen with an `x-dev-user` header: `pm`, `reviewer`, `room_tech`, `client`
(an M0 stand-in for OIDC — M1-1 replaces it).

```bash
EV=22222222-2222-4222-8222-222222222222

curl -s localhost:4000/ops/health
curl -s "http://localhost:4000/api/v1/events/$EV/talks"          # status derived by @pmp/domain
curl -s "http://localhost:4000/api/v1/events/$EV/audit:verify"   # hash-chain verification
```

The review decision, with optimistic locking and role gates:

```bash
VID=<a file_version id>
curl -s -X POST "http://localhost:4000/api/v1/file-versions/$VID:transition" \
  -H 'content-type: application/json' -H 'x-dev-user: reviewer' \
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
| `packages/files` | Storage driver, scanner, tier-1 inspection engine, and the spreadsheet reader — one ZIP/OOXML reader serves both PowerPoint inspection and .xlsx import, with no dependency. |
| `apps/api` | Express 5: health, events, talks, speakers, review transition, audit verify, portal + upload, agent heartbeat. |
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
