# Room Agent proof of concept — G0-1 report

Status: **TEMPLATE — not run yet.** Filled in during Phase B (`docs/poc/G0-1_PLAN.md`), following
`docs/poc/G0-1_RUNBOOK.md`. Gate: `docs/PHASE0_GATE.md` §G0-1. Decision under test: D-002.

## Verdict

| | Windows 11 | Windows 10 |
|---|---|---|
| Items passed with the COM driver | _/16 | _/16 |
| Items passed only with the helper driver | | |
| Items failed with both | | |
| **Outcome** (see rules below) | | |

Outcome rules: all 16 pass with COM → D-002 stands as written. Failures that the helper fixes → D-002 amended to
Electron shell + helper process. Anything that fails with both → stop and re-decide the agent architecture with DXG.

**DXG fidelity sign-off** (items 4–6): name, date, and what they watched: _

## Pinned versions

From `docs/poc/evidence/<os>/versions.json`.

| | Windows 11 | Windows 10 |
|---|---|---|
| Windows build | | |
| PowerPoint (Microsoft 365) build and channel | | |
| Electron | | |
| Node | | |
| winax | | |
| CPU / RAM / GPU | | |
| Monitors (count, resolutions, scaling) | | |
| Antivirus / endpoint protection | | |
| Test account is non-admin (yes/no) | | |

## Results

One row per matrix item. Status is PASS, FAIL or NEEDS_REVIEW; "Driver" is the driver that produced the status.
Evidence is under `docs/poc/evidence/<os>/item-NN/`.

### Windows 11

| # | Item | Pass rule | Status | Driver | Key figures | Notes |
|---|---|---|---|---|---|---|
| 1 | Launch reliability | 100 cycles, ≥99% success, first slide ≤10 s P95 | | | | |
| 2 | Presenter view on / off | Full screen on the right monitor both ways | | | | |
| 3 | Monitor targeting | Correct monitor with 2 and with 3 monitors | | | | |
| 4 | Animations and transitions | Matches native PowerPoint on every deck | | | | |
| 5 | Embedded and linked media | Plays; missing linked media reported | | | | |
| 6 | Fonts | Missing font substituted and documented | | | | |
| 7 | File types | PPT/PPTX launch; PDF, video, image play; Keynote refused → PDF copy | | | | |
| 8 | Macros and external links | Macros never run; links never auto-open | | | | |
| 9 | PowerPoint crash | Detected ≤5 s; relaunch or holding screen ≤10 s | | | | |
| 10 | Agent crash | Watchdog restarts it; same show resumes | | | | |
| 11 | Holding screen | Up in every failure path; never a bare desktop | | | | |
| 12 | Offline restart | Library intact and playable without network | | | | |
| 13 | Windows reboot | Starts by itself at sign-in; resumes the right state | | | | |
| 14 | 72-hour offline soak | Memory growth ≤20%; no orphaned PowerPoint; launches keep firing | | | | |
| 15 | Process cleanup | Zero orphaned PowerPoint after 100 cycles | | | | |
| 16 | Concurrent launches | Second refused cleanly; never two PowerPoints | | | | |

### Windows 10

(Same table.)

## Findings

What surprised us, what broke, what the fix or workaround was. One short paragraph each.

- _

## What this means for the real Room Agent (M5)

- Driver to build on:
- Settings PowerPoint needs on room PCs (Start screen off, trust settings, display monitor):
- Requirements for DXG's room PCs (Office channel, admin rights, antivirus exclusions):
- Open risks carried forward:
