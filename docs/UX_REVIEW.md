# UX_REVIEW.md — Can DXG staff use this without technical training?

Review of all screens, 2026-09-28, against one question: where would a DXG coordinator, reviewer or onsite
technician (or a speaker or client) be confused, stuck, or shown internal detail? Read-only review of the code and
the full-page screenshots in `.data/visual-sheet/` (`npm run visual:capture`), in three parts — setup & planning
(**S**), review & onsite (**R**), accounts, navigation, portals and API messages (**A**). **130 findings**
(S 44, R 48, A 38 + API messages). The highest-severity claims were spot-checked in the code and hold.

Principle behind the fixes: every fix should remove something staff would otherwise have to be taught.

## 1. Root causes (fixing these clears most findings)

1. **Internal values reach the screen.** Status, role, archive-state, check and time-zone codes are shown raw or with
   `_` replaced by a space; API `message` text is shown verbatim (including "BUILD_SPEC §6.3", field names in
   backticks, lists like `presentation_manager, …`). → One shared vocabulary: code → plain label → one-line meaning →
   "what to do next"; the UI words errors by `code` and falls back to a generic sentence.
2. **Greyed-out controls rarely say why**, and when they do it is a hover tooltip (useless on touch and in print),
   sometimes wrong, sometimes a milestone code ("M5-5", "M2-7"). → A shared disabled-reason pattern: visible
   one-line reason + the alternative.
3. **Controls that pretend.** "Simulate connection loss" (speaker portal), Test send, Room Agent "Launch" /
   "OFFLINE-SAFE ✓", Manual sync, Preview slides. → Wire them or remove them.
4. **Statuses ignore time and freshness.** "Onsite now" on every active event whatever its dates; talks "Synchronized
   onsite" while the room computer has been silent for days; "Checks passed" while inspection is still running.
5. **The three confirmations are never connected.** Reviewer approval, Speaker Ready Room sign-off and the room's
   acceptance are separate steps nobody explains, and sign-off is not tied to approval.
6. **Actions that email people or change records fire without a preview or confirmation** (batch send, merge speakers,
   request revision "prefilled", remove presenter, pressing A to approve), or through `window.prompt` pre-filled
   with an invented reason (waive, roll back, reset 2FA).
7. **Security words are inconsistent**: 2FA / two-factor / second factor / authenticator / enrolment; platform admin /
   root admin / DXG administrator; access code / recovery code.

## 2. Fix plan, in order

**Batch 1 — misleading or broken at a live event (do first).** ✔ Done 2026-09-28 (D-108), except R7, moved to batch 2.
S1 "Onsite now" · S2 manual rows said "nothing is written" · S4 bounced email dead end · S5 merge on one click ·
S6 fake Test send · S7 batch send without confirmation / re-sending the once-only invitation · S8 Deliver's wrong
reason · S9 "LibreOffice is not installed" · R1 sign-off not tied to approval · R2 quarantined v3 with a greyed
button and no reason · R3 Check out only after sign-off (station stuck "In session") · R4 USB result dead end ·
R5 quarantine message claims an approved version that may not exist · R6/R7/R8 room statuses that contradict each
other (Attention wording, synced-while-offline, OFFLINE-SAFE) · R9 fake Launch · R10 "Checks passed" during
inspection · R11/R12/R13 waive, roll back and request revision (permissions, prompts, unseen email) · A1 "Simulate
connection loss" · A2 upload "resumes" but does not · A3 internal statuses shown to speakers · A4 speaker cannot send
an updated deck · A5 inspection jargon/virus names to speakers · A6/A7/A8 new-staff onboarding bounce and wrong
"no access" advice · A9 client portal has no Sign out · A10 staff dead end on the client portal · API messages
quoting BUILD_SPEC / field names.

**Batch 2 — one plain-language vocabulary.** ✔ Done 2026-09-28 (D-110), including R7; talk-status labels kept (DXG-approved) with visible meanings. Shared map for talk, file, room, speaker-email, archive, role and check
codes with meaning and next step, used by every chip, toast and error (R47, S38, A17, A29, S39, S19, R16, R24, R44,
A15, S31, S14 time zones as "Eastern Time (New York)", readable dates); one set of security words (A22–A26, A28);
API errors worded by code (A-API list).

