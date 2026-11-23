# Header action bar and motion/navigation audit (report only)

**Date:** 23 Nov 2026. **Build:** v1.85.3 (`270d12f`), branch `audit-header`. **Scope:**
- Brief 1: "Cross-Module Header Action Bar Visibility & Component Rendering Inconsistency".
- Brief 2: "Global Smooth Motion, Navigation Continuity & Interaction Experience System", phase 1 (audit and gap analysis only).

The audit itself changed nothing in the app. The fixes came after it (see Fix status).

## Fix status

Updated as items are fixed. **Fixed** means a test or a measurement shows it (named in the last column).

| ID | Item | Status | Release | Shown by |
|---|---|---|---|---|
| H-01 | + Add widgets and Customise vanish (Task Management ↔ Meetings) | **Fixed** | v1.86.0 (D-416) | e2e `v1860-header-consistency` H-01 (every ordered pair; 1440 user, 1024 IT admin, 768 Super Admin) |
| H-02 | Customise carries into the next overview | **Fixed** | v1.86.0 | e2e H-02 |
| H-03 | Custom period carries over | **Fixed** | v1.86.0 | e2e H-03 |
| H-04 | Insights tabs past the edge at 768 / 375 | **Fixed** (wrap from 768; fade cue at 375) | v1.86.0 | e2e H-04 |
| Gap 14 | Unsent-draft guard in the panes | **Fixed** for Escape, ×, backdrop and links. Browser Back is not intercepted. | v1.86.0 | e2e gap 14; unit `pane-draft.test.ts` |
| Gap 16 | Scroll jump when the pane opens | **Not a defect.** The probe clicked a link above the viewport, and Playwright scrolls an element into view before clicking. With the link in view the page stays put. | v1.86.0 | e2e gap 16 (≤ 40 px) |
| Gap 21 | Regression e2e for H-01..H-03 | **Done** | v1.86.0 | `v1860-header-consistency.spec.ts` |
| Gap 22 | Hub tabs affordance | **Fixed** (= H-04) | v1.86.0 | e2e H-04 |
| Gaps 1–13, 15, 17–20, 23, 24 | P2 and P3 | Planned | v1.87.0 | — |

**Evidence after the fixes:** the probe spec `zz-audit-header.spec.ts` was replaced by the regression spec `tests/e2e/v1860-header-consistency.spec.ts`. The 72 screenshots and the `.jsonl` files under `audit/header/` stay local evidence only. They are not committed (`audit/` is git-ignored).

## Evidence

**Spec:** `tests/e2e/zz-audit-header.spec.ts`. It is an audit probe and never fails on a finding. Run it alone:

```
TEST_DB_NAME=ars_approvals_test_au E2E_PORT=3230 E2E_MOCK_PORT=4131 npx playwright test tests/e2e/zz-audit-header.spec.ts --workers=1
```

**Output files** (under `audit/header/`):
- `probes.jsonl`: 1,127 probes. Each one records every control in the header zones:
  - computed `display`, `visibility` and effective opacity;
  - `checkVisibility()`, the bounding box and `elementFromPoint` at its centre;
  - whether it is clipped by an overflow ancestor, outside the viewport or disabled;
  - page overflow, the active sidebar item, the active home switcher choice and the widget-slot facts.

  The header zones are the top bar, the sidebar Create / toggle / Back to the app, the page header, the quick actions and the toolbars / tabs.
- `findings.jsonl`: every difference from a **fresh load of the same address** (same role and viewport), plus absolute problems found on a fresh load.
- `diagnosis.jsonl`: which DOM nodes React kept or replaced on the `?home=` switch.
- `motion.jsonl`: the Brief 2 preservation, race, leak and performance results.
- `shots/`: 72 screenshots, taken only where something was found.

**Runs:**
- 24 tests: 20 passed, and 1 timed out on a selector in my own spec (fixed and re-run).
- The re-run: 6 passed. A diagnosis re-run: 1 passed.
- Total about 42 minutes.

**What was covered:**
- **Roles:** user `E2E_MGR` (manager and approver), IT admin `E2E_ADMIN`, Super Admin `E2E_SUPER`. `E2E_STAFF` was also used for My Tasks.
- **Viewports:** 1440×900, 1280×800, 1024×768, 768×1024 and 375×812, plus 375×812 with the phone-layout cookie (`375m`).
- **Page transitions:** one pass with the `page_transitions` switch **On** (`*-pt` rows).
- **Moves:** every move is a real soft navigation. A visible link is clicked when there is one, otherwise the app router (`window.next.router.push`, the same code path) is used. A full load happens only where a step says "refresh".

