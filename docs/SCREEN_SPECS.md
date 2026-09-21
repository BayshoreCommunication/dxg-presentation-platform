# SCREEN_SPECS.md — Per-Screen Build Contracts

Status: **v1.0 (2026-09-15)**. Companion to `BUILD_SPEC.md`. This is the translation of `prototype/enhanced.html` (behaviour) over `prototype/client-baseline.html` (visual authority, D-010) into build contracts.

Reading rules:
- **Roles** are from `event_roles` (BUILD_SPEC §13). "PM" = presentation_manager, "PjM" = project_manager, "SRR" = srr_technician, "RT" = room_technician, "CR" = content_reviewer, "CEA" = client_event_admin, "SR" = scoped_reviewer, "Admin" = platform_admin.
- **Status labels** are fixed copy (`VISUAL_ACCEPTANCE.md` §2.2): Not submitted · Submitted · Processing · Warning · Technician review · Client review · Needs revision · Approved · Approved — delivering · Synchronized onsite · Update pending ack · Final onsite version · Ready · Missing · Canceled · Archived.
- **Derived status** always comes from `packages/domain` (WORKFLOW_STATES §8) — never computed in a component.
- Every screen implements the five mandatory states (loading, empty, error, permission-denied, and offline where noted).
- Each screen's acceptance criteria are the source for its Playwright spec.

---

## 1. Portfolio

**Route** `/` · **Roles** all staff (event list is role-scoped); CEA sees only their client's events · **Requirements** FR-EVT-001, M01

**Data** `GET /events` (cursor paged) returning per event: name, venue, dates, status (`draft|active|closed|archived`), collection percentage, unresolved-warning count, onsite flag (today within event days).

**Elements** one card per event: name, status chip (`Onsite now` / `Planning` / `Closed`), venue · date range, collection progress bar, unresolved-warnings chip, percentage, `Open →`. Primary action `+ Create event` (PjM/PM/Admin only).

**Behaviour** progress bar colour follows collection: green ≥80 %, amber 20–79 %, red <20 %. The warning chip links to the command center filtered to unresolved warnings. Cards are ordered: onsite events, then upcoming by start date, then closed.

**Acceptance**
- An event whose days include today shows `Onsite now` without any manual flag.
- Collection percentage equals `approved-or-submitted talks ÷ total talks` computed server-side; the UI never recomputes it.
- A CEA signed into two clients never sees the other client's events (I-4 test).

---

## 2. Create event (wizard)

**Route** `/events/new` · **Roles** PjM, PM, Admin · **Requirements** FR-EVT-001/002/003, M01

**Steps** 1 Basics (name, client, venue, time zone, start/end) · 2 **Schedule import** · 3 Deadlines & workflow (upload deadline, reminder cadence T-14/T-7/T-2, review workflow preset) · 4 Branding & template (accent colour, event header image, slide template).

**Rooms and tracks are not entered by hand** (D-026). Step 2 is the schedule import described in §3, embedded in the wizard against the draft event; the committed agenda is what creates rooms, tracks and event days. A room typed into a box before the agenda arrived was a room the agenda then had to match, and the mismatch surfaced as a blocking error on someone else's spreadsheet.

**API** `POST /events` (step 1 commits a draft), the §3 import endpoints for step 2, `PATCH /events/{id}` for steps 3–4, `POST /events/{id}/holding-media` for template/header uploads. Duplication from an existing event: `POST /events/{id}:duplicate` (structure and settings only — never files or speakers).

**Guards** the prototype's rule is normative: **invitations cannot be sent until the event has at least one day and at least one room**; both arrive with the import, and the comms endpoints enforce it server-side (`comms.event_incomplete`). **Step 2 is mandatory** (D-027): steps 3 and 4 are unreachable until an agenda has been committed, enforced on the forward button *and* on the step chips. The draft persists, so the wizard can be left and resumed.