**Batch 3 — every disabled control explains itself.** ✔ Done 2026-09-28 (D-111). Visible reason + alternative (S12, S13, S21, S30, R14, R33,
R35, R40, R45, A12, A20, A21, A30).

**Batch 4 — remove technical detail staff never need.** ✔ Done 2026-09-29 (D-112); the "Room Agent" screen name stays (DXG-approved). Hashes/checksums/fingerprints (R15, R34, S36, S41), heartbeat /
agent / device key wording (S3, R39, R41, R43, R46), merge-field syntax (S33), decision and milestone codes (S22,
R14, R40), "server-side", "fleet", "manifest" (R20, R23, S41).

**Batch 5 — confirmations and guidance.** ✔ Done 2026-09-29 (D-113); R48 needs a decision (below). Confirm before sending, merging, removing, deactivating (S26, R27, A13,
A18); next-step links (S11, S34, S43, A14); the approval → sign-off → room-acceptance strip on Detail, Check-in and
SRR; polish (all Low rows).

Then: task guides + glossary on an in-app Help page, and a practice event for training (see the plan discussed
2026-09-28).

---

## Appendix S — Setup & planning (Portfolio, Create event, Schedule import, Command center, Speakers, Communications, Files, Archive)

Paths relative to `apps/control-center/`.