**Sequences run** (numbers as in the brief):

| # | Sequence |
|---|---|
| 1 | Approvals → Task Management → Meetings → Approvals. Also every ordered pair of overviews (`S1b`). |
| 2 | Tasks → Approvals → Tasks |
| 3 | Meetings → Tasks → Meetings |
| 4 | An overview → request or task → Back |
| 5 | A → B → C → A in the users area, the Admin area and the Super Admin area, plus module page ↔ overview |
| 6 | Refresh |
| 7 | Back ×5 and Forward ×5 |
| 8 | `/users` → `/admin` → `/superadmin` → `/admin` → `/users` → `/admin/records/requests` → `/users/work/my-tasks` |
| 9 | Command palette, bell, Customise, record pane, task pane: open and close each |
| 10 | Sequence 1 repeated with no refresh |

## Brief 1: defect records

**Totals by class:**

| Class | Defects |
|---|---|
| 1 not rendered | 0 |
| 2 rendered but hidden | 0 |
| 3 outside the viewport | 1 |
| 4 disabled | 0 |
| 5 removed by a permission rule | 0 (all such cases are by design, see the expected design rules) |
| 6 wrongly removed during navigation | 3 |

**4 defects in total.** Every other finding in `findings.jsonl` falls into one of these:
- an overlay that is open and correctly covers the header (palette, bell dropdown, the pane window below 1024 px);
- a menu item inside a closed `<details>`;
- the phone Home;
- the pane's editor toolbar clipped inside its own scroll box.

All of these are explained in the expected design rules.

**No losses were found in these sequences:**
- Tasks ↔ Approvals ↔ Meetings module pages.
- A → B → C → A in all three areas.
- Back and Forward.
- Area switches (8).
- Closing overlays.
- Page transitions On, except H-01.

The active sidebar item and the active `?home=` choice matched the address in all 1,127 probes.

### H-01 (class 6, P1): "Cross-Module Header Action Bar Visibility & Component Rendering Inconsistency": **+ Add widgets** and **Customise** disappear when switching between the Task Management and Meetings overviews

| Field | Value |
|---|---|
| Module | Home overviews (`/users?home=`) |
| Start → destination | `?home=tasks` → `?home=meetings`, and `?home=meetings` → `?home=tasks`. The pairs with Approvals are not affected. |
| Missing controls | `[data-testid=add-widget]` ("+ Add widgets") and `[data-testid=customise-home]` ("Customise") |
| Roles | user, IT admin, Super Admin (all three) |
| Viewports | 1440, 1280, 1024, 768, and 1440 with page transitions On. Not 375: that is the phone Home, which has no widgets by design. |
| In the DOM? | **No.** At the fresh load the button had `display:flex`, `visibility:visible`, opacity 1, box `x1289 y263 119×36`, and `elementFromPoint` was the button itself. After the switch, `document.querySelector` returns null. |
| Diagnosis (`diagnosis.jsonl`) | Tasks → Meetings, and the reverse: `slotSameNode:false`, `oldSlotConnected:false`, `boardSameNode:true`, `oldCustomiseParentIsOldSlot:true`, `newSlotChildren:0`. React **kept the HomeWidgets instance** (same `ul` node) but **replaced the slot `<div id="home-widgets-toolbar-slot">`**. The toolbar is still portalled into the old slot, which is now detached. With Approvals the board is remounted (`boardSameNode:false`), so the effect runs again and the toolbar shows. |
| Repro | Sign in, open `/users?home=tasks`, click **Meetings** in the switcher. Add widgets and Customise are gone until a refresh. 48 occurrences (S1, S1b, S10, PT). |
| Screenshot | `audit/header/shots/user-1440-S1-home-2_users_home_meetings.png` (also `*-S10-*`, `*-S1b-*`, `itadmin-*`, `super-*`) |

**Root cause:**
1. `features/home/HomeWidgets.tsx:58-59`:

   ```ts
   const [slot, setSlot] = useState<HTMLElement | null>(null);
   useEffect(() => setSlot(document.getElementById("home-widgets-toolbar-slot")), []);
   ```

   The slot is looked up once, on mount (`[]` deps). `:181` `return slot ? createPortal(toolbar, slot) : toolbar;` keeps writing into the stale node.
