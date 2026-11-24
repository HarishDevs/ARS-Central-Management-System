# UI refactoring log (v1.89.0 stage 3, UI unification)

**Started:** 24 Nov 2026, branch `release-189`. One release v1.89.0 (owner); no version bump until the last stage. Defect rows are in [BUG_FIX_LOG.md](BUG_FIX_LOG.md); the adopted tokens in [GLOBAL_DESIGN_SYSTEM.md](GLOBAL_DESIGN_SYSTEM.md); the shell in [SCREEN_LAYOUT_STANDARD.md](SCREEN_LAYOUT_STANDARD.md).

## Stage 3a: batch 0 (P1 hotfix) and batch 1 (shell and tokens), D-421

**Decision:** the owner's reference dimensions are adopted as tokens ("go ahead with your recommendations"), answering Q-UI-1, Q-UI-2, Q-UI-4 and Q-UI-6 of the design-system proposal. Q-UI-3 (Classic): keep as it is for now. Q-UI-5 (motion) was D-420.

### Tokens (one place)

`styles/globals.css` `:root` holds the values; a `@media (max-width: 767.98px)` block switches the phone ones; `tailwind.config.ts` maps every one to a class (no shell number in a component).

| Token | Value | Tailwind | Was |
|---|---|---|---|
| `--header-h` / `--header-h-mobile` | 64 / 56 (below 768, every area) | `h-topbar`, `min-h-topbar` | 64 (`spacing.topbar: 64px`); users phone 56 by its own class, panels on phones 64 |
| `--sidebar-w` / `--sidebar-w-rail` | 250 / 72 | `w-sidebar`, `w-rail` | 220 / 80 (`w-20`) |
| `--page-px` | 24 (16 below 768) | `px-page` | content 32 from 640, header 24 from 640; 16 / 12 on phones |
| `--page-pt` | 24 (16 below 768) | `pt-page` | 40 from 640, 24 panels on phones, 16 users phone |
| `--section-gap` | 24 (16 below 768) | `mb-section`, `gap-section` | PageHeader `mb-6` |
| `--content-max` / `-reading` / `-form` | 1600 / 896 / 960 | `max-w-content`, `max-w-reading`, `max-w-form` | `max-w-7xl` (1280) centred |
| `--control-h-sm / -md / -lg` | 32 / 40 / 48 | `h-control-sm/-md/-lg` | buttons 28 / 36 / 46 |
| `--input-h` / `--input-h-sm` | 42 / 32 | `h-input`, `h-input-sm` | 44 / 36 |
| `--touch-min` | 44 | `min-h-touch` | 44 (2 classes only) |
| `--text-page-title` / `--text-section` / `--text-body` | 24 / 18 / 14 | `text-page-title`, `text-section` (`text-body` as before) | title 20 |
| `--radius-control / -card / -popover / -modal / -pill` | 8 / 12 / 12 / 16 / 9999 | `rounded-md/-lg/-xl` read them; `rounded-control/-card/-popover/-modal` | same values, now tokens |
| `--space-1 … --space-12` | 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 | Tailwind's `1 2 3 4 5 6 8 10 12` | (the scale written down; enforcement: batch 2) |

### Applied in this batch

