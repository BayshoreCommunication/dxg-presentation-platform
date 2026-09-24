# Kravio Design System — extracted spec

Source: https://kravio-dashboard.vercel.app/ (Vite + React, Tailwind v4, Radix primitives, shadcn-style tokens).
Extracted 2026-09-24 from the live DOM, computed styles and the compiled stylesheet
(`/assets/index-B-KlWWGk.css`). Every value below is measured, not guessed, unless marked **(approx.)**.

Companion files:
- `kravio-theme.css` — drop-in plain-CSS implementation using the same selectors as
  `apps/*/app/globals.css` (`aside`, `.card`, `.kpi`, `.btn`, `table`, `.chip`, `input` …) plus the new
  primitives Kravio adds (`.well`, `.seg`, `.menu`, `.cb`, `.feed`, `.avatar`, `.kbd`).
- `kravio-preview.html` — every component rendered with the theme, for side-by-side comparison.

> **Decision impact.** `globals.css` is bound to the client baseline by D-010 (dark sidebar, Barlow Semi
> Condensed headings, cyan `--blue` accent, IBM Plex Mono). Kravio is the opposite personality: light
> hairline sidebar, one typeface (Inter), no accent colour at all — the only "colour" is the near-black
> primary gradient plus green/red for deltas. Adopting it means amending D-010 and re-running the G0-6b
> visual approval. Nothing here is wired into the apps; it is a spec + theme file you can switch to.

---

## 1. Personality in one paragraph

Monochrome, hairline, layered. Everything sits on a `#f8f8f8` page; the main area is a white sheet with a
0.8 px inset ring. Cards are **wells**: a `#f6f6f6` tray with a faint diagonal hatch, a 0.8 px inset ring,
4 px padding, a small header row, and a white inner panel with its own 0.8 px border. There are no filled
accent buttons; emphasis comes from the dark gradient (`#37475d → #1f2937`) used sparingly (active tab
thumb, selected chart bar, checked checkbox). Text is small (12–14 px) with `line-height: 1` almost
everywhere, medium weight (500) for anything that matters. Motion is an expo ease-out with a staggered
"rise" on load and 1 px lifts on hover.

---

## 2. Foundations

### 2.1 Typography

| Role | Size / weight / leading | Colour token | Notes |
|---|---|---|---|
| Font family | `"Inter Variable", ui-sans-serif, system-ui, sans-serif` | | `@fontsource-variable/inter` (opsz axis, weights 100–900). `-webkit-font-smoothing: antialiased`. |
| Page title (`h1`) | 24 px / 500 / 1 | `--foreground` | "Hello, Name 👋" — emoji waves once. |
| Big stat (chart) | 32 px / 500 / 1 | `--foreground` | |
| KPI value | 24 px / 500 / 1 | `--foreground` | |
| Card title (`h2`) | 14 px / 500 / 1 | `--secondary-foreground` | Not the foreground — deliberately one step softer. |
| Body / nav item / table cell | 13 px / 400 (nav) or 500 (cells) / 1 | nav: `--secondary-foreground`, cells: `--cell-foreground` | |
| Breadcrumb | 14 px / 400 muted; current page 14 px / 500 foreground | | |
| Small (sub-nav, activity, tabs, delta, select) | 12 px / 400 or 500 / 1 | varies | Tabs, deltas, select labels are 500. |
| Menu group label | 11 px / 500 / 1, uppercase, tracking `.025em` | `--subtle-foreground` | |
| Sidebar section label | 12 px / 400 / 1.6, uppercase, no tracking | `--muted-foreground` | "MAIN NAVIGATION" |
| Logo wordmark | 18 px / 600 / 1 | `--foreground` | |
| Avatar initials | 12 px / 600 / 1, tracking −0.12 px | `--secondary-foreground` | |
| Kbd hint | 12 px / 500, `font-variation-settings: 'opsz' 14` | `#565d76` | |

Optical tracking used at small sizes: `-0.12px` @12 px, `-0.13px` @13 px (axis labels, "vs last week"),
`-0.16px` @13 px (count line). Numbers are **not** tabular.

### 2.2 Colour tokens (exact `:root`)