2. Two different quick-action rows render the slot:
   - `features/home/QuickActions.tsx:31` (Approvals, Meetings): the slot is child 2, after the links array.
   - `features/home/MyWorkOverview.tsx:637-645`, its own inline `<nav>`: the slot is child 7 and has no `reserve-widget-tools` class.

   React reuses the `<nav>` but not the slot div. Meanwhile `<div className="mt-6"><HomeWidgets/></div>` lands at the same tree position in My Work (`:650-660`) and Meetings (`features/meetings/MeetingHome.tsx:402-404`), so HomeWidgets is reused. HomeWidgets also has no `key`.

**Recommended correction (no redesign):**
- (a) Make My Work use the shared `QuickActions` (one implementation; its `CreateTaskQuick` can be passed as the first item or a `lead` prop).
- (b) Give the board a `key={scope}` in all three overviews, so each overview owns its board state.
- (c) Make the slot lookup robust: re-query in a `useLayoutEffect` whenever `!slot?.isConnected` (or on `scope` change), or replace the id lookup with a ref or context passed from the row.
- Add the probe from this spec (switch every ordered pair, assert `customise-home` and `add-widget` are visible) to `v1790-overview-parity.spec.ts`.

### H-02 (class 6, P1): the Customise (edit) mode carries into the next overview with no way to finish

| Field | Value |
|---|---|
| Module | Home overviews |
| Start → destination | `?home=tasks` with Customise on → `?home=meetings` |
| Missing control | **Done** (the pressed Customise button), plus Reset and Add widgets |
| Role and viewport | user, 1440 (same mechanism as H-01, so every role and every viewport from 768 up) |
| In the DOM? | No (`customiseInDocument:0`). The Meetings board **does** show the 8 edit handles (`handles:8`). The person is left in edit mode on an overview whose Done button no longer exists. Only a refresh ends it. |
| Screenshot | `audit/header/shots/diag-editing-carried-tasks-to-meetings.png` |

**Root cause:** the same reused HomeWidgets instance as H-01. `editing`, `lifted` and `live` (`HomeWidgets.tsx:45-50`) are not reset when `scope` changes. Only `layout` and `version` are re-synced (`:51-55`).

**Correction:** fixed by H-01 (b), `key={scope}`.

### H-03 (class 6, P1): the date (period) selector keeps "Custom period" and its From/To form after the overview switch

| Field | Value |
|---|---|
| Module | Home overviews |
| Start → destination | `/users?home=approvals&period=custom&from=2026-11-01&to=2026-11-10` → **Task Management**, then → **Meetings** |
| Control | `[data-testid=period-picker]` |
| Role and viewport | user, 1440 (any role, any viewport from 768 up) |
| In the DOM? | Yes and visible, but in the **wrong state**: the address has no `period` (the overview shows its default period), yet the select reads **Custom period** and the From/To form is still shown (`selectValue:"custom", customFormShown:1`). |
| Screenshot | `audit/header/shots/diag-period-custom-stale-tasks.png`, `…-meetings.png` |

**Root cause:** `features/home/HomeClient.tsx:40`:

```ts
const [custom, setCustom] = useState(value === "custom");
```

This initialises from props only once. PeriodPicker is reused across overviews (`OverviewParts.tsx:70`, no key) and never re-reads `value`. The switcher links (`app/users/(home)/page.tsx:236-239`) drop `period`, which is correct: each overview has its own default.

**Correction:** key the picker with `key={`${periodBase.home}:${value}`}`, or derive it (`const showCustom = custom || value === "custom"` with a reset effect on `value`).

### H-04 (class 3, P3): Admin → Insights tabs run past the right edge at 768 px with no sign that they scroll

| Field | Value |
|---|---|
| Module | Admin / Insights, `/admin/insights` (fresh load) |
| Missing controls | the **Workload** and **AI analytics** tabs at 768. At 375, **Reports** too. |
| Roles | IT admin, Super Admin |
| Viewports | 768, 375 |
| In the DOM? | Yes and visible, but `right > innerWidth`. There is no page overflow: they are inside `nav.overflow-x-auto` (`features/ui/HubTabs.tsx:14`) and can be reached by a sideways swipe or scroll only. Nothing shows that more tabs exist. |
| Screenshot | none (not navigation-related). The facts are in `findings.jsonl`, `seq:"baseline"`, `url:"/admin/insights"`. |