**Acceptance**
- A part-completed wizard leaves a `draft` event that can be resumed; nothing is sent to anyone from a draft.
- After step 2 commits an agenda, the event's rooms are exactly the distinct locations named in the file, created in one transaction with the sessions.
- With no agenda committed, the step-3 and step-4 chips are not clickable and the forward button is disabled with a reason; an event cannot be activated.
- A draft left at step 2 is resumable: reopening the wizard returns to it with the basics intact.
- Duplication copies rooms, tracks, deadlines, templates and team roles; it copies no speakers, files or communications.
- Time zone is stored on the event and every displayed time in the product renders in it (no browser-local drift).

---

## 3. Schedule import

**Reached from** step 2 of the Create event wizard (D-027) for a new event, and from `Re-import agenda` on the command centre for a revised one. It is deliberately **not** in the sidebar: it is somewhere the product takes you, not somewhere you go, and a sidebar entry pointing at the selected event is a trap mid-wizard.

**Route** `/events/[id]/import` · **Roles** PjM, PM · **Requirements** FR-IMP-001/002, M02

**Flow** upload XLSX/CSV → `POST /events/{id}/imports` (returns `importId`, parses async) → `GET /imports/{id}` returns row count, auto-mapped columns, blocking errors, warnings, new-speaker count → user fixes/overrides mapping → `POST /imports/{id}:commit` (transactional).

**Elements** KPI row (Rows · Incomplete rows · Warnings · New speakers); the sessions table; `Download error report` (a real CSV of row · column · severity · problem); `Download blank template`; `Import N sessions`.

**There is no column-mapping table** (D-028). The mapping is shown by the data: the sessions table below names what was read from each row — session, room, date, time, presenter with address and organization, track — so a column understood wrongly is visible as an address where a name should be, rather than as a row in a table of `source column → platform field` that an operator has to audit on every import. The only surviving mapping control is the **unrecognised-column repair**: when a *required* field has no column at all, one select per missing field asks which column it is, and choosing re-reads the whole file. Without it an unfamiliar heading leaves every row missing the same value with no way to fix it once.

**Problems live on the row, not in a list** (D-030). There is no validation card. A row that cannot import is filled with the blocking colour, a row with only warnings with the warning colour, and both carry an **Edit** action beside their status chip. Everything else is left uncoloured and uncluttered.

**Completing an incomplete agenda** (D-027, D-030). Each staged row reports which of the required fields — `session.title`, `room.name`, `session.date`/`session.start` — it has no usable value for, and carries `cells`: every mapped field's current value. **Edit** opens a modal showing the whole row under DXG's own column headings (D-031), grouped `Session` / `Presentation` / `Presenter 1` / `Presenter 2`, with the row's problems stated at the top, the missing fields marked `· required`, and any typo suggestion offered as a one-click fill. Each group is laid out a line at a time (D-032): title and location; date, start and end; the presentation's start, end and duration; each presenter's first name, last name and email. Times use a time picker, the date a date picker, and duration a 5-minute slider — **except** where the cell holds something no picker can represent, which falls back to a text box showing the value rather than blanking it. `Track` is not shown, since DXG's sheet has no such column. Within the Presentation box the fields are labelled `Start` / `End` / `Duration`, and within a presenter block `First Name` / `Last Name` / `Email` — the heading above already names them, so repeating it in each label is noise. **The Session box keeps its full labels on purpose:** `Session Start` and `Presentation Start` are the two fields here most easily confused, and shortening both would leave the box heading as the only thing telling them apart. The input's accessible name stays fully qualified (`Presenter 2 Email`), which is what WCAG 2.5.3 asks for and keeps a field unambiguous read out of context. Presenters are a list (D-033): everyone the file named, never fewer than one, **+ Add another presenter** up to six, and `Remove` on any but the first — which shifts the presenters below it up rather than leaving a hole or a hidden block still holding a name. The three groups are boxed off from one another, since a session's end time and a presentation's start time sitting adjacent in one continuous form is exactly the confusion two sets of times invite. Saving sends the changed cells to `POST /imports/{uploadId}/cells` as **cell values**, in one request per row, and the whole file is re-validated server-side: the date is parsed, the event's timezone applied and the `(room, start, title)` match key recomputed by the same code that rejected the row. Nothing about parsing or timezones is reimplemented in the browser. Corrections accumulate across edits and survive a re-map.