```css
--radius: .5rem;
--background: #f8f8f8;        /* page */
--foreground: #1f2937;        /* primary text (gray-800) */
--card: #fff;
--card-foreground: #1f2937;
--popover: #fff;
--popover-foreground: #1f2937;
--primary: #1f2937;           /* near-black, never a brand colour */
--primary-foreground: #fff;
--secondary: #f7f7f7;         /* table header row */
--secondary-foreground: #4b5563;  /* card titles, nav items, buttons (gray-600) */
--muted: #f6f6f6;             /* card tray */
--muted-foreground: #6b7280;  /* labels, placeholders, axis (gray-500) */
--subtle-foreground: #9ca3af; /* timestamps, descriptions (gray-400) */
--cell-foreground: #52525b;   /* table cell text (zinc-600) */
--accent: #f3f4f6;            /* menu item highlight */
--accent-foreground: #1f2937;
--success: #059669;           /* emerald-600 */
--destructive: #ef4444;       /* red-500 */
--border: #e5e7eb;            /* gray-200, all rings */
--input: #0000001a;           /* rgba(0,0,0,.1) — inner-panel and input borders */
--ring: #9ca3af;              /* focus ring base */
--chart-bar: #e6e6e6;
--chart-bar-border: #d8d8d8;
--chart-grid: #f2f2f3;
--ease-out-expo: cubic-bezier(.16, 1, .3, 1);
--ease-in-out: cubic-bezier(.65, 0, .35, 1);
```

Literal colours that appear outside the tokens (keep them literal, that is how the source does it):

| Use | Value |
|---|---|
| Hover border on buttons / inputs | `#d1d5db` |
| Hover background on buttons | `#fcfcfc` |
| Hover background on rows / tabs | `#fafafa` |
| Focus border on inputs | `#9ca3af` |
| Avatar chip | bg `#f7f7f7`, border `#d9d9d9` |
| Checkbox track | `#e1e4ea`, hover `#d4d8e0`, checked `rgba(75,85,99,.1)` |
| Dark gradient (primary emphasis) | `linear-gradient(180deg, #37475d 0%, #1f2937 64.7%)` |
| Chart bar (idle) | `linear-gradient(to bottom, #e6e6e6, rgba(230,230,230,.6))` |
| Sparkline up | stroke `#059669`, fill gradient `#059669` .3 → 0 |
| Sparkline down | stroke `#EF4444`, fill gradient `#F00606` .3 → 0 |
| Hairline dividers | table header `rgba(0,0,0,.04)`, row `rgba(0,0,0,.06)`, dashed divider `rgba(0,0,0,.1)` |
| Icon-button hover | `rgba(0,0,0,.04)` (header) / `rgba(0,0,0,.05)` (sidebar) |
| Hatch pattern | stroke `black` at `.03` opacity, `.8px` |

There is **no dark mode** and no brand hue. Everything is gray + one green + one red.

### 2.3 Radius scale

| Token | Value | Where |
|---|---|---|
| `sm` | 4 px | chart focus area, checkbox track |
| `md` | 6 px | icon buttons, breadcrumb links, sub-nav pill |
| `lg` | 8 px | **default**: buttons, inputs, nav items, menu items, table header row, activity icon tile |
| `xl` | 12 px | card wells, inner panels, popovers, account button |
| `10px` | 10 px | KPI inner panel only |
| `full` | pill | avatars, online dot |
| bars | top 8 px / bottom 4 px | chart bars |
| checkbox | 4 px track, 3 px knob | |

### 2.4 Borders — the 0.8 px rule

Every visible border is **0.8 px**, never 1 px. Two mechanisms:
- `border: .8px solid var(--border)` on interactive elements (buttons, inputs, nav active, tabs).
- `box-shadow: inset 0 0 0 .8px var(--border)` on containers (card wells, `<main>`), so the ring never
  affects layout. Inner panels use `var(--input)` (10 % black) instead of `--border`.

### 2.5 Shadows

