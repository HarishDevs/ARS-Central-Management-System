# UI/UX defect report: full register (UI/UX QA, phase 1)

**Date:** 24 Nov 2026. **Build:** v1.88.0 (`893fb4b`). **Status:** audit only (no fixes). The retest column is empty until phase 3.

**Method and coverage** ([QA_TEST_PLAN.md](QA_TEST_PLAN.md)):
- **Chromium:** 1,723 page visits (177 role × route pairs × 9 viewports, plus 130 collapsed-sidebar visits).
- **Edge (`msedge`) and WebKit:** 531 visits each (1440 / 768 / 390).
- **axe:** 354 runs (1440 and 390, every route).
- **Probes:** in `audit/ui-qa/probes/*.json`.
- **Screenshots:** 2,785, in `audit/ui-qa/shots/<browser>/<viewport>/<role>__<route>.jpg`. They are git-ignored.
- **Firefox:** **BLOCKED** (§F).

**Rules applied:**
- Intended behaviour is not reported. The checks covered: DEVELOPMENT-MEMORY decisions; `HEADER-AND-MOTION-AUDIT.md` "Expected design rules" (phone Home without the overview header, sidebar hidden below md, search icon below sm, area differences, closed menus in the DOM); D-407 / D-417; the phone layout (v1.43.0); the Classic view (D-210 / D-227).
- **Confirmed** = reproduced by measurement or a probe, with evidence. **Suspected** = seen once, or the cause is inferred. Suspected items are marked.
- Differences from the owner's reference dimensions are **conflicts**, listed in [GLOBAL_DESIGN_SYSTEM.md §0](GLOBAL_DESIGN_SYSTEM.md) (C1-C16). They are not counted as defects (QA_TEST_PLAN §5).
- **Common columns:** Browser = Chromium unless stated. Role = the seeded person (QA_TEST_PLAN §1). "Steps" are short; the probe or sweep name reproduces them.

## A. Summary

### Totals (confirmed + suspected)

| Severity | Confirmed | Suspected | Total |
|---|---|---|---|
| P0 Critical | 0 | 0 | **0** |
| P1 High | 1 | 0 | **1** |
| P2 Medium | 9 | 0 | **9** |
| P3 Low | 24 | 3 | **27** |
| P4 Cosmetic | 6 | 1 | **7** |
| **Total** | **40** | **4** | **44** |

Duplicates are counted once: CON-14 = RESP-01, RESP-08 = LAY-02, RESP-09 = PERF-02. ERR-03 (test-environment log noise) and BRW-01 (Firefox BLOCKED) are not defects.

### By category

| Category | Count | IDs |
|---|---|---|
| Layout / alignment | 3 | LAY-01 (P1), LAY-02, LAY-03 |
| Visual consistency between modules | 16 | CON-01, 02, 03, 04, 05, 06, 07, 09, 10, 11, 12, 13, 15, 17, 18; TBL-01 |
| Responsive | 7 | RESP-01 to RESP-07 |
| Accessibility | 4 | A11Y-01 to A11Y-04 |
| Performance (CLS) | 2 | PERF-01, PERF-02 |
| Motion | 5 | MOT-01 to MOT-05 |
| Errors / console | 2 | ERR-01, ERR-02 |
| Forms | 2 | FORM-01, FORM-02 |
| Content / readability | 2 | CON-08 (dates), CON-16 (not-found wording) |
| Overlays | 1 | OVL-01 |
| **Total** | **44** | |

### What is clean (measured, not defects)

- **0** page-level horizontal overflow at all 9 viewports in Chromium, Edge and WebKit. The single exception is the long-title case (LAY-01).
- **0** elements outside the viewport.
- **0** failed requests.
- **0** status ≥ 400.
- **0** axe violations in the final run (354 runs, wcag2a / 2aa / 21aa / 22aa). One intermittent contrast hit is listed as A11Y-04.
- Shell geometry identical across modules at each viewport.
- Every overlay probed opens inside the viewport at 360-1440, is top-most, and closes with Escape. Focus returns to the opener.
- The task pane, date picker inside a dialog and file upload work in Chromium, Edge and WebKit.
- Keyboard: the skip link is the first Tab stop, and all 180 Tab stops sampled (6 pages × 30) show a visible focus ring, none off-screen.
- Forms (Create task): double-click creates exactly one task, whitespace is refused, input is trimmed, markup and emoji are stored and shown as text, the unsaved draft guard works.
- Offline submit: a message is shown, the input is kept, nothing is saved.
- Reflow at 200 % and 80 %: no overflow.
- The same request shows the same number and status words in 8 places (detail, list, search, home, queue, notifications, Admin records). The time format differs, see CON-08.