| Area | Change | Files |
|---|---|---|
| PageHeader (P1) | `min-w-0` path, wrapping title row, `overflow-wrap:anywhere`; title `text-page-title` (24); margin `mb-section` | `features/shell/PageHeader.tsx` |
| Long words | `main { overflow-wrap: anywhere }`, tables keep `break-word` | `styles/globals.css` |
| Custom h1s on `text-title` (23 h1s in 19 files: not-found / error / no-access / switched-off pages, people card, overview header, My Tasks, project and portfolio headers and wizards, form fill) | → `text-page-title` (24), so every page title using the shared size is 24. The Classic screens' title keeps its Classic style. Other h1 styles (`greeting` 28, `display` 32, `.mob-screen-title` 22 / 800, sr-only) are batch 2 (PageHeader everywhere). | 19 files under `app/` and `features/` |
| Header | `h-topbar` (64 / 56) and `px-page` in both the desktop header and the users phone bar (12 → 16) | `features/shell/AppShell.tsx` |
| Sidebar | `w-sidebar` 250 / `w-rail` 72; icons centred in the rail (nav `items-center`, items full width); tooltips and labels unchanged; tablet rail by default (below) | `features/shell/SidebarFrame.tsx`, `features/shell/sidebar-cookie.ts`, `features/shell/AppShell.tsx` |
| Content | `w-full max-w-content px-page pt-page`, left-aligned (no `mx-auto`); Classic keeps `mx-auto max-w-7xl px-4 pt-6 sm:px-8 sm:pt-10` | `features/shell/AppShell.tsx` |
| Banners (maintenance, try-as, demo) | `px-page` (were 16 / 32), on the header's line | `features/shell/AppShell.tsx` |
| Offsets that assumed 56 / 64 | `var(--header-h)`: phone task bar, bell panel on phones, phone skeleton, `.request-sticky`, toasts | `TaskDetail.tsx`, `NotificationBell.tsx`, `NavigationProgress.tsx`, `globals.css`, `Toast.tsx` |
| Controls | `btn-primary/-secondary/-danger/-danger-quiet` 46 → 40; `btn-compact`, `btn-ghost`, `tb-btn`, `tb-split` → 32; `pill-select` 32; `field-input` 44 → 42; `field-compact` 36 → 32; new `btn-lg` 48; size modifiers after the variants; touch rule for every named class | `styles/globals.css` |
| Button primitive | `size` = `sm` / `md` / `lg` (`btn-compact` / default / `btn-lg`) | `features/ui/Button.tsx` |
| Public pages | header `h-topbar` + `px-page`; text `max-w-reading` (896), top `pt-page` | `features/public/PublicPage.tsx` |
| Help | reading width `max-w-reading` | `app/users/help/page.tsx` |

### Tablet sidebar (768-1279)

- **Saved choice wins.** `ars_sidebar` = `rail` / `open` is written only by ☰ (as since D-229).
- **No choice:** the frame follows the window (`matchMedia` 768-1279.98 → rail, else open) and writes `ars_vw` = `tablet` / `wide` so the server's next page starts the same (no jump). On a device's very first page the server can't know the width yet: the frame then draws both the rail and the open sidebar and CSS shows the right one at the first paint (rail below 1280, open from 1280), so nothing moves; the effect then keeps one. (A first version folded on hydration and the sweep measured a layout shift of 0.16-0.49 on the first page at 1024; fixed before commit, e2e guard.) Named in the privacy policy (cookies paragraph; effective date 24 Nov 2026).

### One shell for /users, /admin, /superadmin

All three render `features/shell/AppShell.tsx` (`area` prop) with the same `SidebarFrame`, header and `main`. The remaining differences were the phone header (56 users phone layout vs 64 panels) and the phone padding / top (16 / 16 vs 16 / 24); both now come from the phone tokens. Differences kept on purpose: the users phone layout's own top bar (mark, search link, bell, account) and tab bar (v1.43.0); the panels' MobileNav sheet, Settings search and "Back to the app"; the users area's larger bottom padding for its bottom navigation.

### Not changed in this batch (by decision)

- **Classic view:** untouched (owner): its centred box, title bar and Tally overrides stay; its field height override (36) stays. It inherits only the shared button heights (40) and the touch rule.
- **No element hidden, no feature removed, no business logic changed.**
- **Full-width `btn-primary` default (CON-13):** the token is defined (`btn-lg`, sizes) but making `w-auto` the default changes 30+ forms; it goes with the batch 2 control sweep.

### Measured geometry

See [SCREEN_LAYOUT_STANDARD.md §2](SCREEN_LAYOUT_STANDARD.md) (before and after per viewport) and the sweep notes there.

### For batch 2 (shared components sweep)

1. Remove the page-level `h-*` overrides beside `field-input` (48 files) and `btn-compact` (19 files) so every control measures the named sizes (CON-05, CON-06); lint against `h-*` next to those classes.
2. `btn-*` `w-auto` by default, `btn-block` opt-in (CON-13).
3. PageHeader on every page (custom h1s: phone `.mob-screen-title` 22 / 800, task phone title `greeting` 28, New project wizard `display` 32, AI assistant sr-only, phone Home without h1; CON-03, CON-04, RESP-04, A11Y-02); a phone title token (22 / 700).
4. `text-section` (18) for page section h2s (CON-02: 14 / 16 / 17 / 19 / 20 today).
5. Touch: TaskGrid inline selects / inputs and round task checks under 44 (RESP-05 rest).
6. Narrow forms: give long single-column forms `max-w-form` (960) where they now stretch to the fluid width (they had 1280 before); data pages keep the full width.
7. ListPage / DataTable / Dialog / Popover / Avatar / StatePage, per the defect report's batch 2.
8. Spacing scale lint (no 6 / 10 px outside controls, no arbitrary `-[Npx]`).
9. Retire `text-title` (20; 29 non-h1 uses left), `card-title`, `greeting` after the sweep.