**The blank template** (`GET /events/{id}/agenda-template`) **is DXG's own sheet** — the Preseria import template, v.1.3 — column for column: the same fourteen headings in the same order, the same format-hint row and the same REQUIRED/OPTIONAL row (D-029). That is the sheet event organisers already receive, so a template with different columns would be a second format to reconcile rather than a help. It is generated from the importer's own column list, not stored, so it cannot drift from what the importer reads. `Presentation Start`/`End`/`Duration` and the `Presenter 2` columns are carried and deliberately unmapped — a Preseria presentation sits inside a session, which this platform's schedule has no equivalent for, and only presenter 1 becomes the assigned speaker. **One heading differs:** DXG's sheet labels presenter 1's surname `Presenter 2 Last Name`, which is an error at source (it is REQUIRED and sits inside presenter 1's block); ours says `Presenter 1 Last Name`, and files carrying the original label map identically. The banner, hint, REQUIRED and `EXAMPLE` rows are all annotation, so a template filled in without deleting them still imports only the real rows.

**Rules**
- **The header row is found, not assumed.** Vendor templates put a banner on row 1 and annotation rows (`max 255 chars.`, `REQUIRED`) beneath the real headers. The parser scores each of the first few rows against the known field synonyms, takes the best as the header, and drops any following row that is annotation rather than data. Reading row 1 blindly mapped a banner as the header and fed `REQUIRED` in as a session.
- **A blank column header never auto-maps.** An empty string matched every field under substring matching, so the empty trailing columns of a template silently claimed `session.title`, `room.name` and the rest.
- **Presenter names arrive split.** `speaker.first_name` and `speaker.last_name` are mapped fields in their own right and are joined for `speakers.full_name`; a sheet carrying a single `Speaker Name` still maps to `speaker.name` as before.
- **An email column is an email column.** Matching is ordered so `Presenter 1 Email` maps to `speaker.email`; before this it matched `speaker.name` on the word "presenter" and the *second* presenter's address became the contact address.
- Only presenter 1 is imported as the assigned speaker. Additional presenter columns are recognised and deliberately left unmapped rather than silently dropped — a second presenter is a speaker assignment, and the import screen is not where that relationship is decided.
- Commit is all-or-nothing in one transaction; a commit with blocking errors is refused.
- Re-import matches existing rows by key `(room, start, title)` and **updates instead of duplicating** (FR-IMP-002); the UI shows a diff preview (create / update / unchanged / orphan) before commit.
- Rows with no speaker email import successfully but are held out of invitation batches until an email exists, and are counted on this screen.
- Fuzzy suggestions are advisory: applying one edits the staged row, it never auto-commits.

**Acceptance**
- Importing the same file twice produces zero duplicate sessions and a diff preview that is entirely "unchanged".
- The Preseria template (`v.1.3`, banner row + two annotation rows + split presenter names) maps every required column without manual intervention, and its presenter email lands on `speaker.email`.
- On an event with no rooms, the commit creates one room per distinct location in the file; on an event that already has rooms, an unrecognised location is still a blocking error with a suggestion.
- A file with one blocking error cannot be committed and the error report names the row and column.
- A row missing a required value is filled with the blocking colour and offers `Edit`; a row with only warnings uses the warning colour; a clean row is neither coloured nor given an action.
- The editor shows every mapped field of that row with its current value, under the same heading the spreadsheet uses, marks the missing ones, and refuses to save while any of them is still empty.
- `Presentation Start`/`End` are stored on the slot, not the session; `Presentation Duration` is used only when no end time is given.
- A row naming several presenters produces one `speaker_assignments` row each on the same slot — one talk, one file, one approval, several people — up to six.
- Removing a presenter from the middle of the list moves the ones below it up; the block that disappears holds no value afterwards.
- A blank time cell produces no time at all: a session with a date and no start is incomplete, and a presentation with no time of its own runs with its session.
- Saving several fields of one row is one request and one re-validation, not one per field.
- A date corrected on the screen produces the same instant as the same date read from the file, in the event's timezone.
- The blank template, downloaded and filled in, imports with nothing missing and no column mapped by hand — including the presenter's organization, which must not become their name.
- Session times in the preview render in the event's timezone, not the browser's and not a hardcoded one.
- The sessions table shows what was read for every mapped field, so a wrongly understood column is visible in the data without opening a mapping table.
- A file whose required column has an unrecognised heading offers one select per unmapped required field, and choosing a column re-reads the whole file.
- A session with no end time in the file shows one time, not a zero-length range; a presenter with an address and no name shows the address, not a dash beside it.
- Import of a 212-row file completes parse + validation in ≤10 s (fixture test).