## B. Register

### B1. Layout

| ID | Sev | Status | Module / page / route | Role · viewport · browser | Category | Steps | Expected | Actual (evidence) | Root cause (file:line) | Suggested fix |
|---|---|---|---|---|---|---|---|---|---|---|
| UIQA-LAY-01 | **P1** | Confirmed (task page). Every PageHeader title is suspected to behave the same. | Tasks · task detail · `/users/tasks/<id>` | USER · 1440 (desktop widths) · Chromium | Layout / overflow | Open a task whose title is one long unbroken string: a pasted reference, URL or code. Set-up: 190 characters. | The title wraps inside the content column. No page scroll. | **The page scrolls sideways by 1,809 px.** The h1 box is 2,997 px wide (probe `longtext`, `chromium-keyboard+longtext+reflow.json`). Phones are fine (the phone header wraps). The same task in the pane (`?task=`) is fine. | `features/shell/PageHeader.tsx:16-19`: the h1 sits in `flex items-center gap-1.5` with no `min-w-0`, so a flex item's `min-width:auto` is the whole word. `styles/globals.css:836-838` uses `overflow-wrap: break-word`, which does not lower min-content. Used by `TaskDetail.tsx:300` and 94 pages. | In `PageHeader`: `min-w-0` on the title row and `[overflow-wrap:anywhere]` on the h1. Globally: `main { overflow-wrap: anywhere }`. Add a long-title case to the sweep for every record type. | **Fixed v1.89.0 (D-421, batch 0):** PageHeader min-w-0 path + wrapping title row + `overflow-wrap:anywhere`; `main { overflow-wrap: anywhere }` (tables keep break-word). e2e v1890-ui-shell: task, meeting, ticket, request with a 163-character unbroken title at 1440 / 1280 / 1024: overflow 0. |
| UIQA-LAY-02 | P3 | Confirmed | Public · Privacy, Terms | public · all · Chromium | Layout (shell) | Open `/privacy` | Header 64 (`--header-h`) | Header **68-69 px**, with its own markup. The content box is 896 px centred (sweep). | Public layout header (`app/(public)/privacy`, `terms` page header) | Use the shell header token. | **Fixed v1.89.0 (D-421):** public header `h-topbar` (64) + `px-page`; text `max-w-reading`. |
| UIQA-LAY-03 | P3 | Confirmed | All app areas · unknown addresses | all · 1440 · Chromium | Layout (state pages) | Open `/users/not-a-page`, `/admin/not-a-page`, `/superadmin/not-a-page` | A not-found page inside the area's shell (as for a missing record id) | Missing record ids keep the shell (header, sidebar). **Unknown addresses render the root 404 with no shell** (`shellHeader:false`, `sidebar:false`) and a large "404" (probe `states`). | `middleware.ts` / the root `app/not-found.tsx` answer unknown `/users` paths (D-413 `users-routes`), not `app/users/not-found.tsx` | One `StatePage` inside the shell. Route the unknown area addresses to the area's not-found. Coordinate with NAVIGATION-AUDIT (separate). |

### B2. Visual consistency between modules

The details and screenshots are in [MODULE_UI_CONSISTENCY_REPORT.md](MODULE_UI_CONSISTENCY_REPORT.md) §3. The register entries:

