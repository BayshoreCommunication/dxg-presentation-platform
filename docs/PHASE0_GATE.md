# PHASE0_GATE.md — G0 Acceptance Criteria

Status: Defined 2026-08-30. **G0 explicitly decides whether the project may proceed to MVP implementation.** Until every gate item below reaches PASS (or an approved fallback), no production application scaffolding beyond PoC code is permitted.

Default owner: Travis. Default reviewer: second developer (or DXG technical reviewer where marked). DXG approval is required where marked.

## G0-1: PowerPoint-from-Node PoC (Room Agent viability)

The Room Agent decision (D-002) is **provisional until this passes**.

- **Test environment**: physical Windows 11 machine AND Windows 10 21H2 VM, each with Microsoft 365 PowerPoint (versions pinned below), dual monitors (one machine with 3), no admin rights for the agent process.
- **Pinned and recorded in the PoC report**: Windows build numbers, Microsoft 365/PowerPoint build, Electron version, Node version, COM bridge (winax or equivalent) version, CPU architecture (x64; note any ARM findings).
- **Inputs/fixtures**: the representative test corpus (G0-7) — decks with animations, embedded video, linked video, custom fonts, 16:9 and 4:3, PPT (legacy) and PPTX, a macro-enabled deck, a deck with external links, a corrupted deck.
- **Verification matrix** (each item PASS/FAIL with evidence):
  1. Launch reliability: 100 scripted launch/close cycles, ≥99% success, launch-to-first-slide ≤10s P95
  2. Slideshow mode + presenter view on/off
  3. Multi-monitor: targeting a specific monitor; correct behavior on 2- and 3-monitor setups
  4. Animations and transitions fidelity (visual check vs native PowerPoint, per corpus deck)
  5. Embedded and linked media playback; missing-linked-media behavior detected and reported
  6. Font handling: missing-font deck renders with documented substitution behavior
  7. PPT and PPTX both launch; KEY/PDF/video/image playback paths verified
  8. Macro-enabled deck: macros blocked/disabled per security policy; external links do not auto-open
  9. PowerPoint crash detection ≤5s and automatic relaunch or holding-screen fallback ≤10s
  10. Agent crash recovery: supervisor restarts agent; playback state recovered
  11. Holding-screen fallback in every failure path (never a bare desktop)
  12. Offline restart: agent restarts with network unplugged; library intact and playable
  13. Windows reboot recovery: auto-start, resumes correct state
  14. 72-hour continuous offline soak: no memory growth >20%, no orphaned PowerPoint processes, scheduled launches keep firing
  15. Process cleanup: zero orphaned COM/PowerPoint processes after 100 cycles
  16. Concurrent-instance handling: second launch request while a show is running is queued/rejected cleanly, never two fighting instances
- **Pass threshold**: items 1–16 all PASS on both OS targets.
- **Evidence**: scripted run logs, screen recordings for fidelity items, soak-test resource graphs, PoC report in `docs/poc/ROOM_AGENT_POC.md`.
- **Failure/fallback decision**: if COM-from-Node fails specific items, retry those with a helper process (PowerShell or small compiled sidecar) invoked by Electron. If the helper passes, D-002 is amended (Electron shell + helper). If both fail, G0 outcome is **do not proceed** on the current agent design and the architecture is re-decided with DXG informed.
- **DXG approval**: required (fidelity evidence demo).

### G0-1b: Agent distribution design (decision-complete, not built)
Documented design for: signed application binaries (code-signing cert acquisition), MSI packaging, auto-update mechanism, stable + event-pinned channels, update deferral during active events, rollback to a previous agent version, N/N-1 API compatibility policy. Reviewer: second developer. DXG approval: not required. Pass: design doc exists and covers all seven points.

## G0-2: Offline delta-sync PoC