---

## 4. Command center

**Route** `/events/[id]` · **Roles** all staff (content role-scoped) · **Requirements** M12, OBJ-4/6

**Data** `GET /events/{id}/reports/collection` for KPIs; risk list from a role-scoped query of talks whose derived status is in {Missing, Needs revision, Warning, Approved — delivering, Update pending ack}; activity feed from `audit_records` projected to a readable feed; live updates via SSE.

**Elements** event header (name · venue · Day N of M · doors), KPI row (Collected `n/total` · Approved · Warnings open · Missing · Rooms ready `n/14`), **Today's risk list** (each row opens Presentation detail), Activity list (timestamped, actor-attributed). Action `Send reminder batch` (PM).

**Behaviour** every status chip is derived live; when a review decision is made elsewhere, this screen updates without a manual refresh. `Rooms ready` is the aggregate of `room_files` states plus agent heartbeat freshness — the prototype's 12/14 → 13/14 transition on acknowledgment is the specified behaviour.

**Acceptance**
- Approving a presentation on screen 8 changes this screen's Approved KPI and the talk's chip within one SSE round trip.
- A room whose agent heartbeat is older than 5 minutes is excluded from `Rooms ready` and appears in the risk list.
- The activity feed never shows an entry the signed-in role is not permitted to see.

---

## 5. Speakers

**Route** `/events/[id]/speakers` · **Roles** PjM, PM, SRR, CR (read), CEA (read, scoped) · **Requirements** FR-SPK-001/002/003, M04

**Data** `GET /events/{id}/speakers?q=` — name, organisation, talk count, derived status, release permission.

**Elements** search box (server-side, debounced), table (Speaker · Organization · Talks · Status · Open →), `Bulk remind (n)` for speakers with missing files, `+ Add speaker`.

**Rules** duplicate detection runs on create and on import (email exact, then name+organisation fuzzy); merge (`POST /speakers/{id}:merge`) preserves both file histories and all assignments, and is audited. Release permission (`undecided|full|pdf_only|none`) is captured here and is what the archive builder honours.

**Acceptance**
- Search for 1 of 348 speakers returns in ≤1 s P95 server-side (shares the OBJ-5 budget).
- Merging two speakers leaves zero orphaned assignments and both version histories reachable from the surviving record.
- `Bulk remind` targets exactly the speakers whose derived status is Missing and who have a valid email.

---

## 6. Presentation detail

**Route** `/events/[id]/talks/[slotId]` · **Roles** PjM, PM, SRR, CR; CEA/SR read-only (client-visible content only) · **Requirements** FR-FILE-002/003, FR-REV-004/005, M07

**Data** `GET /slots/{id}` (talk, speaker, room, day/time, track), `GET /files?slot_id=` + versions with `processing_state`, `inspection_state`, `review_state`, size, SHA-256 prefix, source (`portal|srr_usb|srr_manual`), and the approval record.