**Root cause:** the sideways scroll is intended on a phone (comment at `HubTabs.tsx:9`). At tablet width it hides 2 of 6 tabs with no affordance.

**Correction:**
- a fade or "more" cue at the clipped edge;
- `scrollIntoView({inline:"nearest"})` on the active tab;
- or wrap from `md` up.

### Expected design rules (not defects)

1. **Phone Home (≤ 767 px).** Below 768 px, `LayoutSync` switches to the phone layout by itself (`lib/ui/layout.ts:4` `MOBILE_MAX_WIDTH = 767`, `features/mobile/LayoutSync.tsx:15`). The phone Home has none of these:
   - the overview header, the switcher and the period picker;
   - quick actions, Add widgets and Customise.

   The phone layout has the mobile top bar (search, bell, account) and the tab bar. v1.79.0 says "the phone layout is unchanged". These show as class-1 "not rendered" rows at `375`, `375m` and `375-pt` in `findings.jsonl`; they are by design.
2. **Sidebar.** The sidebar (Create, Collapse, Back to the app) is `hidden md:flex` (`features/shell/SidebarFrame.tsx:55`). Below 768 px the menu button (`MobileNav`) takes its place. In the panels at 375, the sidebar toggle and Back to the app are in the DOM but hidden; Back to the app is in the MobileNav footer.
3. **Search bar.** The search bar becomes an icon below `sm` (`features/shell/CommandPalette.tsx:303`, `:317`).
4. **Area differences:**
   - **Create** (sidebar) is in the users area only (`AppShell.tsx:273`).
   - **Back to the app** and **Search settings** appear in the panels only (`AppShell.tsx:244-248`, `:276-280`).
   - The `?home=` switcher and the period picker are on the overviews only.
5. **Permission rules (class 5):**
   - The `?home=` switcher shows only when the person has more than one overview (`page.tsx:217`).
   - Approvals quick actions leave out pages the person can't open (`isHiddenHref`, `page.tsx:208`).
   - **Create** items follow page access (`AppShell.tsx:273`).
   - `/admin` is for IT_ADMIN and SUPER_ADMIN; `/superadmin` is for SUPER_ADMIN only (`server/authorization/policy.ts:6-10`).
   - "Switch space" lists only the person's areas (`ProfileMenu.tsx:64`).
6. **Feature switch.** Add widgets and Customise need the `pm_foundations` switch (`server/home/home-service.ts:53-57`, `widgets.editable`). Without it, the fixed layout shows and the buttons don't.
7. **Overlays.** An open overlay correctly covers the header:
   - the command palette (modal `<dialog>`) and the bell dropdown;
   - the task pane and record pane, which are a centred window below 1024 px (v1.83.0).

   Every control was back, unchanged, after each overlay closed (`S9-overlays … closed` rows have no findings).
8. **Turning Customise on.** Customise → **Done** plus **Reset** moves the row slightly (an alignment row of class 0).
9. **Closed menus.** Menu items inside closed Sort, Group and Page-size `<details>` (queue, records, meetings, admin) are in the DOM but not visible until opened.
10. **The editor toolbar** in the task pane is clipped by the pane's own scroll box (it is not a header).

## Brief 2: phase 1 audit and gap analysis

### Architecture inventory

**Framework and routing:**
- Next.js 15.5 App Router, React 19.
- Three area layouts call `requireArea` and render `AppShell`: `app/users/layout.tsx`, `app/admin/layout.tsx:16-25`, `app/superadmin/layout.tsx:16-24`.
- The users area has a **parallel route** `app/users/@pane` (the `?task=` pane, `[...rest]/page.tsx:32-52`, `TaskPane key={taskId}`) and `TaskPaneHost`.
- Role checks happen on the server only:
  - `middleware.ts` checks only that the cookie is present (`:130-147`) and does 308s for old addresses.
  - `requireArea` → `evaluateAreaAccess` → `AREA_ROLES` (`server/authorization/guards.ts:23-53`, `policy.ts:6-10`).

**Shell (`features/shell/AppShell.tsx`):**
- `SidebarFrame` and `SideNav`; the top bar holds `CommandPalette`, `NotificationBell` and `ProfileMenu`; `MobileNav` is used below `md`.
- `NavigationProgress`, `NavMemory`, `PlaceMemory`, `PageTransitions` (only with the switch on, `:234`, `:373`) and `RowKeys`.