```css
--shadow-nav-active: 0 4px 7px rgba(0,0,0,.04);
--shadow-input:      0 4px 14px rgba(0,0,0,.04);
--shadow-lift:       0 2px 3px -1px rgba(0,0,0,.10), 0 1px 0 0 rgba(25,28,33,.02), 0 0 0 1px rgba(25,28,33,.08);
--shadow-popover:    0 0 0 1px rgba(0,0,0,.06), 0 1px 1px -.5px rgba(0,0,0,.06), 0 3px 3px -1.5px rgba(0,0,0,.06),
                     0 6px 6px -3px rgba(0,0,0,.06), 0 12px 12px -6px rgba(0,0,0,.06), 0 24px 24px -12px rgba(0,0,0,.06);
--shadow-overlay:    0 2.8px 2.2px rgba(0,0,0,.034), 0 6.7px 5.3px rgba(0,0,0,.048), 0 12.5px 10px rgba(0,0,0,.06),
                     0 22.3px 17.9px rgba(0,0,0,.072), 0 41.8px 33.4px rgba(0,0,0,.086), 0 100px 80px rgba(0,0,0,.12);
--shadow-knob:       0 2.2px 3px rgba(27,28,29,.12);            /* checkbox knob */
--shadow-account:    drop-shadow(0 0 4px rgba(0,0,0,.03));      /* filter, not box-shadow */
--shadow-bar-dark:   inset 0 0 0 .44px #1f2937, 0 2px 10px rgba(31,41,55,.08);
--shadow-bar-idle:   inset 0 0 0 .444px var(--chart-bar-border), inset 0 0 0 1px #fff;
--focus-ring:        0 0 0 3px rgba(156,163,175,.40);           /* focus-visible on everything */
--focus-input:       0 0 0 3px rgba(156,163,175,.18);           /* + border-color #9ca3af */
```

`--shadow-lift` is the universal hover shadow (buttons, KPI panel, activity tile, account button),
paired with `translateY(-1px)` on cards.

### 2.6 Spacing

4 px base. Values that actually occur: 2 (nav item gap), 4 (well padding), 6 (button icon gap), 8 (header
row padding, cell gap), 10 (button/nav horizontal padding, cell vertical padding), 12 (sidebar/main
horizontal padding, cell horizontal padding, KPI text gap), 14 (inner panel padding, header vertical
padding), 16 (card grid gap, inner panel top padding), 20 (nav group gap, activity row gap), 24 (page
section gap).

Control heights: 24 (icon button), 28 (segmented tab, sub-nav row), 32 (button, input, nav item,
avatar), 36 (expanded nav parent, table header row), 45.75 (table row), 50 (account button), 52 (top bars).

### 2.7 Motion

```css
--ease-out-expo: cubic-bezier(.16,1,.3,1);   /* everything that moves */
--ease-in-out:   cubic-bezier(.65,0,.35,1);
/* durations */ 150ms hover colours · 200ms tabs/icons · 300ms transforms/collapses · 500ms tooltip travel · 700ms bar height
```

Keyframes (verbatim):

```css
@keyframes rise-in { 0%{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
@keyframes fade-in { 0%{opacity:0} to{opacity:1} }
@keyframes draw-x  { 0%{clip-path:inset(0 100% 0 0)} to{clip-path:inset(0)} }
@keyframes grow-y  { 0%{transform:scaleY(0)} to{transform:scaleY(1)} }
@keyframes pop     { 0%{opacity:0;transform:scale(.6)} 60%{opacity:1;transform:scale(1.12)} to{transform:scale(1)} }
@keyframes dd-in   { 0%{opacity:0;transform:translateY(-4px) scale(.97)} to{opacity:1;transform:none} }
@keyframes dd-out  { 0%{opacity:1} to{opacity:0;transform:scale(.98)} }
@keyframes ring    { 0%,to{transform:rotate(0)} 20%{transform:rotate(14deg)} 40%{transform:rotate(-12deg)} 60%{transform:rotate(8deg)} 80%{transform:rotate(-4deg)} }
@keyframes wave    { 0%,to{transform:rotate(0)} 15%{transform:rotate(14deg)} 30%{transform:rotate(-8deg)} 45%{transform:rotate(14deg)} 60%{transform:rotate(-4deg)} 75%{transform:rotate(10deg)} }
```

Utility classes: `.animate-rise` = `rise-in .52s var(--ease-out-expo) both`; `.animate-fade` = `fade-in .3s ease-out both`;
`.animate-draw` = `draw-x 1.1s expo both`; `.animate-grow` = `grow-y .9s expo both` (origin bottom);
`.animate-pop` = `pop .26s expo both`; dropdown open `dd-in 180ms expo`, close `dd-out 120ms ease-in`.

**Load choreography (animation-delay):** greeting 0 → header actions 60 ms → KPI cards 0 → updates card
200 → chart card 260 → table card 340. Inside: sparklines draw at 300; chart bars grow at 380 + 45 ms
per bar; chart tooltip fades in at 1100; table rows rise at 420; activity rows rise at 0/45/90/135 …;
wave emoji `wave 1.8s ease-in-out 600ms 1`.

**Micro-interactions:** buttons `active:scale(.97)` (account button `.99`); nav icon `scale(1.1)` on
hover; KPI header icon `rotate(-12deg) scale(1.1)`; sparkline `scale(1.04)` from bottom-right; bell icon
`ring 600ms` on hover; filter icon `translateY(1px)`; chevrons `rotate(180deg)` 200 ms; sub-nav label
slides `padding-left: 6px` on hover; table avatar `scale(1.1)` on row hover; status icon `pop` on mount.