| # | Screen | Where | What staff see | Type | Sev | Proposed fix |
|---|---|---|---|---|---|---|
| S1 | Portfolio + Command | lib/eventStatus.ts:7; app/page.tsx:83 | "Onsite now" on every active event, including past (Mar–May 2026) and months-ahead events | Misleading status | High | Derive from dates: "Upcoming" / "Onsite now" / "Event over – ready to archive". |
| S2 | Wizard / Import | ImportView.tsx ~629 | "Nothing is written to the event until you import." — in manual entry each saved row is already live | Misleading | High | Manual mode: "Saving this row adds the session to the event straight away." |
| S3 | Command center | app/events/[id]/page.tsx:246-273 | "heartbeat + file state · never asserted manually", "heartbeat 529368s ago · agent 1.4.2", "no agent registered", red "Agent offline", no next step | Jargon / dead end | High | "Updated automatically from each room's computer"; "Room computer last seen 6 days ago"; tooltip with what to check. |
| S4 | Speakers | SpeakersView.tsx:345-373, 680-697 | Send icon gone after one email; Bounced/Complained cannot be fixed or resent | Dead end | High | "Bounced – check the address", Edit email + Resend after a bounce; otherwise "Already emailed – use Copy link". |
| S5 | Speakers | SpeakersView.tsx:225-245; api index.ts:1728 | "Merge" on one click; no choice of survivor; merged speaker's links revoked silently | Risky | High | Confirm step naming which record survives and that links stop working; "Keep B instead". |
| S6 | Comms | CommsView.tsx:248-254 | "Test send" shows a toast and sends nothing | Fake control | High | Send to the signed-in user, or remove. |
| S7 | Comms | CommsView.tsx:59, 245 | "Send batch (5)" sends immediately; audience "will send" includes speakers already invited | Risky / misleading | High | Confirm "Email 5 speakers now?"; mark and exclude already-invited speakers. |
| S8 | Archive | ArchiveView.tsx:195-206; api archive.ts:325-374 | "Deliver" greyed with "still being built" when already delivered or after a failed build | Wrong reason | High | "Already delivered – link expires Sep 30" / "The last build stopped – see the error and rebuild". |
| S9 | Archive | ArchiveView.tsx:276, 291, 307-315 | "LibreOffice is not installed on the server…"; Convert/Retry greyed, no tooltip | Jargon / dead end | High | "PDF conversion isn't available right now – contact DXG support." |
| S10 | Portfolio | app/page.tsx:86-96 | Bar + "0%" unlabeled | Unexplained | Med | "3 of 3 presentations received (100%)". |
| S11 | Portfolio | app/page.tsx:90-93 | "2 unresolved warnings" not clickable | Missing next step | Med | "2 file warnings to review →" to Review presentations. |
| S12 | Wizard | CreateEventWizard.tsx:275-277 | "Create draft ›" greyed, no reason | Blocked | Med | "Enter a name, start date and end date to continue." |
| S13 | Wizard | CreateEventWizard.tsx:128 | Steps 2–4 say "Import the schedule first" before a draft exists | Wrong reason | Med | "Finish Basics first." |
| S14 | Wizard / Details / Import | CreateEventWizard.tsx:160-168; EventDetails.tsx:164; ImportView.tsx ~627 | "America/New_York" in a long raw list | Jargon | Med | "Eastern Time (New York)", common US zones first. |
| S15 | Wizard / Details | CreateEventWizard.tsx:230-240; EventDetails.tsx:244; ReminderDaysField.tsx:57-59 | No deadline but reminders show "✓ 14 days" — nothing will send | Misleading | Med | "Reminders won't send until you set an upload deadline." |
| S16 | Wizard | CreateEventWizard.tsx:339-359 | "Activate event" with no consequences stated; accent saved only on Activate | Confusing | Med | Explain activation; save the accent when picked. |
| S17 | Wizard | CreateEventWizard.tsx:26 | "Deadlines & workflow" has no workflow | Confusing | Low | "Deadlines & reminders". |
| S18 | Import | ImportView.tsx:1042-1047, 1226-1231 | "Warnings: 3 – won't block" but the warnings are only in hover tooltips | Hidden info | Med | Show warning text in the row or a "Show warnings" list. |
| S19 | Import | ImportView.tsx:1186-1200 | Raw "create"/"update" chips, "update" orange | Jargon / tone | Med | "New", "Will update", "No change", neutral colours. |
| S20 | Import | ImportView.tsx:960-961, 1335-1337 | "every row is checked before anything is written"; "reports every row as unchanged" | Jargon | Low | "Nothing is saved until you press Import." / "Done – 12 added, 3 updated." |
| S21 | Import | ImportView.tsx:652-660 | "Save row" greyed, no tooltip | Blocked | Low | "No changes to save." |
| S22 | Command center | EventDetails.tsx:213 | "(D-064)" | Internal code | Med | Remove. |
| S23 | Command center | EventDetails.tsx:171-177 | ISO dates; "Moving an event is a re-import, not an edit here." | Jargon / dead end | Med | "Mar 10 – Mar 12, 2026. Dates can't change after activation – ask a DXG administrator." |
| S24 | Command center | EventDetails.tsx:266-295 | Header/template upload save instantly, above "Save changes – Nothing changed yet." | Confusing | Med | "Saved as soon as uploaded." |
| S25 | Command center | app/events/[id]/page.tsx:207-233 | Risk list rows show "Submitted" with no reason | Unexplained | Med | "Waiting for review – session at 11:15". |
| S26 | Command center | AgendaEditor.tsx:487-510 | Presenter "×" removes at once; errors only as tooltip | Risky / unclear error | Med | Confirm; inline error. |
| S27 | Command center | AgendaEditor.tsx:388 | "If files have been uploaded it is refused — cancel instead." | Ambiguous | Med | "…use Cancel session instead, which keeps them." |
| S28 | Command center | app/page.tsx:139-142; Kpi.tsx | Green "live" dot on finished events; "Warnings o…" truncated | Misleading / polish | Low | Hide after the event; "Warnings". |
| S29 | Command center | EventDetails.tsx:257; ReminderDaysField.tsx:59 | "what the speaker and client surfaces wear"; "Starts once the event is activated" on an active event | Jargon | Low | Plain wording; hide once active. |
| S30 | Speakers | SpeakersView.tsx:157-199 | "Bulk remind (0)" greyed, no reason | Blocked | Med | "Remind speakers missing files (0)" + reason. |
| S31 | Speakers | SpeakersView.tsx:376-420, 687-697 | Icon-only actions; "Queued", "Complained" | Jargon | Med | Text labels; "Sending", "Marked as spam". |
| S32 | Comms | CommsView.tsx:87-97, 319-326 | Queued 0 / Delivered 0 while log lists 2 "sent" | Misleading | Med | Add a "Sent" counter. |
| S33 | Comms | CommsView.tsx:171-190, 143-148, 202 | Raw "{{event_name}}"; "Merge fields are resolved per recipient…" | Jargon | Med | Preview with a sample speaker; plain explanation. |
| S34 | Comms | CommsView.tsx:278, 294-296 | "No upload deadline is set…" with no link | Dead end | Med | "Set the deadline →". |
| S35 | Comms | CommsView.tsx:288, 303, 323-325 | "missed while the server was down"; lowercase status; subject cut without "…" | Jargon / polish | Low | Plain wording; capitalise; ellipsis. |
| S36 | Files | FilesView.tsx:681 | "sha256 3fa91c…" | Jargon | Med | Remove. |
| S37 | Files | FilesView.tsx:418, 481, 564, 647 | "Quarantined", "Not downloadable" with no reason | Unexplained | Med | "Held back – failed the virus check. Ask the speaker to re-upload." |
| S38 | Files | FilesView.tsx:121-125, 380-387 | "Awaiting review / Blocked / Superseded / Rolled back" vs "Submitted / Needs revision / Attention" elsewhere | Inconsistent vocabulary | Med | Use the shared vocabulary; "Older version". |
| S39 | Archive | ArchiveView.tsx:138 | Raw "delivered", "draft", "expired" chip | Jargon | Med | "Delivered to client", "Build stopped", "Link expired" + next step. |
| S40 | Archive | ArchiveView.tsx:149-158 | Two contradictory expiry dates in ISO form | Contradictory | Med | "Client link expires Sep 30, 2026 (30 days after delivery)." |
| S41 | Archive | ArchiveView.tsx:149, 231-232 | "manifest… checksum", "stored bytes no longer match their recorded checksum" | Jargon | Med | Plain explanation. |
| S42 | Archive | ArchiveView.tsx:193 | "Rebuild package" on a delivered package, no word on the client link | Confusing | Med | "Rebuilding creates a new package; deliver it again to update the client's download." |
| S43 | Archive | ArchiveView.tsx:108-131 | "2 excluded" with reasons but no links to fix | Missing next step | Med | Link each reason to where it is fixed. |
| S44 | Archive | ArchiveView.tsx:78, 89-90 | "1 final files", "1 personal sign-in links" | Polish | Low | Plurals. |