### Component inventory

Status key:
- **Done** = built in v1.80 or later and working.
- **Partly** = some of the brief's requirements are met.
- **Missing** = not present.
- **Inconsistent** = duplicate implementations of the same thing.

| Item | Status | Facts |
|---|---|---|
| Motion tokens (`styles/globals.css:53-66`) | **Inconsistent** | Two sets side by side: `--motion-fast/base/slow` 120/200/320 + `--ease-standard (0.2,0,0,1)`, and the v1.80 set hover 120, menu 190, dialog-in 220, dialog-out 160, page 120 + `--ease-out (0.16,1,0.3,1)`. Tailwind exposes only fast/base/slow and `standard` (`tailwind.config.ts:82-83`). There are no distance tokens. |
| Ad-hoc timings | **Inconsistent** | `transition-all`: 2 (`features/help/OnboardingTour.tsx:239`, `:263`); `transition: all`: 0. Raw `duration-*`: 7 of 10 uses don't use tokens (`SidebarFrame.tsx:55` 150, `Loaders.tsx:81`/`:103`, journey 500–1200). CSS: `auth-enter` 320 ms `(0.22,1,0.36,1)`, `.mob-sheet` 0.22 s, `.mob-switch` 0.15 s, PicBot with 2 more beziers (`globals.css:530`, `:1067-1119`). |
| Reusable fade / slide / scale / expand / stagger utilities | **Partly** | Keyframes exist per component (`ars-dialog` `:1624-1690`, `menu-in` `:1713`, fold reveal `:1742`, `toast-in` `:470`). There are no shared utility classes and no stagger. |
| Reduced motion | **Done** | A global `*` rule at 0.01 ms (`globals.css:306-313`); dialogs keep a 100 ms fade (`:1825`); page transitions are skipped (`PageTransitions.tsx:43`); 15 JS `matchMedia` checks. |
| Dialog (`features/ui/Dialog.tsx`) + `top-layer.ts` | **Done** for Dialog | Native `showModal`; exit animation via `closeTopLayer`; focus returns to the opener; a discard-draft guard. `top-layer.ts` is an exit-animation helper, **not a stack**. |
| Other modals | **Inconsistent** | About 20 `role="dialog"` divs that don't use Dialog: `BottomSheet`, `MobileNav`, `PicBot`, `OnboardingTour`, `InstallInvite`, `TaskCreator:306`, `CustomizePanel:61`, `PowerSearch:112`, `FieldControls`, `GridCellEditors`. Native dialogs with their own `showModal` and plain `.close()` have no exit animation: `CommandPalette` (no `ars-dialog` class at all), `work/client.tsx`, `PaneParts`, `ProjectHeader`, `ShareDialogs`. |
| Overlay stack (Escape / outside click on the top-most only) | **Missing** (patched case by case) | 39 files handle Escape and there are 20 document- or window-level keydown listeners. Each checks `dialog[open]` or `defaultPrevented` in its own way: `TaskPaneHost.tsx:45-52`, `RecordPane.tsx:33-37`, `BottomSheet.tsx:25` (no top-most check), `Drop.tsx:26-32` (no `preventDefault`). **Observed:** a menu in the pane plus Escape closes only the menu; the palette over the pane plus Escape closes only the palette. |
| Focus trap / return | **Partly** | Native modal dialogs are inert outside. There are 3 hand-made Tab traps (`MobileNav:35`, `OnboardingTour:191`, `MenuCore:218`). The task pane and record pane have no trap. Focus return works on the panes (observed: back to the task link). |
| Scroll lock | **Partly** | Native modal dialogs and `BottomSheet` (`body.style.overflow`) lock scroll. **The pane in dialog mode (⤢) does not:** observed `body overflow: visible`, main not inert. |
| Double-submit on confirmations | **Partly** | `useActionForm` has a `busy` ref (`form.tsx:179-214`). `ConfirmButton` uses state only (`:27`, `:37`). `ConfirmDialog` disables Cancel while busy, but Escape, × and the backdrop can still close it (`Dialog.tsx:242`). |
| BottomSheet (`features/mobile/BottomSheet.tsx`) | **Partly** | `mob-sheet` animates in; no exit animation (returns null at `:36`); swipe to close (`swipe.ts`); no Tab trap. |
| Menu / MenuCore | **Done** | `.menu-pop` unfolds; its own Escape and outside click; refocuses its button. |
| Drop (`<details>`) | **Partly** | Fades in; Escape without `preventDefault`. |
| TaskPane / TaskPaneHost (v1.83) | **Partly** | No enter or exit motion; Escape, URL state, refresh and Back work. Close **pushes** a history entry. No unsent-draft guard. |
| RecordPane (v1.85) | **Partly** | No motion and no trap; its mode is kept in localStorage. Escape after Back was ignored in 1 of 2 runs (IT admin). |
| Toast | **Done** | `toast-in`; portalled into the top modal (`useTopModal`, `Toast.tsx:78-100`, the only stack-like code). |
| CommandPalette | **Partly** | Native modal; no enter or exit motion. |
| NotificationBell dropdown | **Missing** motion | A div `role=dialog`; its own Escape and outside click; focus returns; no animation. |
| DateRangePicker / PeoplePicker / PersonSelect | **Missing** motion | Their own Escape and outside-click handlers; no enter or exit animation. |
| Tooltips (`Hint.tsx`) | **Missing** motion | CSS `::after` from `data-tip`; no delay or fade. The collapsed sidebar uses native `title` only. |
| Sidebar | **Partly** | Width animates 150 ms; the state is kept in the cookie `ars_sidebar` and the open groups in localStorage. **Missing:** fixed icons on collapse (the content is swapped, `SidebarFrame.tsx:78-103`), a label fade and slide, a moving active indicator (a static background, `SideNav.tsx:186`), animated group expand (the `hidden` attribute), and real tooltips. |
| Page transitions (`PageTransitions.tsx`) | **Done**, switch Off | View Transitions API; no key on pathname (no remounts); skipped after 300 ms; focuses `main h1`. Run with the switch On: no blank flash, and the same results as Off (H-01 still happens). |
| NavigationProgress / skeletons / pending dim | **Done** | A bar after 150 ms, `html[data-nav-pending]` dims tables, skeletons by route. |
| PlaceMemory (back keeps place) | **Partly** | Saves `{y, href}` only when the link goes to **another path** and only `window.scrollY`. Not saved for `?task=` / `?open=` panes, inner scroll boxes, folds or selection. |
| NavMemory / BackLink | **Partly** | `BackLink` uses `history.back()` after an in-app move. Request breadcrumbs and `NavOwner` are **static hrefs** with no list query (`app/users/requests/[id]/page.tsx:178-193`). |
| UnsavedGuard (discard draft) | **Partly** | 9 forms; listens to link clicks and `beforeunload`. Not in `features/work`, the panes, `router.push` or popstate. |
| RowKeys (J/K) | **Done** | |
| GroupFold / section folds | **Partly** | `useState` only (`GroupFold.tsx:18`); lost after leaving the page (observed). |
| `GLOBAL_MOTION_NAVIGATION_IMPLEMENTATION.md` | **Missing** | |