| ID | Sev | Status | Where | Actual (evidence) | Root cause | Suggested fix |
|---|---|---|---|---|---|---|
| UIQA-CON-01 | **P2** | Confirmed | All list pages, 1440 | Seven list header and toolbar patterns (Requests, Tasks, Information, Meetings, Tickets, Projects, Admin Records / audit log) | Per-module toolbars: `ListToolbar`, PowerSearch, ad-hoc pills, Projects' own search (`app/users/work/projects/page.tsx:63`) | One `ListPage` pattern (MODULE report §5.1) |
| UIQA-CON-02 | P3 | Confirmed | Home, Meetings, Approvals, Admin, Calendar, Profile | h2 at 14 / 16 / 17 / 18 / 19 / 20 px | `ApprovalOverview.tsx:209,244`, `MyWorkOverview.tsx:238,263`, `HomeNotepad.tsx:52` (`text-[calc(17px*…)]`); `ARSApprovalJourney.tsx:480` (17 / 19); the Admin type editors (20) | `text-section` (18) token |
| UIQA-CON-03 | P3 | Confirmed | Projects · `/users/work/projects/new` | h1 32 px (all other pages 20) | `features/work/NewProjectWizard.tsx:73` (`text-display`) | PageHeader |
| UIQA-CON-04 | **P2** | Confirmed | AI · `/users/ai/*` → `/users/ai/assistant` | No visible page title, no PageHeader, no breadcrumb; the h1 is sr-only (14 / 400) | `app/users/ai/assistant/page.tsx:55` | A visible PageHeader "AI Assistant" |
| UIQA-CON-05 | **P2** | Confirmed | 17 pages measured; 48 files override | `field-input` renders at 28 / 32 / 36 / 40 / 44 | `field-input h-8` / `h-9` in 48 files, e.g. `app/users/work/projects/page.tsx:63`, `app/users/tickets/board/page.tsx:124`, `features/analytics/ReportForms.tsx:28-328` (17 times), `features/admin/TaskHolidayForms.tsx:93-279`, `features/home/HomeClient.tsx:64-86` | Use `field-compact` (32) or `field-input` (40) only; lint against `h-*` beside `field-input` | **Token in (v1.89.0, D-421):** `field-input` 42, `field-compact` 32; the page `h-*` overrides (48 files): batch 2. |
| UIQA-CON-06 | **P2** | Confirmed | All | `btn-compact` at 32 / 36 / 40 / 44 / 46 on desktop; primary 46 beside compact 36; toolbar 28 | `btn-compact h-11` / `h-10` / `h-8` in 19 files (e.g. `app/admin/insights/workload/reassign/page.tsx:58`, `app/superadmin/monitoring/audit/page.tsx:113`, `features/admin/CalendarForms.tsx:49,67`); `globals.css:349-357` | Size tokens sm / md / lg (GLOBAL_DESIGN_SYSTEM §5) | **Token in (v1.89.0, D-421):** `btn-*` 40, `btn-compact` / `btn-ghost` / `tb-btn` 32, `btn-lg` 48; size modifiers after the variants; the page `h-*` overrides (19 files): batch 2. |
| UIQA-CON-07 | P3 | Confirmed | List pages | "New request" / "New task" / "New information" / "Schedule a meeting" / "Raise a ticket" / "+ Create project" / "Add user" | Page copy | One verb pattern ("New …"), the icon instead of "+" in the text |
| UIQA-CON-09 | P4 | Confirmed | Approvals, Tasks, Projects | Bordered boxes at 16 px radius beside cards at 12 | `rounded-xl` (34 uses) | `--radius-card` |
| UIQA-CON-10 | P4 | Confirmed | Tickets, Meetings vs Requests, Tasks | Record numbers monospace links in two modules, plain text in two | Per-list cells | One `RecordNo` cell |
| UIQA-CON-11 | P3 | Confirmed | Detail pages | "← Back to …" on the request and admin user pages only | `app/users/requests/[id]/page.tsx`, `app/admin/users/[id]` | One placement or none (SCREEN_LAYOUT_STANDARD §4) |
| UIQA-CON-12 | P4 | Confirmed | Detail pages | Status badges placed differently | Per page | A PageHeader `badge` slot |
| UIQA-CON-13 | P3 | Confirmed | Calendar entry, Meeting points | Full-width primary buttons in some forms | `globals.css:349` (`btn-primary` is `w-full`); 30 `btn-primary` uses without `w-auto` / `btn-compact` | `w-auto` default, `btn-block` opt-in | **Not yet:** the size tokens are in (button md 40, `btn-lg` 48); `w-auto` by default goes with the batch 2 control sweep. |
| UIQA-CON-14 | **P2** | Confirmed | = RESP-01 | (phone tables) | | |
| UIQA-CON-15 | P4 | Confirmed | Home | Overview header margin 20 vs 24 | `features/home/OverviewParts.tsx` | PageHeader slots |
| UIQA-CON-17 | P4 | Confirmed | Approvals, Projects, pickers | Two Avatar components plus 4 hand-made initials circles at 10 px | `features/ui/Avatar.tsx`, `features/ui/Display.tsx:29,43`, `RequestListScreen.tsx:219`, `PeoplePicker.tsx:113`, `GridCellEditors.tsx:68`, `ProjectWorkspace.tsx:949` | `Avatar` only |
| UIQA-CON-18 | P3 | Confirmed | Overlays | Palette radius 16 / z 80 / slide-down 150 ms; bell 12 / z 50 / menu-in 150 ms; + Create 12 / menu-in with the **standard** easing (the bell uses **enter**); the Create task window 16 / z 40 / **no motion** / not `aria-modal`; the pane in dialog mode 16 / scale 220 ms; the side pane 0 / slide 280 ms (probe `overlays`, `pane`, `picker`) | Separate overlay implementations (GLOBAL_COMPONENT_INVENTORY §4) | `Dialog` / `Popover` variants with the token set | **Motion part fixed v1.89.0 (D-420):** one easing for every dropdown; the Create task window animates. Radius / z / aria-modal parts: stage 3 (UI unification). |
| UIQA-TBL-01 | P3 | Confirmed | Admin → Records (requests, tasks, information, tickets, meetings) | Tables don't use `.data-table`: header 14 / 500 vs 12 / 600 in other lists. Row heights in the probed lists: 33, 53, 61, 65, 85 and 125 px. | `features/ui/RecordTable.tsx:73-81` | One `DataTable` (density tokens) |