### 2.8 Iconography

Custom 16 × 16 outline set exported from Figma as inline `data:image/svg+xml` `<img>` tags (144 of them,
zero inline `<svg>`). Stroke **1.2 px**, round caps and joins, `fill: none`, viewBox `0 0 16 16`.
Colours are baked in: `#4B5563` for default/active, `#9CA3AF` for muted (search, sort, chevrons), white
for the checkbox tick. Secondary sizes: 12 px chevrons/sort arrows, 10 px check, 20 px avatars. Some
glyphs carry a `#D9D9D9` fill on one shape (e.g. the dashboard/grid icon).
Closest open-source match: **Hugeicons "stroke-rounded"** or Lucide at `stroke-width: 1.2` — either at
16 px with `color: var(--secondary-foreground)` reads identically.

Scrollbars are hidden globally (`::-webkit-scrollbar{display:none}`, `scrollbar-width: none`), except
the table scroller which uses `scrollbar-width: thin`.

---

## 3. Layout shell

```
body            bg --background, min-height 100dvh, flex row
├─ aside        250 px, transparent (sits on the grey page), flex column
│  ├─ top row   52 px: px 12 · py 14 · logo (24 px mark + 18/600 wordmark, 200 px wide) · collapse icon button
│  └─ body      px 12 · pb 16 · gap 16 · column
│     ├─ search input (226 wide, h 32, shadow-input, ⌘K kbd addon)
│     ├─ nav    226 wide · gap 20 between groups · scrolls, scrollbar hidden
│     │   group: 12 px uppercase label → gap 12 → items with gap 2
│     └─ account button (226 × 50, rounded-xl, pinned bottom)
└─ main         flex 1, bg white, inset ring .8px --border, px 12
   ├─ header    52 px: breadcrumb (16 px icon · 14 px muted link · 7×11 chevron · 14/500 current) | bell · settings (24 px icon buttons, gap 12)
   └─ content   px 4 · py 16 · column · gap 24
       ├─ greeting row: h1 24/500 + 13 px secondary subtitle (gap 16) | select (117 wide) + ⋯ button (gap 8)
       ├─ KPI grid: 3 columns, gap 16, each 140 tall
       ├─ row (≥1400 px): chart well (flex 1, 404 tall) + updates well (332 wide, 560 tall), gap 16
       └─ table well
```

Below `lg` the sidebar becomes an overlay and a hamburger appears in the header. KPI grid is 1 column
below `sm`.

---

## 4. Components (exact values)

### 4.1 Card well (the signature container)

```
section.well        position relative · rounded 12 · bg --muted · padding 4 · box-shadow inset 0 0 0 .8px --border · overflow clip
  ├─ hatch overlay  absolute img 1639×560 (or CSS repeating gradient), pointer-events none — diagonal lines, black .03, .8 px wide, 10.8 px apart, ~27° from vertical
  ├─ header         flex · justify-between · padding 8 · h2 14/500 --secondary-foreground · 16 px icon on the right (rotates/scales on hover for KPIs)
  └─ body panel     rounded 12 (KPI: 10) · bg white · border .8px --input (KPI: --border) · padding 16 14 14 (KPI: 0 12 12, items-end)
```
Fixed heights: KPI 140, chart 404, updates 560. Table well has no fixed height; its body panel is
`bg white · rounded 12 · padding 6 · inset ring .8px --input · overflow-x auto`.

### 4.2 KPI card
Header label + icon. Body: column gap 12 → value 24/500 → row gap 6: delta 12/500 (`--success` or
`--destructive`, always signed "+7.1%") + "vs last week" 13 px muted. Right side: sparkline 91 × 36
(polyline stroke 1 px, area fill gradient .3 → 0), `draw-x` on load, `scale(1.04)` on hover. Whole panel
lifts 1 px + `--shadow-lift` on hover (300 ms expo).

### 4.3 Sidebar nav item
```
button    h 32 (36 when it has an open sub-list) · w 100% · rounded 8 · padding 0 10 · 13/400 · border .8px transparent
          text --secondary-foreground · left: 16 px icon + gap 10 + label · right: 12 px chevron (parents only)
hover     bg rgba(255,255,255,.7) · text --foreground · icon scale 1.1
active    bg white · border .8px --border · shadow-nav-active · text --foreground
```
Sub-items: row h 28, label pill 188 wide right-aligned, 12/400 `--muted-foreground`, rounded 6; a 9 × 21
elbow connector at left 18 / top −5 and a 4 px dot at left 23 / top 13; hover: bg white/70,
padding-left 6 px, text foreground. Collapse uses `grid-template-rows 1fr → 0fr` + opacity, 300 ms expo.

