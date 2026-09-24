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

   > **Amended 2026-09-24 (D-078):** items 4 and 5 are superseded by the Kravio design system
   > (`docs/design-system/KRAVIO_DESIGN_SYSTEM.md`): light ground, no accent colour, near-black gradient for
   > emphasis, Inter only. Items 1–3, 6 and 7 still bind.

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

### 2026-09-20 — the event-context slot becomes an event switcher

**Deviation.** §2.1 fixes the sidebar's structure and §2.3 the event-context header
("event name · day"). That slot rendered a hardcoded string, `MedTech Fwd 26 · Day 2`. It is now a
control: a select listing the events this account works on, with the current event's day beneath it.

**Reason.** The baseline is a single-event prototype, so the slot could only ever be a label. With
more than one event a fixed string is not merely unhelpful, it is wrong on every event but one — the
single element whose job is to say where you are would be lying. Grouping, order and names are
untouched; the slot keeps the same position and still shows event name and day.

**Day, honestly.** "Day 2" is computed from today against the event's dates. Outside the event's run
it would produce a confident lie like "Day -14", so the date range is shown instead.

**A related fix, not a deviation.** Event-scoped links used to fall back to the seeded event's id when
the URL had none. That was harmless while one event existed and became a trap under D-025, since a
staff member not on that event got a sidebar where every link refused. Those links are now inert
until an event is chosen, which is the state the baseline never had to depict.

### 2026-09-20 — ADMIN gains a second entry, Event assignments

**Deviation.** §2.1 fixes the sidebar's grouping and screen list. The ADMIN group had one entry,
Staff accounts; it now has two, with **Event assignments** beneath it. Both are gated to
`platform_admin` and `project_manager`, so the group is invisible to everyone else exactly as before.

**Reason.** They are two jobs, and one screen was making each one harder. Placement — who works which
event, and as what — is asked while staffing an event. Account administration — passwords,
authenticators, whether someone can sign in at all — is asked about a person. Holding both meant every
account row carried controls for a question nobody was asking at that moment.

The baseline has no equivalent to weigh this against: it is a single-event prototype with no roles, so
neither screen exists in it. Nothing else is renamed, reordered or regrouped.


### 2026-09-21 — Schedule import leaves the sidebar

**Deviation.** §2.1 fixes the sidebar's names and order, and the baseline lists `Schedule import` third
under Control Center. It is no longer there.

Screen 3 still exists and is unchanged; what changed is how it is reached. Since D-027 the import is
step 2 of Create event and an event cannot be activated without it, so the sidebar was offering as a
destination something the product takes you to. Worse, the entry pointed at `/events/:id/import` for
the *currently selected* event — so following it from the sidebar mid-wizard meant importing into a
different event than the one being created.

**The screen keeps an entry point**, on the command centre, labelled `Re-import agenda`. That is the
case it still serves: agendas are revised constantly before an event, and re-import matches on
(room, start, title) and updates rather than duplicating. A capability with no way in is a capability
nobody has — and the sidebar was, until now, the only link to it anywhere in the app.

**The wizard's step 2 is also renamed**, from `Schedule import` to `Agenda`. Inside the wizard the step
is the thing being set up, not the act of loading it — `Basics`, `Deadlines & workflow` and
`Branding & template` are all named for what they configure, and this one was named for a mechanism.
The standalone screen keeps the name `Schedule import`, because there the import is what you came to do.

Nothing else is renamed, reordered or regrouped. The baseline's screen inventory is unchanged: this is
a navigation change, not the removal of a screen.

### 2026-09-21 — a draft's card offers `Continue setup`, and its command centre redirects

**Deviation.** §2.2 fixes the baseline's words as the product's words, and screen 1's portfolio card
carries `Open →`. On an event still in `Planning` that button now reads `Continue setup →` and goes to
the wizard rather than to the command centre; reaching a draft's command centre by any other route —
the sidebar's event switcher, a bookmark — redirects there too.

**Reason.** The baseline is a single-event prototype in which every event already exists, so it has no
draft, no `Planning` state and nothing to say about one. `Open →` is the right word for an event that
is running and the wrong word for one that was never finished: the screen it opened reported a live
indicator, `0 / 0` collected and "every talk is synchronized onsite" for an event with no agenda at
all, while the setup it actually needed was reachable from nowhere in the product (D-036).

**Scope.** `Open →` is untouched on every active, closed and archived event, which is every event the
baseline depicts. Nothing is renamed, reordered or regrouped, and the screen inventory is unchanged —
screen 4 still exists and is still where an event that is running opens.

**A related fix, not a deviation.** Screen 4's risk list said "Nothing at risk — every talk is
synchronized onsite" whenever it had no rows, including when the event has no talks to be at risk.
With no talks it now says so.

### 2026-09-21 — screen 18: Event details

**Deviation.** §1 fixes the inventory at 17 screens and §2.1 the sidebar. There is now an eighteenth,
`Event details` at `/events/[id]/details`, and the portfolio card's `Open →` goes there instead of to
the command centre. It is **not** in the sidebar — it is reached from the portfolio card and from
`Event details` on the command centre header, the same treatment Schedule import was given.

**Reason.** The baseline is a single-event prototype in which the event's setup is a given, so it has
nowhere to show one. Everything the create-event wizard writes — the timezone every displayed time in
the product renders in, the upload deadline that closes the speaker portal, the reminder cadence, the
accent colour, the rooms and days the agenda created — was visible on no screen at all once the wizard
closed, and since D-036 the wizard refuses an activated event. Travis's call, chosen over an
expand-in-place card and over reusing the wizard as a details view (D-037).

**Scope.** No existing screen is renamed, reordered, regrouped or removed; screen 4 keeps its route,
its name and its place in the sidebar, and remains where an event that is running opens. The status
words are unchanged — the chip on the new header comes from the same `EVENT_STATUS` map the portfolio
card uses, so the two cannot drift.

**Consequence for §3.** The screenshot sheet is a 17-row sheet against the baseline. This screen has
no baseline counterpart to sit beside, so it is an 18th row with the deviation above in place of a
comparison, not a row that can be approved by matching.