### Token comparison and recommendation

| Owner | Current | Recommendation |
|---|---|---|
| 100 ms | none (reduce-motion fades are 100 ms; `--motion-fast`/`--motion-hover` are 120) | **Adopt**: hover/press 120 → 100 |
| 150 ms | sidebar 150 (raw), `.mob-switch` 0.15 s | **Adopt** as the menu / tooltip / dialog-exit token: menu 190 → 150, dialog-out 160 → 150, page 120 → 150 |
| 220 ms | `--motion-dialog-in` 220, `.mob-sheet` 0.22 s | Same value: keep, rename to the scale |
| 280 ms | none | **Adopt** for drawers, panes and sheets |
| 350 ms | `--motion-slow` 320, auth-enter 320 | **Adopt**: 320 → 350 |
| 450 ms | none | **Adopt** for large page or hero moves only (never under reduced motion) |
| `--motion-base` | 200 | Map to 220 |
| standard `cubic-bezier(0.22,1,0.36,1)` | `--ease-standard (0.2,0,0,1)`; the owner's curve is already used by `auth-enter` | **Adopt the owner's value** for `--ease-standard` |
| enter `(0.16,1,0.3,1)` | `--ease-out (0.16,1,0.3,1)` | **Identical**: rename or alias to `--ease-enter` |
| exit `(0.4,0,1,1)` | none (exits use the enter curve or linear) | **Adopt** as `--ease-exit` |
| distances 2/4/8/16/24–32 px | none as tokens (dialog 8 px rise and similar are inline in keyframes) | **Adopt** `--motion-distance-1…5` |