**Elements** header with derived status chip; file line (`NAME_v3.pptx · 486 MB · sha256 9f2c…e41a`); approval attribution line when approved (`Approved by C. Delgado · Feb 26, 09:12 · logged`); actions `Preview slides`, `Open inspection report`, `Replace file / USB intake`, `Roll back`, `Review workspace`; **version history** table (version · size · state · "Final onsite version" marker) and the retained-version count.

**Rules**
- `Roll back` (PM+, reason required) restores a prior approved version **byte-identically**, marks the current one `rolled_back`, rebuilds affected room manifests and notifies the rooms (FR-REV-005, I-1).
- Every version ever received stays listed; originals are never overwritten.
- `Preview slides` opens rendered previews produced by the `preview.render_slides` job; when previews are still rendering the action shows a progress state rather than failing.

**Acceptance**
- Rolling back produces a room copy whose SHA-256 equals the earlier approved version exactly.
- The version table shows the correct one-of-many `approved` row and marks it `Final onsite version` when `final_locked` is set.
- A CEA opening this screen sees no internal comments and no override actions.

---

## 7. Inspection report

**Route** `/events/[id]/talks/[slotId]/inspection` · **Roles** PM, SRR, CR; CEA read-only · **Requirements** FR-INSP-001..004, M08

**Data** `GET /file-versions/{id}/findings` grouped by severity.

**Elements** severity summary chips (`n blocking` / `n warning` / `n informational`), one card per finding with check code, human explanation, slide references, and a **suggested fix** line; actions `Request revision (prefilled)`, `Waive finding` (reason required), `Open in review workspace →`; the standing limitations note ("automated checks can't judge content, design, or on-fleet animation behaviour").

**Rules** waiving requires PM+ and a reason, does not change any state, stays visible permanently with the waiver's actor/reason/time, and is audited (FR-INSP-003). `Request revision (prefilled)` composes a speaker-visible comment from the finding text and performs the `request_changes` transition in one action.

**Acceptance**
- A waiver attempt with an empty reason is refused client-side and server-side, and records nothing.
- Findings render slide references exactly as produced by the checker (`Slide 14`), never invented.
- A blocking finding blocks approval until it is waived; the approve action explains why it is disabled.

---

## 8. Review & approval

**Route** `/events/[id]/review` · **Roles** CR, PM (decide); CEA/SR in the client lane · **Requirements** FR-REV-001..004, M09

**Data** `GET /events/{id}/review-queue` (oldest first, SLA aging, claimable), the selected version's previews and findings, `GET /file-versions/{id}/comments`.

**Elements** queue list (speaker · talk · inspection chip, selected row highlighted) + review workspace: slide preview grid, inspection summary chip, **three comment lanes** with explicit audience labels (`Internal`, `Client review lane`, `Speaker`), and the decision bar: `Approve (A)`, `Request revision (R)`, `Request revision (prefilled)`, `Send to client review`, `Reject…`.

**Rules**
- Keyboard `A` / `R` perform the decision on the selected item (prototype behaviour, a11y-announced).
- Comment lanes enforce audience server-side: `internal` is never returned to speaker or client tokens; `client_visible` is never returned to speaker tokens.
- Approval fires the causal chain: `review_state → approved`, previous approved version → `superseded`, affected `room_files` rows → `assigned`/`syncing`, manifest rebuild enqueued, room notified — and the UI shows `Approved · syncing` then `Synchronized onsite`, or `Update pending ack` when acknowledgment is required (I-1).
- Claiming a queue item sets `in_review`; a second reviewer opening the same item sees it claimed, and a conflicting decision returns 409 with the current state.
- Rejection notifies the speaker and the client admin.

**Acceptance**
- Approve → the talk's chip on screens 4, 6 and 14 reaches `Approved — delivering` then `Synchronized onsite` without a page reload.
- A speaker token requesting comments receives only `speaker_visible` rows (lane enforcement test).
- Two reviewers deciding the same version concurrently: one succeeds, the other gets 409 with a merge prompt; exactly one audit record exists.