- **Environment**: PoC agent on Windows target, sync service local or dev AWS; bandwidth-shaped link (50 Mbps).
- **Fixtures**: 1 GB and 5 GB files; manifest with 50 files across 3 simulated rooms.
- **Repetition**: 20 sync runs with induced disconnects at random offsets; 5 clean runs.
- **Pass**: resume success ≥99.5% (NFR-PERF-02); zero checksum mismatches (NFR-INT-01); 1 GB on 50 Mbps ≤5 min (NFR-PERF-03); delta manifest response <500ms P95; offline log queue replays without duplicates after 24h simulated offline.
- **Evidence**: run logs + metrics table in `docs/poc/SYNC_POC.md`. Reviewer: second developer. DXG approval: no.
- **Fallback**: protocol redesign (chunk size, manifest shape) and re-run; sync approach must pass before M5 is planned in detail.

## G0-3: Physical schema + OpenAPI

- Pass: DDL migrations for all SRS §10 entities apply cleanly to empty Postgres and support the WORKFLOW_STATES.md lifecycles (state + version columns, per-room sync table); OpenAPI covers SRS §11 areas; both reviewed. Evidence: migration run in CI container; spectral-linted OpenAPI. DXG approval: no.

## G0-4: Discovery (DXG inputs)

- Stakeholder interviews done (PM, SRR technician, room technician, client-admin perspective); current DXG presentation workflow documented; SRR workflow observed/described; room-technician workflow documented; Windows device + Office fleet profile collected (versions, admin rights, AV software); multi-monitor/presenter-view configurations catalogued; retention/legal-hold/deletion policy confirmed with DXG; pilot-event profile agreed (rooms, speakers, file mix).
- Pass: each produces a short doc under `docs/discovery/`. Owner: Travis + PM. **DXG approval: required** (they are the source).

## G0-5: Security foundations

- Threat model workshop output (STRIDE-lite over the data-flow diagram) recorded in SECURITY_MODEL.md; role × permission matrix drafted for all SRS §5 roles across M01–M15. Pass: both reviewed; high-risk threats have planned mitigations. DXG approval: on the permission matrix.

## G0-6: Usability prototypes + acceptance walkthrough

- Design authority is the client baseline prototype (`prototype/client-baseline.html`, D-010): 17-screen inventory (VISUAL_ACCEPTANCE.md §1) and the built-in 19-step demo, transcribed as `docs/ACCEPTANCE_WALKTHROUGH.md`.
- Pass requires BOTH: (a) DXG stakeholders complete the 19-step walkthrough with no more than minor revisions (SRS §22 prototype criterion); (b) the **side-by-side screenshot sheet for all 17 screens** (VISUAL_ACCEPTANCE.md §3) is approved screen-by-screen. **No application scaffolding before (b).** **DXG approval: required.**

## G0-7: Test corpus + sample imports

- Representative presentation/media corpus assembled (≥30 decks covering the G0-1 matrix categories + video codec matrix H.264/HEVC/ProRes) and sample agenda XLSX/CSV files from DXG for import mapping. Pass: corpus catalogued in repo (or S3 with manifest); import samples parsed in a spike. DXG approval: no (but DXG supplies real-world samples).

## G0-8: Infrastructure design (see PLAN P0-D)

- Environment/stack design (dev, production-parity staging, prod; network/data/application/observability stacks), Multi-AZ Postgres, Redis availability, versioned S3+KMS+cross-region replication, backup/PITR with RPO≤15m/RTO≤4h validation plan, WAF+CloudFront, worker scaling, heartbeat/queue/outbox alarms, deployment + rollback strategy (blue/green or equivalent — this closes the SPEC's open deployment design), stateful-stack termination protection. CI design includes `cdk synth --strict`, cdk-nag, type checks, infra tests, `cdk diff` review before deploy, drift detection. **Must not copy RFPilot's temporary reduced-redundancy production configuration.**
- Pass: design doc reviewed; costed roughly. DXG approval: no.

## G0 decision

G0 review meeting outcome is recorded in DECISIONS.md as one of:
- **PROCEED** — all items PASS (or PASS-with-fallback); MVP implementation may begin.
- **PROCEED WITH CONDITIONS** — enumerated exceptions with owners and dates.
- **DO NOT PROCEED** — a fundamental viability item (G0-1, G0-2) failed; re-plan with DXG.