Adopting the owner's scale is recommended:
- It is a superset of what is in use: 220 and the enter curve are already identical.
- The changes are 10–40 ms, below what people notice, and the reduced-motion rules are unchanged.
- Keep one set: retire `--motion-fast/base/slow` as aliases of the new names, and expose the new names in Tailwind.

### Preservation scenario results (1440 px, no refresh)

**Super Admin and IT admin on Admin → Records:** filter chip "contains Audit" → sort → open row (pane) → Open full page → comment (save) → browser Back.

| Step | Kept | Lost |
|---|---|---|
| Filter, sort | `?q=Audit&dir=asc`, the chip | none |
| Row → pane | `?open=1` added, focus in the pane | none |
| Open full page | none | **The area changes from `/admin` to `/users`** (`/users/requests/1`, the users sidebar). The page's way back names **Search** (`/users/search`), not Admin Records (`requests/[id]/page.tsx:189`, the `backTo` fallback). |
| Comment saved | the page; scroll jumps to the comment (727 / 774 px) | none |
| Browser Back | filter, sort, chip; the pane is **reopened** (`?open=1`) | focus (was on the sort link) |
| Escape | Super Admin: the pane closes, focus goes back to the row link | IT admin: **Escape ignored** after Back (the pane stayed, `?open=1`). Seen once in 2 runs: an intermittent defect. |

The role never switched and no authorisation was bypassed. `/users/requests/1` is opened by IT through its own server checks.

**User on My Tasks (`E2E_STAFF`):** fold "Completed today" closed, scrolled to y=1131 → open task (pane) → comment → × close → reopen → Open full page → Back → Back.

| Step | Result |
|---|---|
| Open pane | **Scroll jumps from 1131 to 135** (the page moves when the pane opens) |
| Comment in pane | saved; focus falls to `body` |
| × close | URL back to `/users/work/my-tasks`, focus on the task link (good), fold kept. **Scroll lost** (135, not 1131). **A history entry is added** (2 → 4; close uses `router.push`). |
| Full page → Back | returns to `?task=1` with the **pane reopened** |
| Back again | the list, but **the fold I closed is open again** (expanded 8 → 10) and scroll stays lost |

**Manager on Waiting for me:** sort by title → open request → comment → browser Back, then the in-page link.

| Step | Result |
|---|---|
| Browser Back | `?sortBy=title&dir=asc` kept; the row is highlighted (`data-row-current`) and focused (PlaceMemory works) |
| In-page link (breadcrumb "Waiting for me") | **Sort and order lost** (`/users/queue`, static href); focus to `body` |
| Search box | the queue has no plain search input in view (behind "Search this view" / filters), so the free-text filter was not exercised |

### Race cases

| Case | Result |
|---|---|
| Double-click a task link | 1 pane, 1 history entry: OK |
| Double-click × | 1 history entry, pane closed: OK |
| Escape straight after Send | The pane closes. The comment **is** saved (1 → 2). No "still saving" hold, so the person doesn't see the result. |
| Escape with an unsent comment draft | **Closed with no question; the draft is lost** (no UnsavedGuard in the panes) |
| Back while the pane is open | The pane closes; Forward reopens it: OK |
| Refresh with `?task=` | The pane is still open, focus in the pane: OK |
| 5 rapid `router.push` moves | It ends on the last address with the right heading: OK |
| Late API response after close | Not applicable: the panes are server-rendered with no client fetch (`TaskPane key={taskId}`). There are 3 client `AbortController`s in the app. `LiveRefresh` (15 s) skips while a dialog is open. |
| Pane as dialog (⤢) | `body` scrolls behind it (no scroll lock), `main` is not inert. Tab ×3 stayed in the pane (inconclusive: no trap in the code). |

### Performance

| Measure | Result |
|---|---|
| 15 × open/close of the pane | DOM nodes 1,444 → 1,444, JS heap 44.7 MB → 44.7 MB, dialog count 6 → 6: **no leak and no orphaned overlays** |
| CLS over 3 overview switches and 3 module moves | cumulative 0.022 (the overview switches add 0.003) |
| Long tasks | 0 |
| Soft move time | 460–650 ms |

