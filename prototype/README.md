# prototype/

| File | Role |
|---|---|
| `client-baseline.html` | **THE design authority (D-010).** The 17-screen clickable prototype DXG was given. All UI work matches it — navigation, terminology, branding, colors, typography, layout, states. Never edit this file; enhancements go in a separate faithful build. |
| `index.html` | Canonical entry point — opens the client baseline. |
| `enhanced.html` | Faithful enhanced build — baseline IA + design tokens with the live workflow behaviors grafted in; the implementation-side input to the VISUAL_ACCEPTANCE §3 screenshot sheet. |
| `comparison.html` | The P0-E16 visual acceptance sheet — baseline (left, authority) vs enhanced (right) with synced navigation, per-screen approval + notes, mobile toggle. Regenerate after any enhanced.html change (both files are embedded). |
| `workflow-study.html` | Internal interaction study (pre-baseline). Its behaviors (live derived statuses, resumable-upload demo, approval → room-readiness causality, never-silently-replace) are the *behavior* reference and must be reimplemented inside the baseline's information architecture and design language — its visuals are NOT a reference. |

Acceptance: `docs/ACCEPTANCE_WALKTHROUGH.md` (the 19-step script) and `docs/VISUAL_ACCEPTANCE.md` (screen-by-screen visual match gate — required before application scaffolding).