## Appendix R — Review & onsite (Presentation detail, Inspection, Review, Speaker Ready Room, Check-in/USB, Room sync, Room Agent)

Paths relative to `apps/control-center/` unless prefixed `api/` (= `apps/api/src/services/`).

| # | Screen | Where | What staff see | Type | Sev | Proposed fix |
|---|---|---|---|---|---|---|
| R1 | Check-in | CheckinView.tsx:100,197-212; api/srr.ts:637 | "Confirm v3 as the final onsite version" live with "current approved: none"; receipt says "locked for the room" while the room plays the old copy | Misleading / flow | High | Sign-off only on the approved version, else explain and offer the approved one; enforce on the server. |
| R2 | Check-in | CheckinView.tsx:197-215 | Quarantined newest version: "Attention" + greyed Confirm, reason only in a tooltip | Blocked / unexplained | High | Visible line: failed virus check → ask for a clean copy via USB intake, or sign off the approved version. |
| R3 | Check-in | CheckinView.tsx:179-191 | "Check out" only after sign-off; the station stays "In session" and cannot be removed | Dead end | High | Always offer "Check out speaker"; confirm if not signed off. |
| R4 | Check-in (USB) | CheckinView.tsx:334-341 | "…Sign off above once DXG has approved it" — no sign-off button left if a receipt exists; no approval signal | Dead end / jargon | High | Say who approves where; update when approved; allow a new receipt. |
| R5 | Check-in (USB) | api/srr.ts:549-550 | "The approved version is untouched and still plays in the room" even when none exists | Misleading | High | Only mention it when true; always give the retry steps. |
| R6 | Room sync | sync/page.tsx:49; Chip.tsx:25-27; statusHelp.ts:32 | Room "Attention" shows the talk tooltip about virus scans | Misleading | High | Room wording: "Not ready — N talks not yet on the room computer". |
| R7 | Room sync / Check-in / SRR | derive.ts:94-99 | Room silent for days yet talks show green "Synchronized onsite" | Misleading | High | Amber "last confirmed …" when the room computer is not reporting. |
| R8 | Room Agent | RoomAgentView.tsx:115 | Green "OFFLINE-SAFE ✓" always, next to "offline" | Misleading | High | Remove or make it conditional and amber. |
| R9 | Room Agent | RoomAgentView.tsx:213-226,327-328 | "▶ Launch" reports "Launched" — nothing opens ("M5-3, pending the Windows PoC") | Fake control | High | Rename "Mark as presented" or label the screen a preview; drop milestone text. |
| R10 | Review | ReviewWorkspace.tsx:205-226; queries.ts:206-208 | "Checks passed · Nothing needs a decision" while inspection is running; Approve then fails | Misleading | High | "Checks still running"; disable Approve with that reason. |
| R11 | Inspection | InspectionView.tsx:212-229; api/presentation.ts:195,219 | "Waive finding" shown to everyone and on virus findings; error lists role codes | Blocked / jargon | High | Hide/disable with a plain reason; plain role names. |
| R12 | Inspection / Detail | InspectionView.tsx:217-220; PresentationDetail.tsx:59-62 | Waive / roll back via `window.prompt` pre-filled with invented reasons | Confusing | High | Inline form with an empty required reason. |
| R13 | Inspection | InspectionView.tsx:196-211 | "Request revision (prefilled)" emails a message staff never see | Misleading / jargon | High | Editable pre-filled message + "Send to speaker". |
| R14 | Detail | PresentationDetail.tsx:121-123 | "Preview slides" always greyed, "M2-7" | Fake control | Med | Link to the preview or remove. |
| R15 | Detail | PresentationDetail.tsx:104,156,169 | "sha256 …", "Checksum" column | Jargon | Med | Remove from staff view. |
| R16 | Detail | PresentationDetail.tsx:183-186 | Raw "superseded", "rolled back", "awaiting review" | Unexplained | Med | Shared vocabulary + meanings. |
| R17 | Detail | PresentationDetail.tsx:73 | "v2 restored byte-identically · 1 room notified" | Jargon / next step | Med | Say the room technician must accept it. |
| R18 | Detail | PresentationDetail.tsx:200-228 | Raw PDF error; "Retry PDF" re-queues the event and always says "queued again" | Unclear / misleading | Med | Plain message; show real errors. |
| R19 | Detail | PresentationDetail.tsx:135-137 | "Replace file / USB intake" → SRR list, works only if checked in | Confusing | Med | Link to the speaker's check-in or explain. |
| R20 | Detail | PresentationDetail.tsx:145-146,258,267 | "every version ever received is kept", "audiences are enforced server-side" | Jargon | Low | Plain labels. |
| R21 | Inspection | InspectionView.tsx:83 | Unknown check: raw code + JSON | Jargon | Med | Plain fallback; copy for every check. |
| R22 | Inspection | InspectionView.tsx:243-245 | "Open in review workspace →" opens the queue, not this file | Dead end | Med | Deep-link; hide when not awaiting review. |
| R23 | Inspection | InspectionView.tsx:165,237-239 | "Inspection has not run yet", "fidelity test", "room fleet" | Jargon | Low | "Checks are running – refresh in a minute." |
| R24 | Review | ReviewWorkspace.tsx:177-178 | Queue chip shows the first finding's severity, often "info" | Unexplained | Med | Worst finding: "1 problem" / "Checks passed". |
| R25 | Review | ReviewWorkspace.tsx:241-244 | "state: awaiting_review · lock 1" | Jargon | Med | Remove. |
| R26 | Review | ReviewWorkspace.tsx:209-215 | "warning · linked media"; "See the inspection report" with no link | Jargon / dead end | Med | Titles + link. |
| R27 | Review | ReviewWorkspace.tsx:139 | Pressing A approves instantly | Confusing | Med | Confirm or undo toast. |
| R28 | Review | ReviewWorkspace.tsx:88 | "Approved — queued for 0 rooms" | Next step | Med | Explain 0 rooms / room acceptance. |
| R29 | Review | ReviewWorkspace.tsx:232-240 | Request revision vs Reject not explained | Confusing | Low | One line each. |
| R30 | Review | SlidePreview.tsx:71; SlideViewer.tsx:80 | Raw conversion/loader errors | Unclear | Low | Plain fallback. |
| R31 | SRR | SrrDashboard.tsx:128-134 | Warnings row: name + "linked media" + "Tech review", no room/time/link | Jargon / dead end | Med | Room, time, plain title, "Open report". |
| R32 | SRR | SrrDashboard.tsx:94-105 | Talk status chip without next step; no signed-off / checked-out marks | Unexplained | Med | Action line; "Signed off ✓" / "Checked out". |
| R33 | SRR | SrrDashboard.tsx:169,178-180 | "Check in →" greyed, reason only in tooltip | Blocked | Low | Visible reason + "Check a speaker out". |
| R34 | Check-in | CheckinView.tsx:140-141 | Receipt "v2 · c949ab12…41b3" | Jargon | Low | "v2" + file name + slides. |
| R35 | Check-in (USB) | CheckinView.tsx:273; api/srr.ts:489-494 | "Scan drive & import" greyed with no reason; empty reason rejected only after upload | Blocked / unclear | Med | Visible prerequisites; validate first. |
| R36 | Check-in (USB) | CheckinView.tsx:229,243,274 | "Scan drive", "Malware scan", "Required" | Jargon | Low | "Virus check", "Choose the file from the USB drive", "Check & import file". |
| R37 | Check-in (USB) | CheckinView.tsx:49,284-303 | Result lost on refresh; "Δ" header | Confusing / jargon | Med | Load last result from the server; "Change". |
| R38 | Receipt | receipt/page.tsx:65 | "Times are America/New_York" | Jargon | Low | "Times are venue local time (New York)." |
| R39 | Room sync | sync/page.tsx:39-45 | "no heartbeat for 8824 min", "no agent registered", "no device key — cannot check in" | Jargon | High | "Room computer last seen 6 days ago" / "not set up" / "not connected yet". |
| R40 | Room sync | sync/page.tsx:56-58 | "Manual sync" always greyed, "M5-5" | Fake control | Med | Remove or link to the room view. |
| R41 | Room sync | DeviceKeyButton.tsx:53-56,81,105 | "Device key", no steps | Jargon / next step | Med | "Room computer code" + where to enter it. |
| R42 | Room sync | sync/page.tsx:9,49,67-69 | "Agent offline", no action; footer contradicts it | Unexplained | Med | Per-row action + link. |
| R43 | Room Agent | RoomAgentView.tsx:105-108; agent/page.tsx:27 | "agent 1.4.2 · library complete · offline" | Jargon | Med | "Room PC not reporting since 10:42 · all files present". |
| R44 | Room Agent | RoomAgentView.tsx:132-146,339-357 | "Acknowledge & sync v3", "update pending ack" | Jargon | Med | "Switch to v3"; "New version ready — switch needed". |
| R45 | Room Agent | RoomAgentView.tsx:213-226; api/agent.ts:450-455 | Launch offered on "no file" rows; refusal quotes "sync_failed" | Jargon / blocked | Med | Disable with reason; plain refusal. |
| R46 | Room Agent | RoomAgentView.tsx:277,281; api/agent.ts:270,323 | "Checksum-verified sync…", "Manual sync" | Jargon | Low | "Check for updates"; plain toasts. |
| R47 | Status labels | derive.ts:31,36-37; statusHelp.ts:22-32 | "Update pending ack", "Synchronized onsite", "Attention" explained only on hover | Unexplained | Med | Plain names + inline meaning. |
| R48 | Status labels | inspection.ts:32; review.ts:239 | "Technician review" blocks approval but nothing resolves it | Dead end | Med | Add pass/fail action or drop the state. |

