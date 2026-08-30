# VISUAL_ACCEPTANCE.md — Visual Fidelity to the Client Baseline

Status: v1.0 (2026-08-30). `prototype/client-baseline.html` is the design authority (D-010). This document defines what "matches the baseline" means and gates scaffolding on it.

## 1. The 17-screen inventory (P0-E9 of record)

Control Center: **1** Portfolio · **2** Create event (wizard) · **3** Schedule import · **4** Command center · **5** Speakers · **6** Presentation detail · **7** Inspection · **8** Review & approval · **9** Communications · **10** Archive builder — Onsite: **11** Speaker Ready Room · **12** Check-in · **13** USB intake · **14** Room sync — Device: **15** Room Agent (room view) — External: **16** Speaker portal · **17** Client portal.

## 2. Match requirements

The application (and any enhanced prototype) must match the baseline on all of:

1. **Navigation** — same sidebar structure and grouping (Control Center / Onsite / External), same screen order and names.
2. **Terminology** — the baseline's words are the product's words: "Command center", "Portfolio", "USB intake", "Speaker Ready Room", state labels ("Not submitted", "Submitted", "Warning", "Technician review", "Client review", "Approved", "Final onsite version", "Synchronized onsite", "Update pending ack"). No renaming without DXG agreement.
3. **Branding** — DXG·PM wordmark treatment, event-context header (event name · day), client branding surfaces where the baseline shows them.
4. **Colors** — extract the baseline's palette (dark UI ground, cyan/blue primary action, green/amber/red semantic states, per-track progress bars) into design tokens; the app derives every color from those tokens.
5. **Typography** — same face roles and hierarchy as the baseline (system/Segoe-stack UI text, monospaced time/code accents); type scale documented as tokens.
6. **Layout** — same regional structure per screen (sidebar + content, KPI card rows, queue-plus-preview split in Review, readiness grid in Room sync, portal card layouts).
7. **States** — every state the baseline renders exists visually in the app: empty, loading, warning, error, offline (Room Agent), pending-ack, and the status pills above.

Deviations are allowed only for: real-data constraints, accessibility fixes (WCAG 2.1 AA wins over the baseline), and behaviors the baseline lacks (see §4) — each deviation logged in this file's changelog with a reason.

## 3. Screenshot comparison gate — REQUIRED BEFORE APPLICATION SCAFFOLDING

- Produce a side-by-side sheet: for each of the 17 screens, baseline screenshot next to the proposed implementation screen (initially: the enhanced prototype; later: the built app), at 1440×900 and 375×812 (portal screens).
- **Approval**: Travis signs off screen-by-screen; DXG sign-off on the sheet satisfies the SRS §22 prototype criterion. No frontend application scaffolding until all 17 rows are approved.
- Ongoing: the same sheet is re-run at each milestone that touches UI (M1–M6) and at M7 UAT; visual regressions against approved rows are defects.

## 4. Behaviors to graft from the workflow study

`prototype/workflow-study.html` interactions are reimplemented **inside the baseline's IA and design language** (never its own visuals):

- Live derived status per talk (WORKFLOW_STATES §8) on Command center / Presentation detail.
- Approval → room readiness causality visible across Review & approval → Room sync.
- Resumable-upload interruption/resume demo on Speaker portal (step 5 of the walkthrough).
- Three comment lanes with enforced audience labels on Review & approval.
- Never-silently-replace: new SRR version shows "Update pending ack" in Room sync while the room keeps the approved copy.
- Keyboard decisions (A/R) in the review queue.