## Stage 3b: batch 2 (shared components sweep), D-422

**Decision (owner: "go ahead with my recommendations"):** the handover list above, done as one sweep. Classic unchanged (D-421). No element hidden, no feature removed, no business logic changed. Rows per defect: [BUG_FIX_LOG.md](BUG_FIX_LOG.md); canonical components: [GLOBAL_COMPONENT_INVENTORY.md §0](GLOBAL_COMPONENT_INVENTORY.md).

### What changed

| # | Item | Change | Where |
|---|---|---|---|
| 1 | Control heights (CON-05 / 06) | 172 class strings in 65 files had `h-*` beside `field-input`, 26 in 22 files beside `btn-compact`: `h-7/8/9` field → `field-compact` (32), `h-10/12` → 42; `btn-compact h-10/11` → md (40), `h-8/9` → 32. ESLint `ars-ui/control-size` (fixed height beside any named control class), `ars-ui/spacing-scale` (arbitrary px / rem padding, margin, gap), `ars-ui/type-scale` (retired sizes). The phone layout's request action bar 36 → the sm token (44 on touch). | `eslint-ui-rules.mjs`, `eslint.config.mjs`, 70 files |
| 2 | Button width (CON-13) | `btn-primary / -secondary / -danger` `w-auto`; `.btn-block` opt-in (sign-in, set / forgot password, Google, Not me, signed-out). Dialog footers right-aligned buttons (they wrapped full width). | `globals.css`, auth panels |
| 3 | Page titles (CON-03 / 04, RESP-04, A11Y-02) | The page-title token carries size, line height and weight; below 768 it is **22 / 28 / 700** (one phone title). `ScreenTitle` uses it (`.mob-screen-title` 22 / 800 gone), the task phone title (28) uses it, New project (32) uses it, the AI Assistant has a visible PageHeader, the phone Home has the title "Home". | `globals.css`, `tailwind.config.ts`, `BottomSheet.tsx`, `TaskDetail.tsx`, `NewProjectWizard.tsx`, `ai/assistant/page.tsx`, `MobileHome.tsx` |
| 4 | Section / figure type (CON-02) | `text-section` 18 on page-section h2s (17 / 16 / 19 / 20 / 22 before), dialogs' titles too; `text-stat` 22 for figures in tiles (20 / 22 before); `text-card-title` and `text-greeting` removed from Tailwind; `text-title` kept for the Classic title bar only. | 49 lines in 40 files |
| 5 | Touch (RESP-05 rest) | `.grid-editor` (TaskGrid priority select, a section's name) min 44 and `.task-check` an invisible 44 hit ring, on `pointer: coarse` only. | `globals.css`, `TaskGrid.tsx`, `ProjectWorkspace.tsx`, `work/client.tsx` |
| 6 | Form width | New task / information / meeting / ticket forms `max-w-form` (960). | 4 form components |
| 7 | List page (CON-01, RESP-01, TBL-01) | `ListPage`; `.table-cards` phone cards with `data-label` / `data-card-title` / `data-card-lead`; DataTable, RecordTable (+ 12 / 600 titles), Tasks, Meetings, Tickets, 4 Super Admin logs; Projects on ListPage + ListToolbar; Meetings / Tickets tabs in the toolbar row. | `ListPage.tsx`, `globals.css`, 11 files |
| 8 | Dialog, Avatar, StatePage (CON-16 / 17 / 18) | Dialog title 18, `.icon-btn` × (40, 44 touch), share dialogs' padding 20; one `Avatar` (tone); `StatePage` for not found / no access. | `Dialog.tsx`, `ShareDialogs.tsx`, `TaskCreator.tsx`, `Avatar.tsx`, `Display.tsx`, `StatePage.tsx`, 4 not-found, `NoAccess.tsx` |
| 9 | CLS on `/admin/setup/custom-approval` at 1920 | The form designer measured its width after hydration and switched to three columns (the library bar of 83 px vanished: 0.098). Its columns now come from a CSS container query on its own width (`.ffe`); JavaScript only places a chosen field's properties. Probe: 0.098 → 0.0001 (Chromium), 0 (Firefox). | `FormFieldsEditor.tsx`, `globals.css` |
| 10 | Firefox CSP "blocked a JavaScript eval" | **From the app, not the harness:** a `securitypolicyviolation` listener named `_next/static/chunks/1971-….js`, Zod 4's one-time `Function("")` probe (it catches the refusal and validates without compiling). `instrumentation-client.ts` sets `config({ jitless: true })` before the app's code; the CSP is unchanged (no `unsafe-eval`). Firefox probe after: no CSP message, no violation. | `instrumentation-client.ts` |

### Measured (UIQA sweep, Chromium, 9 viewports + rail sample, 1,783 visits; before = the stage 3a sweep of the same build line)

| Measure | Before (3a) | After (3b) |
|---|---|---|
| Shell token mismatches (`conformance`) | 0 | **0** |
| Page overflow / elements outside | 0 / 0 | **0 / 0** |
| Console errors / failed requests / status ≥ 400 | 0 / 0 / 0 | **0 / 0 / 0** |
| Visits with CLS > 0.05 | 1 (`/admin/setup/custom-approval` 1920, 0.098) | **0** (max below 0.05) |
| Named controls measured | 10,437 | 10,437 |
| **Off-token control heights** (touch 44 allowed on phones / 768) | **686** (btn-compact 136 at 36 / 40 / 44 / 48; field-input 550 at 28 / 32 / 36 / 40 / 44) | **51**: 30 are the request decision buttons on a computer (40, a grid of md cells by design), 12 the phone decision bar (48 = `--control-h-lg`, by design), 9 the phone request action bar (36; moved to the token after the sweep) |
| Distinct `field-input` heights (desktop) | 28 / 32 / 36 / 40 / 42 / 44 | **42** (and 32 = `field-compact`) |
| h2 sizes | 14 / 15 / 16 / 17 / 18 / 19 / 20 / 22 / 52 | **14 / 15 / 18 / 52** (14 card titles, 15 the notification day labels, 52 the sign-in hero) |
| h1 styles in the app | 24 / 600, 22 / 800, 20 / 600, 28 / 600, 32 / 600, 14 sr-only (66) | **24 / 600 desktop, 22 / 700 phones**; 32 / 44 / 41 only on public / sign-in pages; sr-only 3 (phone More) |
| axe (wcag2a / aa / 21aa / 22aa, 1440 + 390) | 0 | 1 node, `color-contrast` on the active Task Summary row's due date (the known intermittent **A11Y-04**, not new; not changed by this batch) |

List measures (added to the sweep in this batch; before = the 3a build swept at 1440 and 390 with the same probe):

| Measure (Chromium) | Before (3a build) | After |
|---|---|---|
| List toolbar kinds seen at 1440 (`summary.toolbars`) | 7 (ListToolbar on 41 pages, a page-made search box on 19, …) | 7 kinds (ListToolbar 43, page search box 17): Projects and its search moved onto the shared toolbar; the rest is batch 3 (below). The probe counts kinds of controls on any page (rich-text toolbars count as "own toolbar"), so it falls only as pages move. |
| Phone pages with a squeezed table (390) | **41** | **27** (Tasks ×2, Meetings, Tickets, Admin users, Admin Records ×6, audit, deliveries, ticket dashboards … now cards) |

Firefox spot check (1440 / 768 / 390, 531 visits): conformance 0, overflow 0, outside 0, console errors 0 (the CSP "eval" message is gone), failed 0, CLS 0, axe = the same A11Y-04 node. WebKit spot check (1440 / 768 / 390, 531 visits): conformance 0, overflow 0, outside 0, failed requests 0, CLS 0; 521 visits measured: the 1440 USER chunk hangs on `/users/profile/devices` (page.evaluate never returns, twice) and the 9 routes after it were not reached; at 768 / 390 that page logs React #418, the known UIQA-ERR-02 (WebKit, AppDevicesPanel reads browser capabilities during the first render; batch 4). Not caused by this batch (the panel only lost its full-width buttons).

### For batch 3 (module pages)

1. Onto `ListPage`: Portfolios (own search box), Admin Records (PowerSearch + toolbar into one), the audit log's native From / To dates (DateRangePicker), Insights / dashboards pages; wrap the other list pages (Requests, Tasks, Information, Meetings, Tickets) in `ListPage` itself.
2. Phone cards (`data-label` + `.table-cards`) for the 27 remaining squeezed tables: Insights dashboards / workload / reports / analytics metrics, set-up type lists (task, information, ticket forms), budgets, backup, retention, Google, WhatsApp templates, AI data sources, jobs, page access, danger-zone requests, tickets board, portfolio detail.
3. RecordTable merged into DataTable (density, sticky, cards).
4. The raw `<dialog>`s (palette, share, work confirms) → `Dialog`; `Popover` variants for the bell / pickers.
5. CON-07 "New …" wording, CON-09 radius, CON-10 RecordNo, CON-11 / CON-12 detail header slots (badge, back), CON-15 Home overview header.
6. LAY-03 unknown area addresses inside the shell (routing, with the navigation owner: D-413).
7. Form width for the settings forms (Admin set-up) where they are single-column.

## Stage 3c: batch 3 (module pages), D-423

**Decision (owner: "go ahead with my recommendations"):** the stage 3b handover list and the defect report's batch 3, as one sweep. Classic unchanged. No element hidden, no feature removed, no business logic changed. Rows per defect: [BUG_FIX_LOG.md](BUG_FIX_LOG.md) stage 3c.

### What changed

| # | Item | Change | Where |
|---|---|---|---|
| 1 | Shared toolbar (CON-01) | `ListPage` + `ListToolbar`: Portfolios (own search box gone; tabs and View as list / cards lead the row), every Admin → Records tab (PowerSearch `inToolbar` leads the row, Sort / Group beside it; Tickets / Meetings gained Sort), the coordinator board (status chips lead; Category / Only overdue in Filter; search in the toolbar), My tickets, Meetings, the audit log (download dates on DateRangePicker), sign-in history, Insights dashboards (`DashboardFrame`), reports, analytics list, budgets. Finder boxes marked `data-search-kind="finder"`. | `PowerSearch.tsx`, `RecordsRegister.tsx`, `TicketMeetingRecords.tsx`, 9 pages, Insights screens |
| 2 | Phone cards (RESP-01 rest) | `.table-cards` + `data-label` on the 27 squeezed tables: `(summary)`, `MetricsScreen`, `DashboardFrame`, raisers, reports `[key]`, workload, budgets, `ModuleTypeScreens` (type lists and versions), AI data sources, Google, WhatsApp templates, `BackupCentre`, danger-zone requests, retention, jobs, page access, `PortfolioList`, the coordinator board. No table needed `data-matrix`. A card that also holds its heading keeps its frame on phones. | 18 files, `globals.css` |
| 3 | One table (TBL-01) | RecordTable merged into DataTable (`look="records"`, `pager`, row `href` / `fullHref` / `current`, column `wide`); RecordTable deleted. `powerHref` keeps a requested `open` / `page` (Tickets / Meetings rows did not open the pane). | `DataTable.tsx`, `power-href.ts` |
| 4 | Dialogs (CON-18 rest) | Holiday prompt, pane Delete this task?, Save as template, Share project, Share task, Keyboard shortcuts on `Dialog` (`flush` body for sections). The palette stays its own surface. | 6 files |
| 5 | Consistency | CON-07 "New …" + icon (7 lists); CON-09 `rounded-card` on 10 bordered boxes; CON-10 `RecordNo` (6 lists); CON-11 `Breadcrumbs back=` (8 detail pages); CON-12 PageHeader `badge` (5 detail pages); CON-15 overview header `mb-section`. | see BUG_FIX_LOG |
| 6 | LAY-03 | `app/{users,admin,superadmin}/[...rest]` (requireArea, notFound → in-shell StatePage, 404, no metadata). Page views of unknown /users and /admin addresses rewritten to `/<area>/__unknown-address` (signed as the page, open address) so restricted people get the 404 too; POST / actions to unknown /users keep the root 404; role checks and real pages' rules unchanged. Admin route list generated. | 3 pages, `middleware.ts`, `lib/routing/*`, `scripts/dev/write-users-routes.mjs`, `server/authorization/pages.ts` |
| 7 | Form width | `max-w-form` on Meeting settings, Ticket categories, Approver groups, AI rules, a reminder rule. | 5 pages |
| 8 | Sweep tooling | Probe: PowerSearch inside the toolbar = the toolbar's filter; `data-search-kind` boxes = "finder"; `data-matrix` tables counted apart; analyzer `listPages`, `phoneMatrix`. | `zz-ui-qa-audit.spec.ts`, `ui-qa-analyze.mjs` |

### Measured (UIQA sweep, Chromium, 9 viewports + rail sample, 1,783 visits; before = the stage 3b sweep)

| Measure | Before (3b) | After (3c) |
|---|---|---|
| Shell token mismatches / page overflow / outside | 0 / 0 / 0 | **0 / 0 / 0** |
| Console errors / failed requests / status ≥ 400 | 0 / 0 / 0 | **0 / 0 / 0** |
| Visits with CLS > 0.05 | 0 | **0** |
| Phone pages with a squeezed table (360 / 390 / 430) | 81 visits (27 pages at 390) | **0** (no `data-matrix` table either) |
| Toolbar kinds at 1440 (`summary.toolbars`) | 7: ListToolbar 43, page search box 17, ListToolbar + page search box 6, ListToolbar + PowerSearch 4, PowerSearch 2, own toolbar 29, own toolbar + page search box 2 | **5:** ListToolbar 43, ListToolbar + finder 5, finder 15, own toolbar 21, own toolbar + finder 2. **Page-made list search boxes: 0** (17 + 6 + 2 pages counted before; with the 3c probe those that remain are finders: Search settings, help search, Find a field, the Admin home record search). **PowerSearch outside the toolbar: 0** (6 pages before). "Own toolbar" = rich-text and task-pane toolbars, TaskGrid (not lists). |
| ListToolbar pages inside `ListPage` (1440) | 1 (Projects) | **20**; 28 ListToolbar pages keep the same order without the wrapper (Requests, Tasks, Information, Admin users, …: batch 4) |
| Off-token control heights | 51 | **42** (30 = the request decision grid at 40 on a computer, 12 = the phone decision bar at 48: both by design) |
| axe (1440 + 390) | 1 node (A11Y-04) | **1 node**, the same A11Y-04 contrast on the active Task Summary row (4.23:1; batch 4) |

Firefox (1440 / 768 / 390, 531 visits, in role chunks): conformance 0, overflow 0, outside 0, failed requests 0, status ≥ 400: 0, CLS 0; axe = the same A11Y-04 node; console: one visit (`/admin/insights/dashboards` at 390) logged "Failed to fetch RSC payload … falling back to browser navigation" for three prefetches the next visit cancelled (navigation noise of the harness, as the aborted prefetches noted in stage 3a). WebKit (1440 / 768 / 390, 531 visits, in role chunks; **all 531 measured this time**, the `/users/profile/devices` hang of stage 3b did not recur and that page logged no #418): conformance 0, overflow 0, outside 0, failed 0, status 0, CLS 0; axe = A11Y-04 and `meta-refresh` on `/admin/insights/dashboards` (Next's `#__next-page-redirect` while that page's `redirect()` to Utilisation streams behind its loading boundary; unchanged code, WebKit measured mid-redirect: batch 4); console: the same cancelled-prefetch noise on 5 visits ("access control checks" = the WebKit https shim) and one React #418 on `/users/security` at 390 (hydration text, the ERR-01 / ERR-02 family: batch 4 / 5).

### Tests

- Unit: `tests/ui/ui-modules-v189.test.ts` (14) + `power-search` (+1 case), `page-access-v181` (the catch-all is no page address); total 221 files / 2,045 tests.
- e2e `tests/e2e/v1890-ui-modules.spec.ts` (4): Chromium 4/4, Firefox 4/4 (in the 48 below), WebKit 4/4 on the second run (the first WebKit run lost the page during the breadcrumb step: harness).
- Full existing suite in Chromium, one run in suite order on one database (545 tests): 451 passed, 9 failed, 25 did not run (serial blocks after a failure), 60 skipped. **v172-lists passed (all three, "Waiting for me has more filters" included).** The 9: v1510-meetings (my own updated link name also matched the empty state's "Schedule a new meeting": `exact: true`, then passed), v1730-layout-parity and v1870-navigation-continuity (passed when re-run: order-dependent data), and 6 that fail the same way on the stage 3b build (checked on a build of `5c45777`): session9 (the Admin sidebar's groups start folded since D-411; the test expects a link inside one), v139-draft-task (the Create task window measured 3.8 px off centre mid-animation), v1720-layout-parity (pane ⋯ menu "in viewport" ratio 0), v1722-visual (axe light: the task pane step), v1750-date-picker (phone sheet 341 wide mid-animation), v190 (a task link opens the pane `?task=` where the test expects the full page). Not caused by this batch; batch 4.
- Firefox (motion / nav / ui sets: v1890-ui-modules, -ui-components, -ui-shell, -navigation, -motion, v1860-header-consistency): 48 / 48.
- WebKit (the same sets): first run 29 passed, 3 failed (v1890-ui-modules "Settings forms …", v1860 H-02, v1890-navigation NAV-02 S12a); on re-run v1890-ui-modules and v1860 passed; NAV-03 failed once and passed once (flaky); **NAV-02 S12a fails 3 / 3 on this build and 3 / 3 on the stage 3b build** when run alone (the redirect to /signed-out comes about 21 s after the session ends, the test waits 20 s; it passed once on 3b only when run after another test): WebKit harness timing, not this batch.
- Typecheck, `npm run lint`, `npm run build`: clean.

### For batch 4 (accessibility, motion, layout shift)

1. A11Y-04: the overdue / due text (`#15803d` on `--color-row-active`, 4.23:1) in the active Task Summary row; check every status text token on `row-active` with `scripts/qa/token-contrast.mjs`.
2. ERR-02 family: React #418 on `/users/security` at 390 (WebKit) and earlier on `/users/profile/devices`; relative / capability text rendered on the server and again on the client. The devices-page WebKit hang (stage 3b) did not recur in this sweep; keep it on the list until it passes twice.
3. WebKit `meta-refresh` (axe) on `/admin/insights/dashboards`: redirect before the loading boundary streams (a `redirect` in middleware or the hub link straight to Utilisation).
4. The 6 pre-existing e2e failures above (mostly measurements taken while a window still animates: wait for `animationend` / `getAnimations()`), session9's folded group, v190's pane-vs-full-page expectation; NAV-02 S12a timing in WebKit.
5. OVL-01 (WebKit pane Escape), RESP-06 (Pico Bot launcher over rows, suspected), FORM-01 / FORM-02.
6. `ListPage` wrapper for the 28 ListToolbar pages that have the same order without it (Requests, Tasks, Information, Admin users, deliveries, AI history, workload, the analytics screens, …); `Popover` variants for the bell and pickers.

### For batch 5 (content)

1. One date / time / range / relative formatter (`lib/format/date.ts`) replacing the ad-hoc `toLocale*` / `Intl.DateTimeFormat` calls (224 in 127 files at v1.88.0; e.g. the board's `dayText`, Records' 24 h times, the meetings list) behind tests, module by module (CON-08, ERR-01 if time text).
2. Native date inputs → DateRangePicker (Analytics period, dashboards, Task / Information filters, calendar entry, delegation, …; the audit log's moved in this batch).
3. Wording: form titles "Schedule a meeting" / "Raise a ticket" / "Add user" and the sidebar / + Create labels against the "New …" list actions; one verb set for record numbers and empty states.

## Stage 3d: batch 4 (accessibility, overlays, pre-existing e2e failures), D-424

**Decision (owner: "go ahead with my recommendations"):** the stage 3c handover's batch 4 list and the defect report's remaining batch 4 items, as one sweep. Classic unchanged. No element hidden, no feature removed, no business logic changed. Rows per defect: [BUG_FIX_LOG.md](BUG_FIX_LOG.md) stage 3d.

### What changed

| # | Item | Change | Where |
|---|---|---|---|
| 1 | A11Y-04 | Light status text tokens: success-600 `#137333`, warning-600 `#b93c0b` (≥ 4.78:1 on row-active); the contrast script checks status text on row-active. | `globals.css`, `token-contrast.mjs` |
| 2 | Entry motion fill (root cause, found via v1720 / v1750) | Every entry animation fills `backwards` (was `both`): the kept last frame (`translate: 0px`, `transform: translateY(0)`) made panes / windows the containing block of `position: fixed` menus and sheets. `fixedOrigin` also detects the single transform properties, container queries and backdrop filters; menus re-measure on animationend / transitionend. Unit guard. | `globals.css`, `MenuCore.tsx`, `tests/ui/motion-fill-v189.test.ts` |
| 3 | ERR-02 + devices hang | Safari detection in the effect; no push-subscription lookup before permission "granted". | `AppDevicesPanel.tsx`, `pwa/browser.ts` |
| 4 | meta-refresh | Dashboards hub: `next.config` redirect (307). | `next.config.ts` |
| 5 | Page transitions across areas | None between users / admin / superadmin (the whole shell changes; Playwright's WebKit crashed on it). | `motion-rules.ts` |
| 6 | FORM-01 / FORM-02 | Create task says what is missing; the delegate picker is tied to its error. | `TaskCreator.tsx`, `DelegationForms.tsx` |
| 7 | RESP-06 | Clear strip + scroll padding for the Pico Bot launcher on phone lists. | `globals.css` |
| 8 | ListPage everywhere | The 28 ListToolbar pages are inside `ListPage` (`header` slot); the Admin home's Attention section stays a section. | 21 files |
| 9 | Popovers | `.popover-surface` for menus, bell, pickers, field editors, emoji, Try as; PersonSelect focus back to its button. | 12 files |
| 10 | Toast live regions | Real boxes instead of `display: contents`. | `Toast.tsx` |
| 11 | Readiness signals | `<html data-session-watch>` and `data-place-memory` (the shell's listeners are on); the sweep, nav and accessibility specs wait for them. | `SessionWatch.tsx`, `PlaceMemory.tsx`, specs |
| 12 | Sweep tooling | `UIQA_THEME=dark` (results under `<browser>-dark`); settle waits for hydration. | `zz-ui-qa-audit.spec.ts`, `ui-qa-shared.ts` |

### The 6 pre-existing Chromium failures (stage 3c)

| Test | App or test | Cause | Fix |
|---|---|---|---|
| session9 "account menu … switches" | Test (outdated) | Since D-411 the Admin sidebar groups start folded; "Users & roles" is not rendered until People & organisation is opened. | The test opens the group like a person, checks `aria-expanded`, then the link. |
| v139-draft-task "a centred two-column card" | Test (race) | The window was measured 3.8 px off centre while its scale-in still ran. | `motionSettled()` (all finite animations finished) before measuring; the 2 px bound kept. |
| v1720-layout-parity "task pane ⋯ menu" | **App bug** | The pane's entry animation left `translate: 0px` (fill `both`); the fixed menu was positioned relative to the pane: x 1558 on a 1280 window, invisible. | Entry fill `backwards`; `fixedOrigin` sees `translate`; re-measure after motion. |
| v1722-visual "axe (light)" | Test (outdated) | At 375 a task opens its own page (D-410: no pane on phones); the step expected the pane. | Phones: the task page and its h1, axe on the page; computers: the pane. |
| v1750-date-picker "phone bottom sheet" | **App bug** + race | Same containing-block bug (sheet inside the Create task window: 341 wide mid-animation, 17 px above the bottom once settled). | As v1720; the test measures after `motionSettled()`. |
| v190 "assignee hears through the bell" | Test (outdated) | Since D-410 the bell opens a task in the pane (`?task=`). | Asserts the pane (address, title), then continues on the full page. |

WebKit: **NAV-02 S12a** (the ~21 s): the test ended the session before WebKit had hydrated (Playwright's WebKit on Windows hydrates 5-7 s after load), so only the pane's 20 s live refresh noticed; for people the check runs at once when they come back to the tab and every 60 s, which is enough for an ended session (any action also goes to the signed-out page). The test now waits for `data-session-watch`; the 20 s limit is unchanged. **NAV-03** (flake): the list link was clicked before PlaceMemory's Suspense boundary hydrated; `settle` waits for `data-place-memory`. **OVL-01**: same hydration timing.