## Appendix A — Accounts, navigation, client & speaker portals, API messages

Paths relative to `apps/`.

| # | Screen | Where | What the user sees | Type | Sev | Proposed fix |
|---|---|---|---|---|---|---|
| A1 | Speaker upload | speaker-portal/components/UploadPanel.tsx:248-255 | "Simulate connection loss" button during every upload | Fake control | High | Remove (or a real Pause). |
| A2 | Speaker upload | UploadPanel.tsx:110-113, 214; PortalView.tsx:196 | Promises uploads resume; a real drop shows "The upload failed. Nothing was stored." | Misleading | High | Keep the session and offer "Resume upload", or change the promise. |
| A3 | Speaker talk card | PortalView.tsx:163-165 | "Update pending ack", "Approved — delivering", "Synchronized onsite", "Attention" | Unexplained | High | Speaker-facing labels + one line each. |
| A4 | Speaker talk card | PortalView.tsx:144-148, 230-245 | After upload the upload box disappears; no way to send an update | Dead end | High | "Upload a new version" or who to contact. |
| A5 | Speaker results | PortalView.tsx:284, 308-324 | "linked media", "codec", "malware", virus signature names, raw JSON | Jargon | High | Plain titles and fixes; never virus names or JSON. |
| A6 | No access | control-center/app/no-access/page.tsx:39-40 | "Ask a DXG administrator to open Staff accounts…" | Misleading | High | Point to Event assignments. |
| A7 | First sign-in | api/src/index.ts:605-621; ChangePasswordForm.tsx:36 | Temp password → new password → sign in again → "no access" before authenticator setup | Confusing | High | Authenticator check before roles; "Step 1 of 2 / 2 of 2"; no forced re-sign-in. |
| A8 | No access | no-access/page.tsx:26-30; lib/guard.ts:42 | Raw API text "…no staff role on this event" | Unclear | High | "You haven't been added to any events yet." |
| A9 | Client portal | Shell.tsx:38-40; ClientPortalView.tsx | No sign out / account menu | Dead end | High | Header with name, Sign out, Change password. |
| A10 | Client portal (staff) | app/client/[eventId]/page.tsx:19-30; index.ts:2353 | "…for client event admins and scoped reviewers", no link back | Jargon / dead end | High | Plain wording + "Back to portfolio". |
| A11 | Staff accounts | StaffAccounts.tsx:258-275 | "reset 2FA" via prompt; no confirmation after | Missing confirmation | Med | Notice after success. |
| A12 | Staff accounts | StaffAccounts.tsx:261, 289, 314 | Greyed actions without (or with wrong) reasons | Blocked | Med | Visible reasons. |
| A13 | Staff accounts | StaffAccounts.tsx:311-316 | "deactivate" acts at once | Confusing | Med | Confirm. |
| A14 | Staff accounts | StaffAccounts.tsx:157-159 | After create: no next step | Next step | Med | "Next: assign them to an event →". |
| A15 | Staff accounts | StaffAccounts.tsx:219-237 | "2FA on", "temporary password", "N recovery codes left" | Jargon | Med | Plain status wording. |
| A16 | Staff accounts | StaffAccounts.tsx:132 | "Role" for account type and for event jobs | Confusing | Med | "Access level". |
| A17 | Event assignments | EventAssignments.tsx:152, 230 | "srr technician", "scoped reviewer", no explanations | Jargon | Med | Plain labels + one-line hints. |
| A18 | Event assignments | EventAssignments.tsx:153-165 | "×" removes a role at once | Confusing | Med | Confirm. |
| A19 | Event assignments | EventAssignments.tsx:86 | Errors at page top | Unclear | Low | Under the row. |
| A20 | Sidebar | Sidebar.tsx:227-233 | Greyed items, "Choose an event first" only on hover | Blocked | Med | Visible line under the event picker. |
| A21 | Sidebar (no events) | Sidebar.tsx:212-218, 177-178 | Only "No events yet" + greyed Client portal | Dead end | Med | "Ask a DXG administrator to add you." |
| A22 | Account menus | Sidebar.tsx:292-294; Shell.tsx:184-186 | "2FA" / "Two-factor authentication" | Jargon | Med | "Sign-in app (security code)". |
| A23 | Authenticator setup | MfaEnrolment.tsx:166 | "SHA1, 6 digits, 30 seconds" | Jargon | Med | Remove. |
| A24 | Authenticator setup | MfaEnrolment.tsx:55-85 | Recovery codes shown once, no copy/download/print | Next step | Med | Copy / Download / Print + advice. |
| A25 | Authenticator setup | MfaEnrolment.tsx:94-98; api mfa.ts:46, 76, 79 | "second factor", "enrolment", "Remove it first to enrol a new one" | Jargon / unclear | Med | Plain wording; "Lost your phone? Ask a DXG administrator." |
| A26 | Sign-in code | LoginForm.tsx:71-88 | "Authentication code"; no lost-phone help | Jargon / dead end | Med | 6-digit code wording + lost-phone path. |
| A27 | No access | no-access/page.tsx:43-49 | "Try again" loops; "Sign in as someone else" doesn't sign out | Misleading | Med | One "Sign out" button. |
| A28 | Lockout | api auth.ts:177 | "after 14:32 UTC, or ask a platform admin" | Jargon | Med | Local time; "a DXG administrator". |
| A29 | Client portal | ClientPortalView.tsx:140 | Raw archive state chip | Unexplained | Med | Plain state labels. |
| A30 | Client portal | ClientPortalView.tsx:165-170 | Downloads greyed, no reason; PDF button when none exists | Blocked | Med | Visible reason; hide PDF when absent. |
| A31 | Client portal | ClientPortalView.tsx:41, 88-93, 145 | "Restricted talks", "Need review", "Client Oversight" | Jargon | Med | Plain wording. |
| A32 | Speaker login | PresenterLogin.tsx:49-112 | No event name; "ask them for a new one" with no contact; code lost after expiry | Next step | Med | Event name, contact, keep the code. |
| A33 | Speaker portal | UploadPanel.tsx:101, 244-245 | "Verifying checksum…", "42% · resumable" | Jargon | Med | "Checking your file…", "42% uploaded". |
| A34 | Speaker portal | UploadPanel.tsx:226 | No success message after a clean upload | Confirmation | Med | "Thanks, we've received your presentation…" |
| A35 | Speaker portal | PortalView.tsx:254, 274-276, 175-188 | "On v2", "quarantined"; deadline box after approval | Jargon | Low | Plain wording; hide once approved. |
| A36 | Client portal | ClientPortalView.tsx:135-147 | Code-font package name, "1 PowerPoint files", repeated expiry | Polish | Low | Plain summary + readable date. |
| A37 | Reset password | ResetPassword.tsx:40 | "That link is missing its token." | Jargon | Low | "This reset link is incomplete. Request a new one." |
| A38 | New password | PasswordField.tsx:135-152 | Minimum length only after typing | Guidance | Low | Show "At least 6 characters" up front. |