---

## 9. Communications

**Route** `/events/[id]/comms` · **Roles** PjM, PM · **Requirements** FR-COM-001/002/003, M05

**Data** `GET /events/{id}/comm-templates`, `GET /events/{id}/comm-batches` with delivery counters, `GET /events/{id}/reminder-schedule`.

**Elements** template preview rendered with the event's branding and merge fields (`{{speaker_first}}`, `{{deadline}}`, magic-link button), batch actions `Send batch (n)`, `Test send`, `Delivery log`; automated reminder policy card (T-14 · T-7 · T-2, missing-file only) with open/click/bounce rates.

**Rules** each recipient's link is a per-recipient token (never a shared URL); sends go through the outbox and SES; delivery/open/click/bounce events arrive on `POST /webhooks/email` (signature-verified) and attach to the speaker record; bounces flag the speaker; reminders target only speakers whose derived status is Missing at send time, evaluated at send, not at schedule.

**Acceptance**
- Test send goes to the signed-in staff user only and is excluded from batch counters.
- Re-running a batch never re-sends to a recipient who already received that batch (idempotent by `(batch_id, speaker_id)`).
- A bounced address is visible on the speaker row and excluded from subsequent automated reminders until corrected.

---

## 10. Archive builder

**Route** `/events/[id]/archive` · **Roles** PM, Admin · **Requirements** FR-ARCH-001/002/003, NFR-RET-01, OBJ-7

**Data/actions** `POST /events/{id}/archive-packages` (scope: days, rooms, rule = approved finals only, exclusions), `POST /archive-packages/{id}:transition` (`build`, `deliver`), `POST /archive-packages/{id}/link`.

**Elements** Scope table (event · days · rooms · rule · restricted excluded `n`); Options (convert to PDF where release permission allows, include manifest of file · version · checksum · approval record, expiring client link with retention and T-14 notice); Package card (name, file count, size estimate, state chip) with `Build package` / `Download package`.

**Rules** only `approved` finals are included; `restricted` items are excluded and counted; PDF conversion runs only where `release_permission` allows; the manifest is part of the package; the link expires (default 7 days), every download is logged with actor and time; retention and certified deletion follow `SECURITY_MODEL.md`, and a legal hold blocks deletion.

**Acceptance**
- A package's manifest checksums match the bytes in the zip for every entry (I-3).
- A talk with `release_permission = none` appears nowhere in the package, in any format.
- Build of a pilot-sized package completes within the OBJ-7 budget, measured from the build request.

---

## 11. Speaker Ready Room

**Route** `/events/[id]/srr` · **Roles** SRR, PM · **Requirements** FR-SRR-001, M10, OBJ-5

**Data** expected-arrivals list (speakers with sessions in the next window), unresolved warnings list, station roster.

**Elements** `Expected before HH:MM · n` table (speaker · room · time · action `Check in →` or status chip such as `File missing` / `Not yet arrived`), `Unresolved warnings · n` (opens the inspection report for that talk), `Stations` list with technician and free/busy state.

**Acceptance**
- The expected list is driven by session times in the event time zone and refreshes live as check-ins happen.
- A speaker with no file shows `File missing` and cannot be signed off until a version exists.
- Opening a warning row lands on the correct file version's inspection report.

---

## 12. Check-in

**Route** `/events/[id]/srr/checkin/[checkinId]` · **Roles** SRR · **Requirements** FR-SRR-001/003/004

**Data/actions** `POST /events/{id}/srr/checkins` (speaker, station, technician), `POST /srr/checkins/{id}/sign-off`, `POST /srr/checkins/{id}:depart`.

**Elements** talk header with derived status; context line (room · time · current approved `vN`); check-in attribution (`Checked in 08:42 · Station 2 · Technician T. Okafor`); actions `Confirm current version as final`, `Replace file / USB intake`, `Preview slides`, `Print receipt`; after sign-off, the **receipt card** (version + checksum, signed time/station, technician) with `Print receipt` / `Email receipt`.