### Gap list against the owner's brief (24 items; build only these)

**Tokens and utilities**
1. One token scale with the owner's durations, easings and distances. Retire the duplicate set and expose it in Tailwind.
2. Shared fade, slide, scale, expand and stagger utility classes (transform and opacity only). Move the about 10 raw durations, the 2 `transition-all` and the ad-hoc CSS timings onto the tokens.

**Sidebar**

3. Fixed icon column on collapse (no content swap).
4. Labels that fade and slide.
5. Moving active indicator.
6. Animated nested-group expand (replacing `hidden`).
7. Real tooltips when collapsed.

**Floating parts and menus**

8. Enter and exit motion for the bell dropdown, CommandPalette, DateRangePicker, PeoplePicker / PersonSelect and Hint tooltips. Add an exit animation for BottomSheet and the native dialogs that call `.close()` directly.

**Panes**

9. Enter and exit motion for TaskPane and RecordPane (side and dialog modes).

**Overlay stack**

10. One overlay stack: Escape and outside-click go to the top-most only; replace the 20 document listeners.
11. A focus trap for the panes in dialog mode, `MobileNav`-style sheets and BottomSheet.
12. Scroll lock and `inert` behind the pane dialog mode.
13. `ConfirmDialog`: no closing while busy. `ConfirmButton`: a ref guard.

**Unsaved work**

14. Unsent-draft guard in the task pane and record pane (Escape, ×, Back), covering `router.push` and popstate too.
15. A "saving…" hold so Escape during a save doesn't hide the result.

**Navigation state**

16. Opening the task pane must not move the page (scroll jump 1131 → 135).
17. Closing a pane should not add a history entry (replace, or `history.back()` when it was opened in this tab), so Back doesn't reopen it.
18. PlaceMemory for same-path panes, inner scroll boxes and fold state. GroupFold state per page in sessionStorage.
19. Breadcrumbs and Back on detail pages return to the list the person came from **with its query**: the queue sort, and Admin Records instead of "Search". Remember the origin across `/admin` → `/users` (NavMemory), never by changing roles.
20. RecordPane Escape after Back (intermittent).

**Header (Brief 1)**

21. Fix H-01, H-02 and H-03; add a regression e2e.
22. Hub tabs scroll affordance (H-04).

**Page transitions, tests, docs**

23. Decide on the default for page transitions. It works with the switch On; owner's call.
24. Tests: unit tests for the stack, guard and token rules; e2e for the preservation scenarios above; `GLOBAL_MOTION_NAVIGATION_IMPLEMENTATION.md`.

**Already done, do not rebuild:**
- dialog and drawer motion, menus, folds;
- pending links, skeletons, toasts;
- J/K, swipe sheets, reduced motion;
- page transitions;
- Back keeps place on cross-path lists;
- pane URL, refresh and Back;
- no leaks.

## Prioritised fix plan

**P1, about 1.5 days** (header defects and data-loss risks):
- H-01 and H-02 together (shared `QuickActions` in My Work, `key={scope}` on HomeWidgets, slot re-query or ref): 0.5 d.
- H-03 (PeriodPicker key or derived state): 0.1 d.
- Gap 14 (unsent-draft guard in the panes) and gap 16 (no scroll jump on pane open): 0.5 d.
- E2E regression from this spec (every ordered overview pair × 4 viewports; preservation basics): 0.4 d.

**P2, about 4 days** (navigation continuity and overlay stack):
- Gaps 10–13 (one overlay stack, trap, scroll lock, confirm busy): 2 d.
- Gap 17 (pane close without a history entry): 0.3 d.
- Gaps 18–19 (place, fold and origin memory; breadcrumbs with query; Admin Records origin): 1.2 d.
- Gap 20: 0.2 d.
- Gap 15: 0.3 d.

**P3, about 4 days** (motion polish):
- Gaps 1–2 (tokens and utilities, migrating ad-hoc timings): 1 d.
- Gaps 3–7 (sidebar motion): 1.2 d.
- Gaps 8–9 (floating parts, panes): 1 d.
- Gap 22: 0.2 d.
- Gap 24 doc and unit tests: 0.6 d.
- Gap 23: owner decision only.

**Total about 9.5 days.** No schema or API change and no new dependency is needed. Roles and authorisation are untouched: all fixes are client-side and keep the server checks.