**API messages users can see (worst first).** High: internal spec references and field names — `index.ts:895`
"`action` and `lock_version` are required (BUILD_SPEC §6.3)", same pattern at 1123, 1137, 1332, 1366, 1396, 1477,
1496, 1642, 1660, 1703, 1979, 1990, 2080, 2215, 2437, 2587, 2896, 3006. High: raw value/role lists — index.ts:1624,
agendaEdit.ts:692, presentation.ts:195, admin.ts:185, archive.ts:610, srr.ts:640, comms.ts:627. Server internals —
index.ts:1573 (LibreOffice text via pdf.ts:108), index.ts:1994/2038 "Unknown field X". Medium, vague — index.ts:526
"No such record.", 920 "Unexpected failure.", 3090 "Malformed request.", 1355/1466 "Empty part.", 208, 1239, 1245.
Jargon — archive.ts:337/377 "checksum", files.ts:362 "quarantined", srr.ts:576, auth.ts:634/695.

**Open decision (R48, 2026-09-29):** nothing puts a file into "Technician review" today (ingest writes passed /
passed with warnings / failed; `refer_to_technician` is never called), yet the state blocks approval if reached. Either
(a) add a technician pass/fail action with a reason on the inspection report (the transitions exist in
packages/domain), or (b) drop the state. Until then Review explains it plainly if it ever appears.
