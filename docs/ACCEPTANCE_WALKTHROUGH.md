# ACCEPTANCE_WALKTHROUGH.md — 19-Step Scripted Walkthrough

Status: v1.0 (2026-08-30), transcribed verbatim from the client baseline prototype's built-in "Run 19-step demo" (`prototype/client-baseline.html`; D-010). This is the SRS §22 prototype-acceptance script and, later, the backbone of the MVP live simulation (M7-4). DXG stakeholders complete it end-to-end; acceptance = no more than minor revisions.

Demo cast: event "MedTech Forward 2026" (Tampa Convention Center, 3 days, 348 talks), speaker Dr. P. Raman ("Robotics"), rooms incl. Ballroom A, client "MedTech Industry Association" (Jordan Ellis, Client Event Admin).

| # | Screen | Step (as scripted in the baseline) | What the observer must see | Requirements exercised |
|---|---|---|---|---|
| 1 | Create event (wizard) | PM creates the 3-day conference | Event with client, venue, dates, rooms, deadlines, branding; can't invite before ≥1 day + ≥1 room | FR-EVT-001 |
| 2 | Schedule import | Rooms, sessions & speakers imported from Excel | Auto-mapped columns, validation report, transactional commit | FR-IMP-001 |
| 3 | Communications | Branded upload invitations sent (348) | Template with merge fields, batch send, per-speaker history | FR-COM-001/003 |
| 4 | Speaker portal | Dr. Raman opens her secure link | Magic link resolves to only her talks, deadline and requirements visible | M06, NFR-SEC-02 |
| 5 | Speaker portal | She uploads a deck (480 MB, resumable) | Progress survives interruption; resume, checksum verify | FR-FILE-003, NFR-INT-01 |
| 6 | Inspection | Inspection flags an HEVC video warning | Tier-1 finding with severity + honest limitations copy | FR-INSP-002/004 |
| 7 | Review & approval | DXG reviewer requests a revision | Decision logged; speaker-visible comment lane used | FR-REV-001/003 |
| 8 | Speaker portal | Corrected v2 uploaded — checks pass | New version, re-inspection, prior version preserved | FR-FILE-002, FR-INSP-001 |
| 9 | Review & approval | DXG approves the presentation | Approval identity + timestamp recorded | FR-REV-001 |
| 10 | Room sync | v2 syncs to the Ballroom A computer | Delta manifest, checksum-verified delivery | FR-SYNC-001 |
| 11 | SRR Check-in | Speaker checks into the Speaker Ready Room | Search ≤ seconds, check-in with station/technician | FR-SRR-001, OBJ-5 |
| 12 | USB intake | One final update arrives on USB | Mandatory malware scan before library entry | FR-SRR-002 |
| 13 | SRR Check-in | Technician approves v3 · speaker signs off | Version comparison, sign-off bound to exact version, receipt | FR-SRR-003/004 |
| 14 | Room Agent | Room technician sees the change alert | Change acknowledgment required; launch warns if unacknowledged | FR-SYNC-002 |
| 15 | Room Agent | Final file synchronized · v2 kept for rollback | Previous version retained locally | FR-SYNC-002, FR-REV-005 |
| 16 | Room sync | Slot marked ready — readiness grid green | Room readiness derived and visible | OBJ-6, M12 |
| 17 | Room Agent | Presentation launched · logged 10:31 | Offline-capable playback, launch log entry | FR-AGT-002 |
| 18 | Archive builder | Final version included in the archive build | Approved-final rule, permission-aware scope, manifest | FR-ARCH-001 |
| 19 | Client portal | Client downloads the permitted package | Expiring link, download logged, restricted files excluded | FR-ARCH-002, FR-SPK-003 |

## Conduct

- Run on the baseline prototype (now) and on the real application (at M7 UAT) — same script both times.
- Record per step: pass / minor revision / major gap, with the observer's words.
- Steps 5, 12, 14–15 are the risk-bearing ones (resumable upload, USB quarantine, room change/rollback) — never skip them to save time.