### 4.4 Section label
12 px uppercase, `line-height 1.6`, `--muted-foreground`, no tracking. Groups: "Main navigation",
"Analytics & insights", "Support".

### 4.5 Search / text input
`label.input-group`: h 32 · rounded 8 · border .8px --border · bg white · padding 8 8 8 10 · gap 8 ·
`--shadow-input` (sidebar only; in-card inputs drop the shadow and use `--input` border). Left 16 px
icon (`#9CA3AF`), 13 px text, placeholder `--muted-foreground`. Right addon: two 16 px kbd squares
(⌘ glyph, "K") that fade out on focus. Hover border `#d1d5db`; focus-within border `#9ca3af` +
`0 0 0 3px rgba(156,163,175,.18)`, 150 ms.

### 4.6 Buttons
Only two visible variants exist; there is **no filled primary button** on the page.

| Variant | Spec |
|---|---|
| Secondary (default) | h 32 · rounded 8 · border .8px --border (or --input inside cards) · bg white · 12/500 `--secondary-foreground` · padding 0 8 0 10 · gap 6 · icon 16. Hover: border `#d1d5db`, bg `#fcfcfc`, `--shadow-lift`. Open state same as hover. Active `scale(.97)`. Focus `--focus-ring`. Disabled opacity .5. |
| Icon (ghost) | 24 × 24 · rounded 6 · padding 4 · transparent · hover bg `rgba(0,0,0,.04)` · open `rgba(0,0,0,.05)`. Bordered variant: 32 × 32 rounded 8 with `.8px --border` (the "⋯" next to the select). |

Transition: `background-color, border-color, box-shadow, transform, color` 150 ms ease-out.

### 4.7 Select trigger
Secondary button, fixed 117 wide, `justify-between`, 16 px calendar icon + label + 12 px chevron
(rotates 180° when open). Label swaps with `.animate-fade`.

### 4.8 Dropdown menu (Radix)
Panel: w 176 · rounded 12 · bg white · padding 4 · `--shadow-popover` (no border) · `dd-in` 180 ms.
Group label: 11/500 uppercase tracking .025em `--subtle-foreground`, padding 6 8 4.
Item: 13 px `--secondary-foreground` · rounded 8 · padding 6 8 · gap 8 · pr 28 for the check slot;
highlighted bg `--accent` + text foreground; selected shows a 14 px check at the right.

### 4.9 Segmented toggle (Today / Yesterday / This week)
Container `flex gap 8`, items `flex 1 · h 28 · rounded 8 · border .8px --border · bg white · 12/500
--secondary-foreground · hover bg #fafafa · active scale(.97)`. A sliding thumb (absolute, h 28, rounded
8, `border 1px --primary`, dark gradient) moves with `left` 300 ms expo; the selected item goes
`border transparent · bg transparent · color white` on top of it.

### 4.10 Checkbox
16 × 16 button, rounded 4. Track: 14 px centred, `#e1e4ea`, hover `#d4d8e0`, checked
`rgba(75,85,99,.1)`. Knob: 12 px at (2,2), white, rounded 3, `--shadow-knob`; checked → bg `--primary`
with a 10 px white check that `pop`s in.

### 4.11 Table
```
scroller   bg white · rounded 12 · padding 6 · inset ring .8px --input · overflow-x auto · scrollbar thin
grid       columns 140 · minmax(170,1fr) · 160 · 160 · 160 · 160 · 140 · 40   (min-width 1138)
header     h 36 · rounded 8 · bg --secondary · border .8px rgba(0,0,0,.04) · th 13/400 --secondary-foreground + 12 px sort icon (opacity .7 on hover) · padding 10 12 · first cell padding-left 12 with checkbox + gap 8
row        h 45.75 · bg white · border-bottom 1px rgba(0,0,0,.06) · hover bg #fafafa 150 ms · rises in at 420 ms
cell       13/500 --cell-foreground · padding 10 12 · gap 8 · truncate · subject cell goes --foreground on row hover
extras     priority = 16 px signal icon + text; assignee = 20 px round photo (scale 1.1 on hover) + name;
           status = 16 px icon (pop) + text; last column = 24 px ghost icon button "⋯"
```
No striped rows, no coloured status chips — status is icon + plain text.

