# Global design system: proposal (UI/UX QA, phase 1)

**Date:** 24 Nov 2026. **Build:** v1.88.0 (`893fb4b`). **Status (updated 24 Nov 2026, v1.89.0 stage 3a, D-421): ADOPTED** for the shell, type and control tokens: the owner said "go ahead with your recommendations" and the reference dimensions are now the app's tokens. §A below lists what is in the code; the original proposal follows unchanged (its "Current" columns are the v1.88.0 measurements). The page-by-page sweep that applies them everywhere is batch 2 ([UI_REFACTORING_LOG.md](UI_REFACTORING_LOG.md)).

## A. Adopted tokens (v1.89.0, D-421)

One source: `styles/globals.css` `:root` (phones: the `@media (max-width: 767.98px)` block under it). Tailwind maps them in `tailwind.config.ts`. Guarded by `tests/ui/shell-tokens-v189.test.ts`.

| Group | Token | Value | Tailwind class | Applied in stage 3a |
|---|---|---|---|---|
| Shell | `--header-h` | 64; **56 below 768 in every area** | `h-topbar` | both headers, public header, MobileNav sheet |
| Shell | `--sidebar-w` / `--sidebar-w-rail` | 250 / 72 | `w-sidebar` / `w-rail` | SidebarFrame |
| Shell | `--page-px` / `--page-pt` | 24 / 24; 16 / 16 below 768 | `px-page` / `pt-page` | header, `main`, banners, public pages |
| Shell | `--section-gap` | 24; 16 below 768 | `mb-section`, `gap-section` | PageHeader |
| Shell | `--content-max` | 1600, left-aligned beside the sidebar (C16 option b) | `max-w-content` | `main` (not Classic) |
| Shell | `--content-max-reading` / `--content-max-form` | 896 / 960 | `max-w-reading` / `max-w-form` | Help, Privacy, Terms (reading); forms: batch 2 |
| Type | `--text-page-title` | 24 / 32, 600 | `text-page-title` | PageHeader + 23 custom h1s that used `text-title` |
| Type | `--text-section` | 18 / 24, 600 | `text-section` | defined; h2 sweep in batch 2 |
| Type | `--text-body` | 14 / 20 | `text-body` (unchanged) | |
| Controls | `--control-h-sm / -md / -lg` | 32 / 40 / 48 | `h-control-sm/-md/-lg` | `btn-compact`, `btn-ghost`, `tb-btn`, `tb-split`, `pill-select` = sm; `btn-primary/-secondary/-danger/-danger-quiet` = md; `btn-lg` = lg; `Button size="sm/md/lg"` |
| Controls | `--input-h` / `--input-h-sm` | **42** (owner) / 32 | `h-input` / `h-input-sm` | `field-input` / `field-compact` |
| Controls | `--touch-min` | 44 on `pointer: coarse` | `min-h-touch` | every named control class |
| Radius | `--radius-control / -card / -popover / -modal / -pill` | 8 / 12 / 12 / 16 / 9999 | `rounded-md/-lg/-xl` read them; `rounded-control/-card/-popover/-modal` | (values unchanged) |
| Spacing | `--space-1 … --space-12` | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 | Tailwind `1 2 3 4 5 6 8 10 12` | scale fixed; lint in batch 2 |

**Decisions on the open questions (§9):** Q-UI-1 yes, with the owner's input height **42** and button **40** (they differ by 2 px on purpose; a field and its button in one row align by `items-center`). Q-UI-2: left-aligned, max 1600 (the owner's brief said ~1600 rather than the proposal's 1440). Q-UI-3: Classic kept as it is for now (its box, title bar and field override unchanged). Q-UI-4: yes, phone header 56 in every area. Q-UI-5: D-420. Q-UI-6: yes, rail by default **768-1279** (the owner extended the proposal's "below 1024" to below 1280); the person's saved choice wins.

**Conflicts resolved (§0):** C1 (phone 56 everywhere, public 64), C2, C3, C4, C5, C6, C8 (shared title size; other h1 styles batch 2), C11 and C12 (tokens; page overrides batch 2), C13 / C14 (tokens), C16. Open for batch 2: C7 (section gap on pages without PageHeader), C9 (h2 sizes), C15 (spacing lint).

---

## Proposal (phase 1, unchanged)