### B3. Responsive

See [RESPONSIVE_TEST_REPORT.md §3](RESPONSIVE_TEST_REPORT.md).

| ID | Sev | Status | Summary | Root cause | Fix |
|---|---|---|---|---|---|
| UIQA-RESP-01 | **P2** | Confirmed | Lists in Tasks, Meetings, Tickets, Admin and Super Admin keep a squeezed table at 360-430 | Phone cards exist only for Requests and Information (`features/mobile/ApprovalCard.tsx`, `MobileInfoList.tsx`) | DataTable `cards` mode below 768 |
| UIQA-RESP-02 | P3 | Confirmed | 768 tablet: sidebar expanded (220 of 768) | `SidebarFrame.tsx` initial state from the cookie only | Rail by default below 1024 | **Fixed v1.89.0 (D-421):** 768-1279 starts on the 72 rail with no saved choice (`ars_vw`); ☰ choice wins. |
| UIQA-RESP-03 | P3 | Confirmed | Two phone shells (users 56 / 12 / 16 vs panels 64 / 16 / 24) | `AppShell.tsx:292-299`, `:319`, `:398-399` | `--header-h-mobile`, `--page-px`, `--page-pt` tokens in both | **Fixed v1.89.0 (D-421):** phone tokens in every area: header 56, padding 16, top 16. |
| UIQA-RESP-04 | P3 | Confirmed | Phone titles in 4 styles: 20 / 600, 22 / 800, 28 / 600, none | `globals.css:938` (`.mob-screen-title`, used by `features/mobile/BottomSheet.tsx:169`); `TaskDetail.tsx:223`; `MobileHome` (no h1) | Phone title token 22 / 700 in PageHeader |
| UIQA-RESP-05 | P3 | Confirmed | On touch devices: `tb-btn` 28 px (42 pages), TaskGrid inline selects 19 px, grid inputs 22 px, `pill-select` 32 px, round task checks 20 px. Under the app's own 44 px touch rule; AA target-size passes. | `globals.css:375` (`.tb-btn h-7`), `:470-477` (the touch rule covers only `btn-compact` and `field-input`); `TaskGrid` cell editors | Extend `@media (pointer: coarse)` to `tb-btn`, `pill-select`, grid editors and checks (44 hit area) | **Part fixed v1.89.0 (D-421):** the touch rule covers every named control class (btn-*, tb-btn, tb-split, pill-select, field-input). TaskGrid editors and round checks: batch 2. |
| UIQA-RESP-06 | P3 | **Suspected** | The Pico Bot launcher passes over list rows and links mid-scroll at 390 | `.picbot-launcher` (`globals.css:962-969`) | Hide it on scroll down, or keep a clear column |
| UIQA-RESP-07 | P3 | Confirmed | At 1920 the content starts at 462 px (centred 1280) | `AppShell.tsx:399` (`mx-auto max-w-7xl`) | Owner decision C16 / Q-UI-2 | **Fixed v1.89.0 (D-421, owner: left-aligned, ~1600):** content starts at 274 at 1920 (rail 96), max 1600. |
| UIQA-RESP-08 | P4 | Confirmed | = LAY-02 (public header 68 / 69) | | | **Fixed with LAY-02.** |
| UIQA-RESP-09 | P2 | Confirmed | = PERF-02 | | |

### B4. Accessibility

See [ACCESSIBILITY_TEST_REPORT.md](ACCESSIBILITY_TEST_REPORT.md).