### 4.12 Activity feed
`ol` gap 20. Row: 32 × 32 icon tile (rounded 8 · border .8px --input · bg white · padding 8 · lifts +
`--shadow-lift` on hover, icon scale 1.1) + dashed vertical connector (`.dash-y`: 1 px,
`repeating-linear-gradient(to bottom, var(--border) 0 4px, transparent 4px 8px)`, from top 32 to −20)
+ text column (padding-top 2, gap 12, 12 px, tracking −0.12): title 12/500 foreground with time
12 px `--subtle-foreground` right-aligned; description 12 px subtle with `--foreground` spans for
IDs / names / quoted titles. Count line above: "**8** new activities today" (16/500 number, 13 px muted).
Dashed horizontal dividers: `stroke rgba(0,0,0,.1) dasharray 4 4`.

### 4.13 Bar chart
Plot 216 tall with a background grid image (`--chart-grid`). Bars are absolutely positioned, width
5.42 %, `grow-y` from bottom staggered 45 ms. Idle bar: gradient `#e6e6e6 → rgba(230,230,230,.6)`,
`--shadow-bar-idle`, radius 8 top / 4 bottom. Selected bar: dark gradient + `--shadow-bar-dark`, cross-fades
300 ms with `scaleY(.98)`. Tooltip: 75 × 24 dark pill, 12/500 white, moves with `left/top` 500 ms expo, a
dashed guide line to the y-axis. Axis labels 13 px `--muted-foreground` tracking −0.13. Left stat: 32/500
number + green delta + "vs last week".

### 4.14 Avatar / account
Initials chip: 32 px round · bg `#f7f7f7` · border .8px `#d9d9d9` · 12/600 `--secondary-foreground`;
online dot bottom-right (`--success`, white ring). Account button: 226 × 50 · rounded 12 · border .8px
--border · bg white · padding 8 10 8 8 · gap 8 · `drop-shadow(0 0 4px rgba(0,0,0,.03))` · hover
`--shadow-lift` · active scale(.99); name 14/500, email 12 px subtle; 12 px up/down chevron at right.

### 4.15 Breadcrumb
`nav` gap 16: link (16 px icon + 14 px muted text, → foreground on hover) · 7 × 11 chevron glyph ·
current 14/500 foreground.

---

## 5. Mapping onto the existing DXG classes

`kravio-theme.css` keeps every selector `globals.css` already exposes so the swap is an import change.

| Existing (D-010 baseline) | Kravio equivalent | Change |
|---|---|---|
| `aside` dark `#14181B`, 216 wide | transparent on `#f8f8f8`, 250 wide, hairline | inverted |
| `.logo b` Barlow 19/700 white | Inter 18/600 `--foreground` | |
| `.grp` 10.5 px tracking .14em | 12 px uppercase, no tracking, `--muted-foreground` | |
| `aside nav button` 13.5 px + dot | 13 px, 16 px icon slot, `.on` = white card + shadow | dot removed |
| `main` padding 24 | white sheet with inset ring, header 52, content padding 16/4 | |
| `.htitle` 23/700 Barlow | 24/500 Inter | |
| `.card` white 8 px border 1 px | `.well` tray + `.card` inner panel (12 px, .8 px) | two-layer |
| `.card .chd h3` 15/600 | 14/500 `--secondary-foreground` | |
| `.kpi .kl` uppercase | 14/500 sentence case; `.kv` 24/500 Inter | |
| `th` uppercase 10.5 px | 13/400 in a 36 px grey pill row | |
| `td` 13.5 px, 1 px lines | 13/500 `--cell-foreground`, 6 % lines, 45.75 rows | |
| `.chip` coloured pills | **no equivalent** — Kravio uses icon + text. `.chip` is kept as a neutral pill; `.c-ok/.c-bad` derive from `--success/--destructive` at 10 % **(extrapolated)** | |
| `.btn.pri` cyan | dark-gradient button **(extrapolated from the toggle thumb; the source has no filled button)** | |
| `--blue` accent, `.mono`, Barlow | removed — Inter only, no accent | |
| `.toast` | dark pill, rounded 8, `--shadow-popover` | |

Things Kravio has no answer for (keep the current treatment or extend deliberately): the demo bar,
review lanes (`.lane`), progress bars, slide thumbnails, the dark pane. The theme file styles them with
Kravio tokens so nothing breaks, but they were designed here, not copied.