This proposal keeps the ARS brand. The tokens come from `D:\Omniroute\assets\tokens`, D-022, `styles/globals.css` and `tailwind.config.ts`. It maps the owner's reference dimensions onto those tokens and flags every conflict with a recommendation. The owner's reference values are "starting values, configurable via tokens". So every value below is a token, never a page-level number.

**Sources:**
- **Current** values were measured by the sweep (`tests/e2e/zz-ui-qa-audit.spec.ts`, Chromium; 1,723 page visits, 177 role × route pairs, 9 viewports). Raw data: `audit/ui-qa/geometry.json`. Aggregates: `audit/ui-qa/summary.json`.
- The rest comes from the code (file:line).

**Related:** [SCREEN_LAYOUT_STANDARD.md](SCREEN_LAYOUT_STANDARD.md), [GLOBAL_COMPONENT_INVENTORY.md](GLOBAL_COMPONENT_INVENTORY.md), [GLOBAL_MOTION_AUDIT.md](GLOBAL_MOTION_AUDIT.md), [UI_UX_DEFECT_REPORT.md](UI_UX_DEFECT_REPORT.md).

## 0. Summary of conflicts with the owner's reference dimensions

| # | Owner reference | Current (measured) | Where it is set | Conflict | Recommendation |
|---|---|---|---|---|---|
| C1 | Header 64 px | **64** desktop and panels at every width. **56** in the users phone layout (below 768). **68-69** on the public Privacy / Terms pages. | `AppShell.tsx:319` `h-topbar` (`tailwind.config.ts:85` `topbar: 64px`); `AppShell.tsx:293` `h-[calc(3.5rem+…)] min-h-14`; public layout header | Phone 56 and public 68 | Keep 64 as `--header-h`. Phone: adopt a `--header-h-mobile: 56px` token (a 56 px phone bar is the platform norm; 64 wastes vertical space). Public pages: use `--header-h` (64). |
| C2 | Sidebar 250 expanded | **220** everywhere | `tailwind.config.ts:85` `spacing.sidebar: "220px"`; `SidebarFrame.tsx:84` `w-sidebar` | **-30 px** | Adopt **248** (a multiple of the 8 px grid) or 250 as `--sidebar-w`. At 1024-1279 px, 250 leaves 774 px of content. Pair it with the collapse default below. Labels up to 28 characters then fit without wrapping. |
| C3 | Sidebar 72 collapsed | **80** (`w-20`) | `SidebarFrame.tsx:84` | **+8 px** | Adopt **72** as `--sidebar-w-rail`. The rail labels are 10 px under the icons (`SidebarFrame.tsx:116`). At 72 px the labels need a 2-line clamp, which exists, or tooltip-only. |
| C4 | Header padding-x 24 | **24** from 640 px; **16** below (panels); **12** (users phone bar) | `AppShell.tsx:319` `px-4 sm:px-6`; `:293` `px-3` | Phone 12 vs 16 | `--page-px` = 24 from 640 px and 16 below, for both header and content. The phone bar is 12 today: align it to 16. |
| C5 | Content padding-x 24 | **32** from 640 px (`sm:px-8`); **16** below | `AppShell.tsx:399` `px-4 … sm:px-8` | **+8 px**; header 24 and content 32 don't line up (the page title starts 8 px right of the header's search edge) | Adopt 24 (`--page-px`) for both, so header and content share one left line. |
| C6 | Content top padding 24 | **40** from 640 px (`sm:pt-10`); **24** below (panels); **16** (users phone layout) | `AppShell.tsx:399` `pt-6 sm:pt-10`; `:398` `pt-4` | **+16 px** desktop | Adopt 24 (`--page-pt`), and 16 on phones (`--page-pt-mobile`). |
| C7 | Section gap 24 | PageHeader `mb-6` = **24** (63 pages); `/users` overviews **20**; the request detail **0**; 28 users pages have no PageHeader (they use their own header) | `PageHeader.tsx:15`; `features/home/OverviewParts.tsx`; `app/users/requests/[id]/page.tsx` | Mixed | `--section-gap: 24px`; use `space-y-6` / `gap-6` for page sections (the existing pattern). |
| C8 | Page title 24 px | **20 px / 600** (`text-title`) on 260+ pages. **28** (task detail on phones, `TaskDetail.tsx:223` `text-greeting`), **32** (New project `NewProjectWizard`; auth pages), **44** (landing), **22 / 800** (users phone layout `.mob-screen-title`), **14 sr-only** (AI assistant; phone More) | `tailwind.config.ts:72` `title`; `globals.css:938` `.mob-screen-title`; the files listed | -4 px against the owner; **6 sizes in use** | Adopt **24 / 600** as `text-page-title` (a new step: `24/32`). Record titles (task, request) use the same. Phone screens: 22 / 700. Auth and landing keep a hero size (brand pages, outside the app shell). |
| C9 | Section heading 18 | h2 sizes: **14** (most card titles), **17** (home overviews: `text-[calc(17px*…)]` in `ApprovalOverview.tsx:209,244`, `MyWorkOverview.tsx:238,263`, `HomeNotepad.tsx:52`), **16**, **19** (journey `ARSApprovalJourney.tsx:480`), **20** (Admin editors, Calendar, Profile) | as listed | 5 sizes; none is 18 except one | `text-section` = **18 / 600** (`widget-title` 18 already exists: `tailwind.config.ts:71`) for page sections; **14 / 600** stays for a card's own title (`text-card-heading`). |
| C10 | Body 14 | **14** in 85 % of the measured text (paragraphs, cells, list items); **12** for captions | `text-body` / `text-label` (both 14) | none | Keep. Merge `label` and `body` (identical since D-407). |
| C11 | Button 40 | `btn-primary` / `btn-secondary` / `btn-danger` / `btn-danger-quiet` = **46**; `btn-compact` = **36** (44 on touch); `btn-ghost` 36; `tb-btn` **28**; `.pill-select` 32; ad-hoc icon buttons 36 / 44 | `globals.css:349-353` `h-[46px]`, `:357` `h-9`, `:426-436`, `:447`, `:375` `.tb-btn h-7` | Primary **+6 px**; four heights (28 / 36 / 44 / 46) | **Three sizes as tokens:** `--control-h-sm: 32px` (toolbar `tb-btn`, pills), `--control-h-md: 40px` (default: `btn-*`, `btn-compact` merges into md), `--control-h-lg: 48px` (the phone decision bar and public auth forms only). On touch (`pointer: coarse`) every size has `min-height: 44px` (exists for compact: `globals.css:470-477`). |
| C12 | Input 42 | `field-input` **44** (`h-11`); `field-compact` 36; pages override field-input to **32 / 36 / 40** (17 pages; see the defect report); `select:other` **19** (TaskGrid inline selects); `input:other` 22 / 32 / 34 / 38 | `globals.css:336` `h-11`; `:341` `h-9`; the per-page classes | **+2 px**, and seven heights | `--input-h: 40px` (equal to the button, so a field and its button share a row). If the owner wants 42 exactly, make the button 42 too. A field and the button beside it must match. `--input-h-sm: 32px` for toolbars and grids. 44 min on touch (exists). |
| C13 | Card radius 12 | `.card` **12** (`rounded-lg`) on all measured cards at 1440 but one (users area: 331 × 12 px, 1 × 16 px; admin: 187 × 12 px); other bordered boxes **0** (table wrappers, rows), **8**, **12**, **16** (request side panels, task panes, board columns) | `globals.css:360` `.card`; `tailwind.config.ts:79` radii | Matches; 16 px boxes and `rounded-xl` (34 uses) / `rounded-2xl` (8) are off-scale | `--radius-card: 12px`; `--radius-control: 8px` (buttons, inputs); `--radius-modal: 16px`; `--radius-pill: 9999px`. Retire `rounded-2xl` and use `rounded-xl` only for modals. |
| C14 | Modal radius 16 | Measured (probe `overlays` / `pane` / `picker`): search palette **16**, Create task window **16**, task pane in dialog mode **16**; bell panel **12**, + Create menu **12**; side pane 0 (edge-attached) | `CommandPalette.tsx:343` (`rounded-xl`), `TaskCreator.tsx`, `TaskPane.tsx:35`, `NotificationBell.tsx`, `MenuCore.tsx` | Modals already match 16. Popovers use 12. | Keep: `--radius-modal: 16px` (dialogs, the palette, the pane in dialog mode); `--radius-popover: 12px` (menus, popovers, the bell). |
| C15 | Spacing 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 | Tailwind's 4 px scale is used (1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12…). 1.5 (6 px) and 2.5 (10 px) are common. 203 arbitrary `-[Npx]` values in 55 files. | `app/`, `features/` | 6 and 10 px steps; arbitrary values | Restrict to the owner's scale (`gap-1/2/3/4/5/6/8/10/12`). Allow 6 / 10 only inside controls (padding of pills and badges). Add a lint rule (`no-arbitrary-value` for spacing). |
| C16 | Content max-width | (Not in the owner's list.) **1280 px centred** (`max-w-7xl mx-auto`) on every app page. At 1920 the content starts at **462 px** (sidebar 220 + 210 margin + 32 padding). With the rail it starts at 392. | `AppShell.tsx:399` | The content floats in the middle of wide screens. Collapsing the sidebar moves the content left by only 70 px (1920) or 100 px (1440), not 140. | **Decision for the owner:** (a) keep 1280 centred (reading comfort), or (b) left-align at `--page-px` with a max-width of 1440 for data pages (tables, boards, Insights) and 960 for reading and forms (`--content-max-narrow`). Recommended: (b), because the app is data-heavy and the sidebar and content then move together. |

The measured shell is **already consistent across modules** at each viewport. This was measured on every app page, both areas: the same header height, sidebar width, padding and content left edge (SCREEN_LAYOUT_STANDARD §2). The conflicts above are with the **reference values**, not between modules. The cross-module inconsistencies are inside the pages (titles, section headings, controls, tables, overlays). They are listed in [MODULE_UI_CONSISTENCY_REPORT.md](MODULE_UI_CONSISTENCY_REPORT.md).

## 1. Colour (keep)

**Keep the current tokens** (`globals.css:11-131`, dark at `:134-260`). They are the ARS brand set and already pass the contrast script (`scripts/qa/token-contrast.mjs`, D-407: 96 pairs, AA in light and dark).

| Role | Token (CSS var → Tailwind) | Light | Use |
|---|---|---|---|
| Brand / primary | `--color-primary-600` → `primary-600` (text, icons), `--color-primary-solid` → `bg-primary-solid` (fills) | #0053A0 | Links, the primary button, the current item |
| Accent | `--brand-accent` | #0A84FF | Fills, rings, bars (brand sheet) |
| Danger accent | `--color-accent-red` | #ED1C25 | Logo red only |
| Text | `ink` / `ink-muted` / `ink-faint` | #0E1B2C / #44556B / #56677D | |
| Lines | `line` / `line-strong` / `--color-border-input` | #DBE4EE / #C2CFDE / #7889A0 | |
| Surfaces | `page` / `surface` / `surface-muted` / `raised` / `overlay` | #F5F8FB / #FFF / #F1F5FA / #FFF / rgba | |
| Status | `success` / `warning` / `danger` / `info` (`-50` bg, `-600` text, `-solid` fill) | | |
| Data | `--color-chart-1…8`, `--color-identity-1…8` | | Charts, project colours |

**Findings and proposals:**
- **Raw colours:** 165 raw hex values in `.tsx`. They are almost all brand art: `JourneyArt.tsx` (59), `ARSApprovalJourney.tsx` (18), `BrandBackdrops.tsx` (7), `JourneyActivities.tsx` (7), `Loaders.tsx` (4), and `GoogleButton.tsx` (4, Google's brand colours, required). Raw palette classes: `text-white` 27, `bg-white` 9, `border-white` 5 (`PicBot`, `AuthLayout`, journey, `MobileHome`, `MobileTabBar`, brand). **Proposal:** journey and brand art stay as a documented exception. Replace `text-white` / `bg-white` in UI with `text-on-solid` / `bg-surface`; in dark mode `bg-white` stays white.
- **Duplicated dark token block:** the dark values are written twice, under `:root[data-theme="dark"]` (`:134`) and under `@media (prefers-color-scheme: dark) :root:not([data-theme])` (`:191`). **Proposal:** generate both from one list (a PostCSS mixin, or one `@custom-media` block). A token change made in one block and not the other is a likely future defect.
- **`--color-focus`** equals primary (#0053A0). Keep it.

## 2. Typography

| Token (proposed) | Size / line height | Weight | Current equivalent | Use |
|---|---|---|---|---|
| `text-caption` | 12 / 16 | 400-600 | `caption`, `micro` (both 12) | Meta, timestamps, badges |
| `text-body` | 14 / 20 | 400 | `body`, `label` (both 14) | Everything else |
| `text-subhead` | 16 / 22 | 600 | `subhead` | Card titles in large cards, dialog titles |
| `text-section` | **18 / 24** | 600 | `widget-title` (18) | Page section headings (h2) |
| `text-page-title` | **24 / 32** | 600 | (new; today `title` 20) | The page h1 (PageHeader) |
| `text-display` | 32 / 40 | 700 | `display` | Auth and landing only |
| `text-kpi` | 44 / 52 | 700 | `kpi` | KPI figures |

- **Retire:** `card-title` (22), `greeting` (28) and `title` (20), after a migration. Today the measured app uses 16 distinct font sizes: 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 28, 32.
- **Remove arbitrary text sizes:** `text-[10px]` (7), `text-[11px]` (11), `text-[12px]` (10), `text-[13px]` (4), `text-[14px]` (6), `text-[15px]` (8), `text-[16px]` (4), `text-[17px]`, `text-[19px]`, `text-[22px]`, `text-[12.5px]`, and the `text-[calc(17px*var(--text-scale,1))]` headings on Home. The 10 px avatar initials are repeated in 4 hand-made avatars (`RequestListScreen.tsx:219`, `PeoplePicker.tsx:113`, `GridCellEditors.tsx:68`, `ProjectWorkspace.tsx:949`); they belong in `Avatar`.
- **Font:** Inter (`next/font`), keep. Numbers: `tabular-nums` in tables (today only in the Classic view, `globals.css:598`). Proposal: on `.data-table` and KPIs everywhere.
- **`--text-scale`:** the Classic text size (D-211). Keep the multiplier on every token. Arbitrary `text-[Npx]` values ignore it (they are a text-scale defect in the Classic view).

## 3. Spacing and grid

- Scale (the owner's): **4, 8, 12, 16, 20, 24, 32, 40, 48** → Tailwind `1, 2, 3, 4, 5, 6, 8, 10, 12`.
- Page: `--page-px` 24 (16 below 640), `--page-pt` 24 (16 on phones), `--section-gap` 24, card padding 16 (compact 12, roomy 20), field gap 16, inline gap 8.
- Grid: 12 columns, gap 24 desktop / 16 tablet / 12 phone. Use `minmax(0,1fr)` columns (the existing `.grid > * { min-width:0 }` rule, `globals.css:563`, stays).

## 4. Radius, borders, shadows

| Token | Value | Current |
|---|---|---|
| `--radius-control` | 8 | `rounded-md` (buttons, inputs) ✓ |
| `--radius-card` | 12 | `rounded-lg` ✓ |
| `--radius-popover` | 12 | mixed 8 / 12 |
| `--radius-modal` | 16 | `rounded-xl` (Dialog) |
| `--radius-pill` | 9999 | `rounded-full` ✓ |
| Border | 1 px `line`; inputs `--color-border-input` | ✓ |
| `--shadow-card` | `0 8px 24px rgba(15,23,42,.08)` | **Only 7 files use `shadow-card`.** `.card` uses `shadow-sm` (Tailwind default, not a token). |
| `--shadow-overlay` | `0 20px 48px …` | Overlays |
| `--shadow-button` | primary button | |

Proposal: `.card` → `shadow-card` or none, the owner to pick one. Today cards carry Tailwind's `shadow-sm`, while `shadow-card` is a heavier token used by 7 files. So two card elevations are in use.

## 5. Controls

| Control | Height | Padding-x | Radius | Text | Touch |
|---|---|---|---|---|---|
| Button md (primary, secondary, danger, danger-quiet) | **40** (today 46) | 16 | 8 | 14 / 600 | min 44 |
| Button sm (toolbar, row actions; `btn-compact`) | **32** (today 36) | 12 | 8 | 14 / 500 | min 44 |
| Button lg (phone decision bar, auth) | 48 | 20 | 8 | 16 / 600 | |
| Toolbar button `tb-btn` | **32** (today 28) | 8 | 8 | 14 | min 44 |
| Icon button | 40 (sm 32) | n/a | 8 | n/a | min 44 |
| Input / select md | **40** (owner 42; today 44) | 12 | 8 | 14 | min 44 |
| Input sm (`field-compact`) | 32 (today 36) | 10 | 8 | 14 | min 44 |
| Checkbox / radio | 16 box, 24 hit area | | 4 | | 44 row |
| Switch | 20 × 36 | | pill | | 44 row |

- **Full-width buttons:** `btn-primary` / `btn-secondary` are `w-full` by default (`globals.css:349,352`). Every inline use must add `w-auto` or `btn-compact`; 502 `btn-compact` uses are largely there to undo this. **Proposal:** make `w-auto` the default and add `btn-block` for full-width.
- **One focus ring:** `outline 2px var(--color-focus)`, offset 2 (`globals.css:314`). Inputs use a 3 px ring + border instead (`globals.css:336`). Keep both, documented.

## 6. Tables

- `.data-table` (header 12 / 600 muted, cells 14, padding `px-4 py-3`, row hover) is the standard (`globals.css:369-412`).
- The density tokens `--row-h` 36 / `--row-h-compact` 30 / `--header-row-h` 34 are used by TaskGrid only.
- **Proposal:** one `DataTable` with:
  - density (comfortable 48 px rows, compact 36);
  - a sticky header;
  - sort (`aria-sort`);
  - pagination;
  - an empty row → `EmptyState`.

  Measured differences between today's tables are in the defect report (table probe).

## 7. Motion

See [GLOBAL_MOTION_AUDIT.md](GLOBAL_MOTION_AUDIT.md). In short, the owner's new brief (24 Nov 2026) sets:
- durations: instant 100 / fast 150 / standard 200 / smooth 250 / emphasis 300 ms;
- easing: standard `(0.2,0,0,1)` / enter `(0,0,0.2,1)` / exit `(0.4,0,1,1)`.

This **supersedes D-417's v1.87 values** (100/150/220/280/350/450; `(0.22,1,0.36,1)` / `(0.16,1,0.3,1)`), so it needs a new decision number. Every place that would change is listed there.

## 8. Z-index (keep, one fix)

| Token | Value | Use |
|---|---|---|
| `--z-header` | 30 | The sticky top bar |
| `--z-sticky` | 35 | Sticky table headers, the pane in side mode |
| `--z-drawer` | 40 | Drawers, MobileNav, the pane in dialog mode |
| `--z-popover` | **50** | Menus, popovers, pickers |
| `--z-dialog` | 60 | Non-native modals |
| `--z-toast` | 70 | |
| `--z-palette` | 80 | |
| `--z-splash` | 90 | |

`--z-popover` (50) sits **below** `--z-dialog` (60). A popover opened from a non-native modal layer (`role=dialog` div at z-dialog) would sit under it. It works today only because the real modals are native `<dialog>` elements in the top layer. **Proposal:** popovers inside overlays render in the overlay's own layer (portal into the top modal, as `Toast` does with `useTopModal`), or `--z-popover` moves above `--z-dialog`. Not observed as a defect in the probes (P4, preventive).

## 9. Decisions needed from the owner

| Q | Question | Recommendation |
|---|---|---|
| Q-UI-1 | Adopt the reference dimensions: header 64, sidebar 250 / rail 72, padding 24, title 24, section 18, button 40, input 42 (or 40), card 12, modal 16? | Yes, as tokens. Input = button height (40 / 40 or 42 / 42). |
| Q-UI-2 | Content width: keep 1280 centred, or left-aligned with 1440 (data) / 960 (forms) max? | Left-aligned (C16). |
| Q-UI-3 | The Classic view (D-210 / D-227, a Tally-style second UI with ~40 override rules) against "one global UI": keep it, freeze it, or retire it? | Freeze. No new Classic overrides. Phase 2 applies the tokens to both views; Classic keeps only its layout differences (no sidebar, menus). |
| Q-UI-4 | The users phone layout (v1.43.0) has its own header (56 px), tab bar and screen titles (22 / 800). Keep it as the mobile variant of the one shell? | Yes. Align its tokens (title 22 / 700, padding 16, header token). |
| Q-UI-5 | Motion values: the 24 Nov brief replaces v1.87's (D-417, the day before). Confirm the new set? | Yes, with page transitions ON after the probes pass (motion audit §4). |
| Q-UI-6 | Tablet (768-1023): sidebar expanded today (220 of 768 px). Collapse by default below 1024? | Yes, rail by default below 1024 (content gains 140 px). |

## 10. Content: dates, times and wording (v1.89.0, D-425)

**One formatter: `lib/format/date.ts`.** India time (Asia/Kolkata, UTC+5:30, no daylight saving), written out by hand, so the server, every browser and every email print the same characters (Intl / `toLocale*` differ between Node's ICU and the browsers': "pm" / "PM", a narrow no-break space, "Sept"; a server-rendered text the browser then writes differently is React #418). ESLint `ars-ui/date-format` blocks `toLocaleDateString`, `toLocaleTimeString`, `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat` and `toLocaleString` on a date in `app/`, `features/`, `components/` and `server/` (a number's `toLocaleString("en-IN")` stays allowed: figures, not dates).

| Form | Text | Function |
|---|---|---|
| Date | 24 Nov 2026 (day without a leading zero) | `formatDate(at)` |
| Short date (this year) | 24 Nov; another year: 24 Nov 2027 | `formatDate(at, { year: "auto" })` |
| With weekday | Tue, 24 Nov 2026 / Tuesday, 24 November | `formatDate(at, { weekday: "short" })` |
| Time | 3:05 pm (12 h, lower-case am / pm) | `formatTime(at)`; a stored "15:05": `formatClock` |
| Date and time | 24 Nov 2026, 3:05 pm | `formatDateTime(at)` |
| Meeting time | Tue, 24 Nov 2026, 11:00 am to 12:30 pm; over midnight: … 11:30 pm to 25 Nov, 12:30 am | `formatTimeRange(start, end)` |
| Day range (pickers, task dates) | 30 Nov – 4 Dec, 7 – 11 Dec, 28 Dec 2026 – 5 Jan 2027 | `formatDayRange(start, due, today)` |
| Period (filters, emails) | 1 Dec to 12 Dec 2026 | `formatPeriod(from, to)` |
| Month | Nov 2026 / November 2026; chart axes only: Nov 26 | `formatMonth(at)` |
| Relative moment | just now · 5 min ago · 2 h ago · Yesterday · 3 days ago · then the short date; future: in 5 min · in 2 h · Tomorrow · in 3 days | `formatRelative(at, now)` |
| Relative day | Today · Tomorrow · Yesterday · Friday (within the coming week) · 24 Nov | `formatRelativeDay(day, today)` |
| Day and time | Today at 2:27 pm · Yesterday at 3:41 pm · 28 Oct at 9:05 am | `formatDayTime(at, now)` |
| Machine forms | yyyy-mm-dd (India day), HH:MM | `indiaDay`, `indiaClock`; inputs, addresses, file names, stored data |

**Relative times on a page:** `<RelativeTime at kind>` (`features/ui/RelativeTime.tsx`). The server and the first paint show the absolute text (identical everywhere); after mount the browser draws the relative text in the same grid cell and refreshes it every minute (the box keeps the wider of the two: no layout shift). The absolute text is the tooltip; `<time datetime>` carries the ISO moment. A server component may print relative text for its own render (no hydration), but text computed from "now" inside a client component must use `<RelativeTime>`.

**Exports keep their own format.** Report files (CSV / Excel / PDF, `server/reports/export.ts`) keep their cell text as before; date-only cells are yyyy-mm-dd. The Admin Records download writes the same display text as the screen (now 12 h). Stored data is unchanged everywhere.

**Date entry:** the shared `DateRangePicker` (one button with the app's day format, a Monday-first grid, keyboard, the phone bottom sheet; type dd-mm-yyyy or yyyy-mm-dd). `DateRangeField` is its labelled From – To form for GET filters (hidden inputs keep the field names). Native `type="date"` stays only where a form needs a single day inside a module form that batch 5 did not cover (listed in UI_REFACTORING_LOG stage 3e).

**Wording:**
- A page that creates a record is titled like the list action that opens it: **New request, New task, New information, New meeting, New ticket, New project, New portfolio, New user**. The sidebar, the search palette and the breadcrumb use the same words. The submit button keeps the verb of what it does (Submit request, Create task, Schedule meeting, Raise ticket, Create user, Publish).
- `+ Create` menu items are the record kind (Task, Project, Meeting, Ticket …) with a hint that describes it, not a second title.
- Sentence case for titles, labels and buttons; proper names keep their capitals (Task Summary, Out of office, Pico Bot, Google Calendar). The owner's names are not renamed: Approvals, Information, Tickets, Meetings, Task Summary, Out of office, My sections.
- Record numbers: "<Kind> no." in tables (Request no., Task no., Ticket no., Meeting no.), shown with `RecordNo`.
- Filter chips read the app's day format ("Raised 1 Nov to 10 Nov 2026"), never yyyy-mm-dd.