**Rules** `Confirm current version as final` sets `final_locked`, which **blocks speaker-portal replacement** from that moment; further versions may only originate in SRR. Sign-off requires a version that has passed scanning; the receipt records the exact SHA-256 signed for.

**Acceptance**
- Setting final lock makes the speaker portal's replace action unavailable with an explanatory message.
- The receipt's checksum equals the file version's checksum; receipts are reprintable and identical.
- Departure is recorded and the SRR list updates without a reload.

---

## 13. USB intake

**Route** `/events/[id]/srr/intake/[checkinId]` · **Roles** SRR · **Requirements** FR-SRR-002, NFR-SEC-04, I-2

**Three-step contract** (the prototype's numbered cards are the specification):
1. **Malware scan** — mandatory. File metadata (name, size, SHA-256) shown; `Scan drive`; standing copy "files cannot enter any library until scanning completes; failures are quarantined and the approved version stays active". Scan error ⇒ quarantine, never pass.
2. **Inspection & comparison vs the approved version** — runs automatically after a clean scan; side-by-side table (slides, videos, fonts, size) with per-row deltas.
3. **Accept** — `Reason (required)`, then `Accept as vN · speaker present ✓` or `Keep vN-1`. Accepting creates the new version with `source = srr_usb`, sends it to re-approval, and leaves the room playing the currently approved copy.

**API** `POST /srr/checkins/{id}/usb-ingestions`, `GET /file-versions/{a}/compare/{b}`, then the standard version/review flow.

**Acceptance**
- Accept is impossible before a clean scan and impossible with an empty reason (both enforced server-side).
- After acceptance, the room's `room_files` row for the previous version stays `active` until the new version is approved and (where required) acknowledged (I-1).
- An infected or errored scan quarantines the file, alerts, and changes nothing about the active version.

---

## 14. Room sync

**Route** `/events/[id]/sync` · **Roles** PM, RT, Admin · **Requirements** FR-SYNC-001/002/003, M12, OBJ-6

**Data** `GET /events/{id}/sync/fleet` — per room: files current / total, last sync time, agent online state, pending acknowledgments, derived readiness chip (`Ready` / `Attention` / `Agent offline` / `n file missing`).

**Elements** `n / 14 rooms ready` headline, per-room rows with state line and `Manual sync`, the standing note "rooms keep complete offline libraries — internet loss pauses updates, never playback".

**Actions** `POST /rooms/{id}:force-sync` (rebuild and push the delta manifest), `POST /room-files/{id}:transition` for operator-side corrections (audited).

**Rules** readiness is computed, never asserted; a room with a stale heartbeat (>5 min) is `Agent offline` regardless of file state; a room holding an approved version that is not yet acknowledged shows `Update pending ack` and is not counted ready.

**Acceptance**
- Approving a new version moves its room from ready to `Update pending ack`; acknowledgment on the agent returns it to ready, and the headline count follows.
- Force sync is idempotent — repeated presses do not duplicate downloads or manifests.
- An offline room is detected within 5 minutes and raises the configured alarm.

---

## 15. Room Agent (room view)

**Surface** Electron renderer on the room machine · **Roles** RT (local) · **Requirements** FR-AGT-001/002/003, FR-SYNC-002/003

**Elements** dark room view: header (room name, device id, agent version, `library complete`, online/offline, clock, `OFFLINE-SAFE ✓`); **change alert** banner when an approved newer version awaits acknowledgment, with `Acknowledge & sync vN` and the note that the previous version is kept for rollback; today's schedule list (time · talk · version/state · `✓ logged` for presented items · `▶ Launch` for launchable ones, next session highlighted); Library card (file count, local size, `all current ✓` / `n update waiting`, previous versions kept, `Manual sync`, `Roll back`); Holding screen card with preview and `Show holding screen`.

**Rules** launch is refused unless the launch guard passes (BUILD_SPEC §6.9) and always falls back to the holding screen, never the desktop; every launch writes a local log entry that replays to the server; acknowledgment is a first-class transition (`synced → acknowledged → active`); rollback restores the prior approved version byte-identically and notifies the control center; everything on this screen works with the network unplugged.

**Acceptance**
- With the network disconnected: the agent starts, the library is intact, a scheduled talk launches, the log queues and replays deduplicated on reconnect.
- Killing PowerPoint mid-show is detected ≤5 s and the holding screen appears ≤10 s.
- An unacknowledged new version never becomes the launched file.

---

## 16. Speaker portal

**Route** `/t/[token]` → `/portal/talks/[slotId]` · **Auth** speaker token only · **Requirements** M06, FR-FILE-002/003, NFR-PERF-02

**Elements** branded event header with speaker name; talk card (title, derived status chip, room/day/time, "you have N other talks" switcher); requirements block (deadline, 16:9, PPTX preferred / PDF accepted, embed fonts and H.264 video, download the event slide template); upload area — drag-and-drop, "PPTX preferred · up to 10 GB · uploads resume automatically if your connection drops"; during upload: filename, size, progress, resumable messaging, and on interruption the explicit reassurance ("Connection lost at 68 % — 327 MB already uploaded is saved") with `Resume upload`; after upload: receipt line ("vN received. Checksum verified — automated checks are running…"), informational check results, `Replace file`, `Message DXG`; Feedback card showing speaker-visible comments only.

**Rules** multipart resumable upload direct to S3 with per-part checksums and a server-side completion that verifies the whole-file SHA-256; a failed checksum creates no version and asks for re-upload; `Replace file` is hidden once `final_locked` is set, with an explanation; the portal never exposes internal or client-lane comments; tokens are single-speaker, single-event, expiring, and revocable.

**Acceptance**
- An upload interrupted at any point resumes from its last completed part, not from zero (≥99.5 % resume success in the M2 test).
- A 10 GB upload succeeds; 10 GB + 1 byte is refused before any bytes are sent.
- The status chip shown to the speaker is the same derived status the staff screens compute.
- Fully usable at 375×812.

---

## 17. Client portal

**Route** `/client/[eventId]` (client shell, no staff chrome) · **Roles** CEA, SR · **Requirements** M14, FR-ARCH-002, NFR-SEC-03

**Elements** client header (client name · Client Oversight · signed-in user); KPI row (Collection %, Approved, Outstanding); Collection-by-track progress bars; Archive package card with state, the delivery promise ("within 4 hours of event close"), retention, expiring-link and logging notes, and `Download package` (enabled only once delivered).

**Rules** everything is read-only except downloading and commenting in the client lane; restricted talks are excluded from every count the client sees as well as from the package; every download is logged with actor, time and IP; a scoped reviewer sees only their assigned tracks/rooms.

**Acceptance**
- No staff navigation, action or internal comment is reachable from this surface, including by direct URL (403 + audit).
- Counts shown here reconcile with the staff command center for the same scope, minus restricted items.
- The download action is disabled until the package is `delivered` and after it is `expired`, with the reason shown.

---

## Cross-screen behaviours (verified once, relied on everywhere)

| Behaviour | Screens | Test |
|---|---|---|
| Live derived status | 1, 4, 5, 6, 8, 11, 12, 14, 16, 17 | `tests/e2e/derived-status.spec.ts` |
| Approval → room readiness causality | 8 → 14 → 15 → 4 | `tests/e2e/approval-causality.spec.ts` |
| Never silently replace | 13 → 8 → 14 → 15 | `tests/invariants/never-silently-replace.test.ts` |
| Comment-lane audience enforcement | 8, 16, 17 | `tests/invariants/comment-lanes.test.ts` |
| Resumable upload interruption/resume | 16 | `tests/e2e/upload-resume.spec.ts` |
| Keyboard decisions (A/R) | 8 | `tests/e2e/review-keyboard.spec.ts` |
| The 19-step walkthrough | all | `tests/e2e/walkthrough.spec.ts` |