| ID | Sev | Status | Where | Actual (evidence) | WCAG | Root cause | Fix |
|---|---|---|---|---|---|---|---|
| UIQA-A11Y-01 | **P2** | Confirmed | Tasks · `/users/tasks/<id>` at 320 CSS px (1280 at 400 %) | The page scrolls sideways by 20 px. Offender: `button.inline-flex.min-w-0.items-center.gap-2` (right edge 340) in the phone task header (probe `reflow`). The 11 other pages pass at 320; all 12 pass at 640 and 1600. | 1.4.10 Reflow (AA) | `features/work/TaskDetail.tsx` (mobile header, lines 205-216: the action button row) | Let the row wrap (`flex-wrap`), `min-w-0` / `shrink` on the button | **Fixed v1.89.0 (D-421):** the real offender was the field row's Assignee button (inline-flex, no max width; `max-w-full`); phone bar slot `min-w-0`. e2e v1890-ui-shell at 320: overflow 0. |
| UIQA-A11Y-02 | P3 | Confirmed | Phone Home and the overviews (`/users`, `?home=tasks`, `?home=meetings`, `/users/work`) | No h1 (sweep at 360-430). The AI assistant and phone More have an sr-only h1 only. | 1.3.1 / 2.4.6 (best practice: one h1); also leaves PageTransitions with no focus target | `features/mobile/MobileHome.tsx` | A visible or sr-only h1 ("Home") on every page |
| UIQA-A11Y-03 | P3 | Confirmed | Reduced motion | JS smooth scroll ignores `prefers-reduced-motion` | 2.3.3 (AAA) / the app's own rule (UX standards §10) | `features/ui/Field.tsx:177`, `features/requests/ReadinessPanel.tsx:85` | `behavior: reduce ? "auto" : "smooth"` | **Fixed v1.89.0 (D-420):** scrollBehavior(); unit guard. |
| UIQA-A11Y-04 | P3 | **Suspected** (once in 2 runs) | Task Summary with an open pane (`/users/work/my-tasks?task=<id>`), 1440 | axe `color-contrast` (serious), 1 node: the due date text in the active (`bg-row-active`) grid row (first sweep). Not found in the re-run. | 1.4.3 (AA) | TaskGrid due cell colour on `--color-row-active` (overdue red on the active row) | Check the overdue / due-soon text tokens on `row-active` with `scripts/qa/token-contrast.mjs` |

### B5. Performance (layout shift)

*v1.89.0 stage 2 (D-420): rows of B4-B6 that were fixed carry their fix status in an extra last cell.*

| ID | Sev | Status | Page | Actual (evidence) | Root cause | Fix |
|---|---|---|---|---|---|---|
| UIQA-PERF-01 | **P2** | Confirmed (2 sweeps + the `cls` probe) | Analytics · `/users/analytics` (USER), `/admin/insights/analytics` (IT admin) | **CLS 0.25-0.55** at 1280 / 1366 / 1920 ("poor" > 0.25); 0.02 at 1440. A block moves 70 px and a grid row (`mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2`) is removed and reinserted about 400 ms later, which is a visible **flicker** (`audit/ui-qa/probes/chromium-cls.json`). | `features/analytics/CenterScreen.tsx:336-352` (the chart section resizes after hydration), rows at `:349`, `:408`, `:468`, `:620`. The exact trigger is **suspected** (client measurement of the chart / BarList). | Reserve the chart height (aspect box). Render the rows on the server without re-keying. Add the page to `v1800-cls.spec.ts`. | **Fixed v1.89.0 (D-420):** CLS 0.000-0.021 (Chromium, 1280 / 1366 / 1920, both pages): page bar below the sections; hidden grid sections really hidden; no re-render when the packing is unchanged. |
| UIQA-PERF-02 | **P2** | Confirmed | Task Summary with a task open · `/users/work/my-tasks?task=<id>` | **CLS 0.36-0.38** at 1280 / 1366; 0 at 1440 / 1920. `[my-grid]`, `[task-cards]` and the list header move down 44 px when the side pane mounts. | The pane is drawn on the client (`TaskPaneHost` / `@pane`); the list narrows by 440 px and its header wraps to a second line (`features/work/MyTasks.tsx` header row). Suspected detail: the wrap point. | Reserve the pane width on the server when `?task=` is in the address, or keep the header on one line (`.reserve-*` pattern of D-407) | **Not reproduced v1.89.0:** CLS 0 at 1280 / 1366 / 1440 (staff and manager, test database); e2e guard added (v1890-motion). |

### B6. Motion

See [GLOBAL_MOTION_AUDIT.md](GLOBAL_MOTION_AUDIT.md) and [GLOBAL_TRANSITION_INVENTORY.md](GLOBAL_TRANSITION_INVENTORY.md).

