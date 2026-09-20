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

## 5. Deviation changelog

§2 allows deviations for real-data constraints, accessibility, and behaviours the baseline lacks, each
logged here with a reason.

### 2026-09-20 — sidebar hides destinations the signed-in account is refused

**Deviation.** §2.1 fixes the sidebar's structure, grouping, order and names. The sidebar now omits an
entry when the API would refuse that account, so two entries are conditional:

| Entry | Shown to | Mirrors |
|---|---|---|
| Control Center / Onsite / Device groups | `STAFF_ROLES` | the deny-by-default staff gate in `index.ts` |
| Staff accounts | `platform_admin`, `project_manager` | `ADMIN_ROLES` in `services/admin.ts` |
| Client portal | everyone signed in | clients by right, staff as a preview |

A group with nothing left visible is dropped rather than left as a bare heading.

Not everyone signed in is staff: a `client_event_admin` uses the same login and is refused on every
control-centre, onsite and device route. Before this change such an account saw sixteen links of
which exactly one worked.

**Reason.** The baseline is a static prototype with no notion of who is signed in, so it could not
express this. Offering a door that only ever answers "you are not allowed" wastes the click and reads
as a fault in the product rather than a boundary in it — which is exactly how it was reported.

**Why this is not a renaming or reordering.** Nothing is renamed, reordered or regrouped. For an
account with full access the sidebar is byte-for-byte the approved baseline, which is the state the
§3 screenshot gate compares. The screenshot sheet should continue to be produced as
`platform_admin`; a narrower role legitimately shows fewer rows.

**Superseded the same day:** Client portal was briefly hidden from staff, because the API refused
them. Travis's call is that staff *should* be able to preview it, so the API now allows staff and the
screen bands itself — see the entry below.

**Not a security control.** The API refuses these routes regardless of what the sidebar renders;
typing `/admin/users` as a presentation manager still returns 403. Verified after the change.

### 2026-09-20 — staff may preview the client portal, banded as a preview

**Deviation.** Screen 17 gains a banner when a staff account opens it: *"Preview — this is what
&lt;client&gt; sees. Restricted talks are excluded from every figure here, so these counts are lower
than the command centre's. Nothing on this page can be changed."* Clients see the screen exactly as
the baseline shows it, with no banner.

**Reason.** Staff could not check what they were about to show a client. This is not a widening of
what staff may know — the client view is a strict subset of the control centre they already have,
with restricted talks filtered out (FR-ARCH-001). The filtering is identical for both viewers; only
the banner differs.

**Why band it at all.** The counts here are deliberately narrower. A staff member reading "3 of 3
collected" without knowing restricted talks were excluded would draw a false conclusion about their
own event, and might repeat it to the client. The banner names the client, so it is also obvious
*whose* view is being previewed.