| ID | Sev | Status | Actual (evidence) | Root cause | Fix |
|---|---|---|---|---|---|
| UIQA-MOT-01 | P3 | Confirmed (Chromium, Edge) | With page transitions **ON**, every skipped transition (rapid clicks; pages over 300 ms) throws an uncaught "Transition was skipped" (2 per run; probe `transitions`). Navigation itself is correct: the last click wins, back / forward land right, CLS 0.0001. | `features/shell/PageTransitions.tsx:71-73`: `transition.ready` is never handled (only `updateCallbackDone` and `finished` are) | `void transition.ready.catch(() => undefined)` | **Fixed v1.89.0 (D-420):** ready / updateCallbackDone / finished handled; e2e asserts no page errors in Chromium, Firefox, WebKit. |
| UIQA-MOT-02 | P2 | Confirmed (WebKit 3 / 3 runs) | WebKit **page crash** with page transitions ON during sidebar navigation (probe `transitions`, `webkit-*.json`). Chromium and Edge are fine. Playwright's WebKit on Windows is a stand-in for Safari; **real Safari is unverified**. | View Transitions in WebKit together with the app's transition code (exact cause unknown) | Verify on real Safari before switching the transitions on. Until then, keep the switch OFF, or skip in WebKit | **Fixed v1.89.0 (D-420):** root cause: the update callback held the old picture up to 4 s after a skip; it now ends at 300 ms. Real Safari still unverified (Playwright WebKit only). |
| UIQA-MOT-03 | P3 | Confirmed | The sidebar collapse animates `width` (150 ms). `main` is laid out again every frame (8 intermediate widths sampled). Layout-shift entries 0.09-0.13 per toggle (excluded from CLS as user input). The labels slide afterwards (sequential, not together). | `SidebarFrame.tsx:84`; `globals.css:2003-2024` | Transform-based rail (gap 3); labels opacity only | **Fixed v1.89.0 (D-420):** no width animation; labels fade in at once. |
| UIQA-MOT-04 | P3 | Confirmed | 11 width / height / top / left animations (inventory: OnboardingTour, MobileTabBar, the journey, progress bars) | Listed in the inventory §"Width/height" | transform: `scaleX` / `translate` | **Fixed v1.89.0 (D-420):** all 11 moved to transform; unit guard. |
| UIQA-MOT-05 | P4 | Confirmed | Landing → sign-in navigates 20 ms before its 220 ms exit ends | `features/public/LandingWelcome.tsx:19` (`LEAVE_MS=200`) vs `globals.css:544` | Read `MOTION_DURATION` | **Fixed v1.89.0 (D-420):** LEAVE_MS = MOTION_DURATION.standard = .auth-leave. |

### B7. Errors in the console

| ID | Sev | Status | Where | Actual | Root cause | Fix |
|---|---|---|---|---|---|---|
| UIQA-ERR-01 | P3 | Confirmed, intermittent (4 of about 2,250 Chromium / Edge visits, all at 1440) | `/superadmin/connections/whatsapp/templates/<code>`, `/superadmin/data/danger-zone/requests` (Chromium); `/users?home=meetings`, `/superadmin/security/sign-in-history` (Edge) | React error **#418** (hydration text mismatch) as an uncaught page error. A different page each run. | **Suspected:** time-dependent server text (relative times / "now") rendered differently on the client; 224 ad-hoc date formatters (CON-08) | One date formatter with `suppressHydrationWarning` on relative times, or relative times rendered on the client only |
| UIQA-ERR-02 | P3 | Confirmed (WebKit, 3 / 3 viewports) | Profile → App & devices `/users/profile/devices` | React #418 in WebKit only | **Suspected:** `features/pwa/AppDevicesPanel.tsx` renders browser capability (install, push support) during the first render | Read capabilities in an effect |
| UIQA-ERR-03 | P4 | Confirmed (the sweep's set-up) | Server log | Every request event logs `notify: email failed … Resend API key is not configured` | Test environment (no provider) | Not a product defect; listed so the log noise is known. **Not counted.** |

### B8. Forms

| ID | Sev | Status | Where | Actual (probe `forms`) | Fix |
|---|---|---|---|---|---|
| UIQA-FORM-01 | P3 | Confirmed | Create task (dialog) | With an empty name, **Create task is disabled** with no message; only the `*` marks the field. People don't learn why (the pattern differs from Out of office, which shows a message). | Keep Create enabled and show "Enter a task name" under the field (`aria-invalid`), as `useActionForm` does elsewhere |
| UIQA-FORM-02 | P4 | **Suspected** | Out of office `/users/delegation` | Empty submit shows "Choose a delegate." as `role=alert`, but no field is `aria-invalid` (0). Placement relative to the field was not measured. | `FieldError` + `aria-invalid` on the delegate picker |

### B9. Overlays and browsers

| ID | Sev | Status | Where | Actual | Fix |
|---|---|---|---|---|---|
| UIQA-OVL-01 | P3 | **Suspected** (WebKit: 3 of 12 Escape closes failed over 3 runs; Chromium and Edge 8 / 8 passed) | Task pane `?task=` at 1024 / 768 / 1440 in WebKit | Escape after clicking inside the pane left it open (`closed:false`, URL kept `?task=`). Focus was not inside the pane in 2 of those cases. | Check the overlay-stack's key handler in Safari (focus may stay on the body after the click target) |
| UIQA-BRW-01 | n/a | **BLOCKED** | Firefox | `firefox-1543` is installed, but it fails to start: Windows SideBySide "Dependent Assembly mozglue could not be found" (Application event log, 24 Nov 00:28 and 00:31). No Firefox results. | The owner / IT repairs the install (`npx playwright install --force firefox`, a download that needs approval), or installs the VC++ runtime. Then re-run the browser subset. |

### B10. Content and readability

| ID | Sev | Status | Where | Actual | Root cause | Fix |
|---|---|---|---|---|---|---|
| UIQA-CON-08 | P3 | Confirmed | Meetings, Admin Records, Calendar, Tasks, native date fields | Date / time formats differ: "Tue, 24 Nov, 2026, 11:48 pm to 12:48 am" (meetings); "23 Nov 2026, 23:48" (Admin Records, 24 h); "23 Nov 2026, 11:48 pm" (elsewhere); "21 Nov" with no year and "Yesterday" (Task Summary); "24-11-2026" (native date inputs); 24 h hours (calendar) | `features/meetings/MeetingParts.tsx:52-55`; `server/records/columns.ts:35` (`hour12:false`); `features/work/PaneLayout.tsx:19`; **224 ad-hoc `toLocale*` / `Intl.DateTimeFormat` calls in 127 files** (no shared formatter) | One `lib/format/date.ts` (date, date-time, range, relative + title) used everywhere; DateRangePicker instead of native inputs |
| UIQA-CON-16 | P3 | Confirmed | Not-found pages | Every not-found says "Search your requests" with a requests search box. That includes a missing task, meeting, ticket, project, information, an Admin user and the Admin / Super Admin areas. Admin's not-found links to `/users`. | `app/users/not-found.tsx:16`, `app/admin/not-found.tsx:16-23`, `app/superadmin/not-found.tsx:16` | A `StatePage` with the area's search and home |

## C. Root-cause groups

| Group | Root cause | Defects |
|---|---|---|
| G1 Shell tokens | Values in `AppShell.tsx` and `tailwind.config.ts` instead of `--header-h`, `--page-px`, `--page-pt`, `--sidebar-w`; centred max-width | C1-C16 (conflicts), RESP-02, RESP-03, RESP-07, LAY-02 |
| G2 PageHeader not universal | 10 custom h1 implementations; PageHeader title row lacks `min-w-0` | **LAY-01**, CON-03, CON-04, CON-11, CON-12, CON-15, RESP-04, A11Y-02 |
| G3 Control sizing by page | `h-*` added next to `field-input` / `btn-compact`; `btn-primary` full width by default; the touch rule covers 2 classes | CON-05, CON-06, CON-13, RESP-05 |
| G4 No shared list / table | RecordTable, raw tables, per-module toolbars, phone cards for 2 modules only | CON-01, CON-07, CON-10, TBL-01, RESP-01 |
| G5 Overlay families | Dialog vs raw `<dialog>` vs `role=dialog` divs vs panes | CON-18, OVL-01, MOT-04 (partly) |
| G6 Client-only measurement after hydration | Charts, panes and capability checks rendered after the first paint | PERF-01, PERF-02, ERR-02, ERR-01 (suspected) |
| G7 Ad-hoc formatting | 224 local date formatters | CON-08, ERR-01 (suspected) |
| G8 Motion code | Width animations; promise not handled; JS smooth scroll | MOT-01 to MOT-05, A11Y-03 |
| G9 State pages | Four not-found pages, root 404 outside the shell | LAY-03, CON-16 |
| G10 Small duplicates | Avatar, radius `rounded-xl`, h2 sizes | CON-02, CON-09, CON-17 |

## D. Fix batches (proposed order and effort)

The effort figures are for one developer who knows the codebase. Each one includes updating the affected e2e / unit tests and the general pages (help, guide, release notes) per the project's STRICT RULE.

| Batch | Scope | Defects / conflicts | Effort |
|---|---|---|---|
| **0. Hotfix** | `PageHeader` title row (`min-w-0`, `overflow-wrap:anywhere`) + `main { overflow-wrap:anywhere }`; long-title sweep case for each record type | LAY-01 | 0.5 day |
| **1. Shell and tokens** | The owner's decisions Q-UI-1 … Q-UI-6. Then: header / page / sidebar / section tokens; sidebar 250 / 72 and the tablet rail default; content width; phone header token; control-size tokens (sm 32 / md 40 / lg 48) and the touch rule for all of them; `btn-*` `w-auto` default; type tokens (`text-page-title` 24, `text-section` 18); radius / shadow tokens; the new motion scale (24 Nov brief) and Tailwind `DEFAULT` transition; z-popover fix; the dark-token single source | C1-C16, RESP-02, RESP-03, RESP-07, LAY-02, CON-13 (default), MOT tokens | 3-4 days |
| **2. Shared components** | PageHeader everywhere (slots: badge, back, actions; phone variant; record titles); `ListPage` / `ListToolbar`; one `DataTable` (RecordTable merged, density, sticky, phone cards); `Tabs` / `SectionNav`; `Dialog` / `Popover` variants for the raw dialogs and `role=dialog` divs; `Avatar`; `StatePage` (not found / no access / switched off); `IconButton`; remove the `h-*` overrides (48 + 19 files) | CON-01, CON-03 to CON-06, CON-10 to CON-12, CON-15, CON-17, CON-18, TBL-01, RESP-01, RESP-04, LAY-03, CON-16, A11Y-02 | 8-10 days |
| **3. Module pages** | Migrate Meetings, Tickets, Projects, Admin Records and Super Admin logs to ListPage; the AI page header; primary-action wording; detail-page badge / back placement; the Home section headings; the Calendar / Meetings full-width buttons | CON-01 (pages), CON-02, CON-04, CON-07, CON-09 | 4-5 days |
| **4. Accessibility, motion, performance** | Reflow at 320 on the task page; h1 on phone pages; smooth scroll under reduce; the A11Y-04 contrast check; CLS on Analytics and Task Summary; width / top / left animations → transform; `transition.ready` catch; the WebKit transitions crash on real Safari; the WebKit pane Escape check; hydration #418 on Devices; then page transitions ON with fade + 4 px (motion audit §4); Motion Playground (hidden) | A11Y-01 to A11Y-04, PERF-01, PERF-02, MOT-01 to MOT-05, ERR-02, OVL-01 | 4-5 days |
| **5. Content** | A shared date / time / range / relative formatter replacing the 224 calls (by module, behind tests); native date inputs → DateRangePicker; not-found copy; terminology pass (verbs, record numbers) | CON-08, CON-16, ERR-01 (if confirmed as time text), CON-10 | 3-4 days |
| **6. Retest and baselines** | Re-run the sweep (with assertions on the adopted standards) in Chromium, Edge, WebKit and Firefox (once unblocked); axe; probes; then the tier-1 visual baselines (VISUAL_REGRESSION_REPORT) | all | 2-3 days |

**Total:** about 25-32 developer days. Batches 0 and 1 unblock the rest. Batch 2 removes most of the defects at their root. Batches 3-5 can partly run in parallel.

## E. Retest status

Phase 3 fills this in: one row per ID with Fixed / Not fixed / Won't fix, the build and the evidence.

**v1.89.0 stage 3a (D-421, batches 0 and 1):** fixed LAY-01 (P1), A11Y-01, LAY-02 (= RESP-08), RESP-02, RESP-03, RESP-07; RESP-05 in part; tokens in for CON-05, CON-06, CON-13 (page sweep in batch 2). Conflicts C1-C6, C8, C11-C14, C16 resolved by the adopted tokens (GLOBAL_DESIGN_SYSTEM §A). One row per fix: [BUG_FIX_LOG.md](BUG_FIX_LOG.md). Re-measured shell: [SCREEN_LAYOUT_STANDARD.md §2](SCREEN_LAYOUT_STANDARD.md).

## F. Blocked and not covered

- **Firefox:** BLOCKED (BRW-01). Installed, but it does not start (SideBySide error). No Firefox geometry or probes.
- **WebKit specifics:**
  - The production headers (HSTS / `upgrade-insecure-requests`, `lib/security/csp.ts:45`) make WebKit request `https://localhost` assets. The specs route these back to http (`webkitHttpsShim`).
  - The service worker and RSC prefetch errors caused by that shim are filtered out or ignored. They are not app defects.
  - The WebKit results are a Safari stand-in. There were no real iOS or macOS devices.
- **Not covered in phase 1** (QA_TEST_PLAN §7):
  - the dark theme;
  - the Classic view (owner decision pending);
  - screen readers;
  - manual contrast;
  - loading states under throttling;
  - print / copy / export;
  - every form except Create task and Out of office;
  - real devices.
