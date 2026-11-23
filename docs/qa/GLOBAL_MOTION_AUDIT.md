# Global motion audit (owner's motion brief, 24 Nov 2026): audit only

**Date:** 24 Nov 2026. **Build:** v1.88.0 (`893fb4b`). **Status:** an audit. **No motion was changed.**

## Fix status (v1.89.0 stage 2, D-420)

| Finding | Status | Where / how |
|---|---|---|
| §1 Token conflict (new brief vs D-417) | **Fixed** | New scale and easings in globals.css + `features/ui/motion.ts`; roles page 200, modal / drawer 250, dropdown 150; v1.87 names retired; Tailwind DEFAULT set (GLOBAL_MOTION_TOKENS.md) |
| §1 point 5: hard-coded timers | **Fixed** | PicBot, LandingWelcome, SidebarFrame, LiveNumber, NextFlash, PlaceMemory, NavigationProgress, Classic, pane-close, celebrate, OnboardingTour, PageTransitions read the mirror; top-layer cap named |
| §1 point 6: raw CSS values | **Fixed** (exceptions documented) | `--t-*`, picbot curve, `duration-150`, InstallInvite, AssistantForm, reduce 100 ms, stagger, tooltip delay → tokens; loops and the journey's scene timings are documented exceptions |
| §1 point 7: wrong comments | **Fixed** | PageTransitions, globals (120 / 160), GroupFold (190), NavIndicator (220) |
| §2 Missing / abrupt transitions (14) | **Mostly fixed** | Skeleton swap, raw dialog exits, `role=dialog` divs, Create task window, toasts' exit, PeoplePicker / PersonSelect. Kept instant on purpose: dropdown / menu / bell closes (reason in GLOBAL_MOTION_DESIGN_SYSTEM §5). Deferred: new comment entrance, drag-and-drop drops, file preview content during the exit |
| §2 Width / height / top / left animations (11) | **Fixed** | Sidebar (no width animation), tour spotlight and progress, phone tab pill, journey vans and fill, Display / StepMap / ApprovalRoad / Loaders bars: all transform; a unit test forbids new ones |
| §2 Reduced motion (2 confirmed) | **Fixed** | Field and ReadinessPanel use `scrollBehavior()`; a unit test forbids an unguarded smooth scroll; bouncing dots replaced by an opacity fade |
| §2 Unused motion code | Kept | `.motion-slide-up` is now used (install invite); the others stay as shared classes and are shown in the Motion Playground |
| §3.1 Mismatched dropdown easings | **Fixed** | menus, folds and `pop-in` all use the enter easing |
| §3.1b / §3.2 Sidebar and content | **Fixed** (alt.) | one-step width change, labels fade in at the same time (MOT-03) |
| §3.3 MOT-01 "Transition was skipped" | **Fixed** | every transition promise handled; e2e asserts no page errors |
| §3.3 MOT-02 WebKit crash | **Fixed** | root cause: the update callback held the old picture up to 4 s after a skip; now ends at 300 ms; GLOBAL_MOTION_DESIGN_SYSTEM §3 |
| §3.3 Scroll after Back with the switch ON | **Measured** | Back is not animated; e2e "Back restores the list's place" passes (scrollY 673 after Back in Chromium) |
| §3.4 CLS Analytics (0.25-0.55) | **Fixed** | 0.000-0.021 measured (Chromium); two causes: the page bar inserted above the sections, and a hidden `grid` section that stayed visible |
| §3.4 CLS Task Summary with a task (0.36-0.38) | **Not reproduced** | 0 measured at 1280 / 1366 / 1440 for a staff member and a manager on the test database; guarded by the e2e (see PERFORMANCE_VALIDATION) |
| §4 Page transitions ON | **Done** | default ON, fade + 4 px rise, Back / Forward instant, switch = kill switch |
| §5 Motion Playground | **Done** | `/superadmin/dev/motion`, Super Admin only (404 for everyone else, no title leak); no extra switch was added (Super Admin only is enough; the page changes nothing) |


**Full transition inventory:** [GLOBAL_TRANSITION_INVENTORY.md](GLOBAL_TRANSITION_INVENTORY.md). It covers the 50 areas, each with file:line, current, appropriate?, the recommended token and property, and the risk.

**Background (not repeated here):**
- `docs/qa/HEADER-AND-MOTION-AUDIT.md`, the motion audit of 23 Nov (gaps 1-24);
- `docs/GLOBAL_MOTION_NAVIGATION_IMPLEMENTATION.md`, v1.87.0 (D-417).

**Measured evidence:**
- `audit/ui-qa/probes/chromium.json`, groups `motion`, `sidebar`, `transitions`, `overlays`, `pane`;
- `audit/ui-qa/probes/<browser>-overlays+…json`, the browser subset;
- `audit/ui-qa/probes/chromium-cls.json`.

## 1. Token conflict: the 24 Nov brief against v1.87 (D-417)

D-417 (23 Nov 2026) adopted the owner's previous scale. The new brief changes it again. **This needs a new decision number:** it supersedes D-417's values.

| Name (brief) | Brief | Current token (v1.87) | Current value | Change |
|---|---|---|---|---|
| instant | 100 ms | `--motion-instant` | 100 | none |
| fast | 150 ms | `--motion-fast` | 150 | none |
| standard | **200 ms** | `--motion-base` | 220 | -20 ms; rename base → standard |
| smooth | **250 ms** | `--motion-moderate` | 280 | -30 ms; rename moderate → smooth |
| emphasis | **300 ms** | `--motion-slow` | 350 | -50 ms; rename slow → emphasis |
| (none) | — | `--motion-slower` | 450 | **Retire.** It is used by the `ApprovalRoad` fill (`ApprovalRoad.tsx:35`, `motion-safe:duration-slower`) and `MOTION_ROLE.hero`. Map those to emphasis 300. |
| Easing standard | **`cubic-bezier(0.2,0,0,1)`** | `--ease-standard` | `(0.22,1,0.36,1)` | The character changes from an expressive ease-out to Material's standard curve. Used 14 times in `globals.css`. |
| Easing enter | **`cubic-bezier(0,0,0.2,1)`** | `--ease-enter` | `(0.16,1,0.3,1)` | A softer decelerate. Used 17 times. |
| Easing exit | `cubic-bezier(0.4,0,1,1)` | `--ease-exit` | `(0.4,0,1,1)` | none |
| Role: page | 200 | `--motion-page` → fast | 150 | +50 ms (page = standard) |
| Role: modal | 250 | `--motion-dialog-in` → base | 220 | +30 ms (modal in = smooth); out stays fast 150 |
| Role: drawer | 250 | panes / sheets → moderate | 280 | -30 ms (drawer = smooth) |
| Role: dropdown | 150 | `--motion-menu` → fast | 150 | none |

**Every place that changes** (one source; the rest follows):

1. **`styles/globals.css:57-79`.**
   - The scale and easings.
   - The aliases `--motion-hover/menu/dialog-in/dialog-out/page`, mapped to the new roles.
   - Optionally add `--motion-standard`, `--motion-smooth`, `--motion-emphasis`, keeping `base`, `moderate` and `slow` as aliases for one release.
2. **`features/shell/motion-rules.ts:50-71`.** `MOTION_DURATION`, `MOTION_EASE`, `MOTION_ROLE` (pane / sheet → smooth, dialogIn → smooth, page → standard, emphasis → emphasis, hero → emphasis).
3. **`tailwind.config.ts:83-84`.**
   - `transitionDuration` (add `standard`, `smooth`, `emphasis`) and `transitionTimingFunction`.
   - **Also set `DEFAULT`:** Tailwind's bare `transition*` falls back to 150 ms with `(0.4,0,0.2,1)`. Setting `transitionDuration.DEFAULT` = `var(--motion-fast)` and `transitionTimingFunction.DEFAULT` = `var(--ease-standard)` brings all of these onto tokens without touching components: about 51 bare `transition`, 12 `transition-colors`, 11 `transition-transform`.
4. **Tests that pin the values:**
   - `tests/ui/navigation-continuity.test.ts` (CSS = TS);
   - `tests/ui/motion-review.test.tsx`;
   - any e2e asserting durations: `v1870-motion-perf`, `v1800-motion`.
5. **Hard-coded timings tied to the old values:**
   - `PicBot.tsx:90` (220);
   - `LandingWelcome.tsx:19` (`LEAVE_MS = 200` against `.auth-leave` 220: today it navigates 20 ms early);
   - `pane-close.ts:76` (300 cap);
   - `SidebarFrame.tsx:43` (400 ms "just toggled" window);
   - `OnboardingTour.tsx:143` (350);
   - `NextFlash.tsx:8` / `PlaceMemory.tsx:73` (1600);
   - `LiveNumber.tsx:23` (600);
   - `celebrate.tsx:49,54`;
   - `Classic.tsx:160` and `NavigationProgress.tsx:83` (150).
   - Only `BottomSheet.tsx:41` reads `MOTION_DURATION` today.
6. **Raw CSS values outside the tokens:**
   - `--t-check 160 / --t-fill 120 / --t-pop 200` (`globals.css:121-123`, a private second scale);
   - `.picbot-in` `cubic-bezier(0.2,0.9,0.3,1.05)` (`globals.css:1132`);
   - `.jr-vanwrap` `cubic-bezier(0.45,0.05,0.25,1)` (`:1187`);
   - `jr-stamp` `(0.2,1.6,0.4,1)` (`:1245,1328,1339`);
   - `duration-150` in `.field-input` / `.pill-select` (`:336,346`);
   - `InstallInvite.tsx:99` (`fadeIn_200ms_ease-out`);
   - `AssistantForm.tsx:45-46` (`[animation-delay:…]`);
   - the journey literals (`ARSApprovalJourney.tsx:149` `duration-700`, `:553` `duration-[1200ms]`, `:599` `duration-500`, `controller.ts:19` `SCENE_MS`);
   - the loaders' loop times (1-1.6 s, they stay as loops).
7. **Comments that are already wrong** (fix with the change):
   - `PageTransitions.tsx:12` and `globals.css:1805` say 120 ms; the value is 150.
   - `GroupFold.tsx:48` says 190; the value is 150.
   - `globals.css:1785` says 120; the value is 100.
   - `globals.css:1635` says out 160; the value is 150.

## 2. Inventory summary (from the 50-area inventory)

| Flag | Count | Where (details in the inventory) |
|---|---|---|
| **Missing or abrupt transitions** | 14 | Route / skeleton swap; MobileNav and popover exits; dropdown / accordion / toast / bell closes (instant); `role=dialog` divs with no motion (TryAs, emoji, FieldControls, GridCellEditors, CustomizePanel, TaskCreator, inline alert dialogs); raw `<dialog>`s with no exit in Firefox / Safari (`dialog.close()`); tabs (no indicator); new activity / comments; data rows after `router.refresh()`; drag-and-drop drops; file preview content unmounting during the exit |
| **Flicker / layout shift** | 3 measured | Analytics overview (CLS 0.25-0.55, a grid block removed and reinserted at ~1 s); Task Summary with `?task=` (CLS 0.36-0.38 at 1280 / 1366: the pane mounts after hydration and the list header wraps); the sidebar collapse relayouts `main` every frame (width animation, §3.2) |
| **Excess motion** | 2 to review | The approval journey (owner feature D-273: long loops, 1-3 s; paused in hidden tabs, off under reduce, **keep**); Pico Bot's grow-from-launcher with an overshoot and a radius animation |
| **Width / height / top / left animations** | 11 | `SidebarFrame.tsx:84` (width); `OnboardingTour.tsx:239` (top, left, width, height), `:263`; `MobileTabBar.tsx:42` (width); `ARSApprovalJourney.tsx:149` (left), `:553` (width), `.jr-vanwrap` left; `Display.tsx:170`, `StepMap.tsx:183`, `ApprovalRoad.tsx:35`, `Loaders.tsx:103` (progress widths) |
| **Not respecting reduced motion** | 2 confirmed, 3 unverified | Confirmed: JS smooth scroll with no check, `Field.tsx:177` (error summary) and `ReadinessPanel.tsx:85`. Unverified: infinite Tailwind `animate-spin` / `animate-bounce` / `animate-pulse` (`Spinner.tsx:8`, `AssistantForm.tsx:44-46`, `TaskCreator.tsx:697`), which rely on the global 0.01 ms rule. Measured result under reduce for overlays: §3.1. |
| **Sidebar and content not moving together** | see §3.2 | Measured |
| **Unused motion code** | 5 classes | `.motion-slide-up/-slide-down/-scale-in/-expand/-stagger` are defined and never used; only `.motion-fade-in` is used (`MobileNav.tsx:48`). Also `@keyframes pop` (`globals.css:744`) and `[data-dim-on-nav]` (`:1766`). |

## 3. Measured findings (Chromium probes)

Sources:
- `audit/ui-qa/probes/chromium-motion+sidebar+transitions+longtext+reflow.json`;
- `chromium-rapid+transitions.json`;
- `chromium-overlays+resize+pane+picker+upload.json`;
- the `msedge-*` and `webkit-*` files.

Defect IDs: UI_UX_DEFECT_REPORT §B6.

### 3.1 Overlay timings and reduced motion (measured, computed styles)

| Overlay | Normal | Reduced motion | Owner's brief |
|---|---|---|---|
| Search palette | `motion-slide-down` 150 ms, enter `(0.16,1,0.3,1)` | animation none (0.01 ms) | dropdown / modal 150-250 |
| Dialog (`ars-dialog`) | opacity, transform, display, overlay; 220 ms, enter | 100 ms (opacity only, D-407) | modal 250 |
| Bell panel | `menu-in` 150 ms, enter | (global 0.01 ms) | dropdown 150 |
| + Create menu | `menu-in` 150 ms, **standard** `(0.22,1,0.36,1)` | (global) | dropdown 150 |
| Task pane, side (≥ 1024) | `motion-slide-left` 280 ms, enter | none | drawer 250 |
| Task pane, dialog (768) | `motion-scale` 220 ms, enter | none | modal 250 |
| Create task window | **none** (no motion) | — | modal 250 |

- Every overlay respects reduced motion.
- **Mismatch:** two dropdowns use two different easings (the bell uses enter, + Create uses standard).
- The Create task window has no entrance at all (inventory row 7).

### 3.1b Sidebar measured

| | 1440 | 1024 |
|---|---|---|
| Width | 220 → 80, `width 150 ms (0.22,1,0.36,1)` | same |
| Frames (500 ms sampled) | 8 intermediate sidebar widths and 8 intermediate `main.left` values (they move in the same frames) | same |
| `main.left` | 220 → 140 (at 92 ms) → 120 | 220 → 99 → 80 |
| Layout-shift entries per toggle | 0.088 (collapse) / 0.129 (expand) | 0.120 / 0.133 |

- The layout-shift entries are flagged as recent input, so they are excluded from CLS. They do confirm that the motion is layout-driven.
- At 1440, `main.left` and the sidebar edge differ during the move (sidebar 120 vs main 140 at 92 ms), because `main` is centred. That is the "content not moving with the sidebar" effect.

### 3.2 Sidebar and content
- Probe `sidebar` (1440 and 1024): it samples the sidebar width and `main.left` every animation frame for 500 ms after Collapse and after Expand, and observes `layout-shift` entries.
- The sidebar animates **`width`** for 150 ms (`SidebarFrame.tsx:84`). `main` is a flex sibling, so it is laid out again on every frame. The content does move with the sidebar (same frame), but through layout, not transform.
- Because `main` is centred with `max-w-7xl`, at 1920 the content's left edge moves by only half the width change (1920: 462 → 392). The sidebar and the content edge then **move by different amounts**, which reads as the content "lagging" or "sliding the other way". This is the C16 content-width decision in GLOBAL_DESIGN_SYSTEM.
- The labels slide 220 ms after the 150 ms width change ends (`data-just-toggled`, 400 ms window). The two motions are sequential, not together.

### 3.3 Page transitions (switch ON), measured

The probe `transitions` switched `features.page_transitions` ON in the test database, then OFF again afterwards. Signed in as USER at 1440, it opened the sidebar groups and followed 4 sidebar links. It then made 3 rapid clicks within about 150 ms, then Back and Forward.

| | Chromium | Edge | WebKit |
|---|---|---|---|
| `startViewTransition` available | yes | yes | yes |
| Each navigation landed, h1 right | 4 / 4 (400-470 ms) | 4 / 4 | **page crashed** (3 / 3 runs), UIQA-MOT-02 |
| Rapid clicks: the last one wins | yes (`/users/information`) | yes | — |
| Back / Forward | `/users/meetings` / `/users/information` (correct) | same | — |
| View transitions started / skipped | 9 / 2 | 9 / 2 | — |
| CLS over the session | 0.0001 | 0.0001 | — |
| Uncaught errors | **2 × "Transition was skipped"** (UIQA-MOT-01: `transition.ready` not handled, `PageTransitions.tsx:71-73`) | same | — |
| CSS in effect | `::view-transition-new(page-main), ::view-transition-old(page-main) { animation-duration: var(--motion-page); animation-timing-function: linear }`: a plain cross-fade, no vertical move | same | — |

The scroll position after Back with the switch ON was not measured (the list pages were short). That stays a phase 2 check.

### 3.4 Layout shift on load
Probe `cls` (`chromium-cls.json`):

| Page | Viewport | CLS | Moved element |
|---|---|---|---|
| `/users/analytics` | 1366 | **0.548** | `features/analytics/CenterScreen.tsx` |
| | 1280 | 0.405 | |
| | 1920 | 0.317 | |
| | 1440 | 0.024 | |
| `/admin/insights/analytics` | 1366 | 0.364 | same component |
| | 1920 | 0.255 | |
| | 1280 | 0.019 | |
| `/users/work/my-tasks?task=<id>` | 1366 | **0.381** | `[my-grid]`, `[task-cards]` and the list header move 44 px down as the side pane mounts (`TaskPaneHost`, client) |
| | 1280 | 0.365 | |
| | 1440 / 1920 | 0 | |

On the analytics pages the moved element is a block in `features/analytics/CenterScreen.tsx` (y +70 px, height -70 px). Then a `mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2` row (`CenterScreen.tsx:349`, `:408`, `:468`, `:620`) is removed and re-inserted about 400 ms later, which is a visible flicker.

## 4. Page transitions: what turning them on would affect

**Today:**
- `features.page_transitions` defaults to OFF (D-407 point 4; gap 23 "owner's call: stays Off").
- With it OFF, `PageTransitions` is not mounted.
- With it ON:
  - it uses the View Transitions API (`document.startViewTransition`);
  - only `main` cross-fades: `::view-transition-new(page-main)` at `--motion-page` (150 ms) **linear**, with **no vertical move** (`globals.css:1808-1813`);
  - a list row's request / ticket title morphs into the h1 (220 ms);
  - it is skipped when the page takes over 300 ms (`SLOW_PAGE_MS`);
  - it focuses the new h1;
  - it does nothing under reduced motion.

**The owner's request:** subtle transitions ON, a fade plus a small vertical move.

**What changes:**
1. **CSS only:** `::view-transition-old(page-main)` fades out 150 ms (fast, exit easing). `::view-transition-new(page-main)` fades in with `translateY(4px → 0)` at 200 ms (standard, enter easing). The sidebar and header are not named, so they stay still. This is correct.
2. **The default:** the switch's default becomes ON (`server/settings/definitions.ts:81`, `defaultValue: "OFF"`; `featureMode` reads that default when no value is saved). This is a settings change and a decision (it supersedes gap 23).

**Effects to accept or guard (the probe `transitions` measures the first four in Chromium):**

| Effect | Risk | Guard in the existing code |
|---|---|---|
| Back / forward | A cross-fade on Back. The title morph only fires on a row click (`transitionKind` → "title"). Back fades. PlaceMemory restores the scroll *after* the commit, so the list may fade in at the top and then jump. | Measure the scroll after Back with the switch ON (phase 2 test). If it jumps, skip the transition on popstate. |
| Rapid navigation | A second click while a transition runs. `root.hasAttribute("data-vt")` blocks a new transition (no stacking), and the 4 s fallback resolves a click that never commits. The last click must win. | The probe clicks 3 links within 150 ms and checks the final URL and h1. |
| Slow pages | Above 300 ms the transition is skipped, so the skeleton and progress bar show as usual. No blank flash. | `SLOW_PAGE_MS` |
| CLS | View transitions don't add layout shift (the snapshot is a pseudo-element). Pages that shift on load (§3.4) still shift after the fade. | Fix §3.4 first. |
| Focus | Focus moves to the new h1 on a path change. Pages with no visible h1 (AI assistant: sr-only; phone Home: none) get no focus target. | `PageHeader` everywhere (fix batch 2) |
| Browser support | Chromium / Edge: yes. WebKit (Safari 18): yes. Firefox: same-document view transitions arrived in recent releases; the Playwright build's support is recorded by the probe (`viewTransitionsSupported`). Without support, nothing animates. | The `typeof startViewTransition` check |
| Router conflicts | The App Router commits inside `startViewTransition`'s callback, which waits for the layout effect (`PageTransitions.tsx:28-36`). Next 15's own `experimental.viewTransition` is deliberately not used (D-407: it is build-time and switches React to its experimental build). | Keep that choice |
| Panes (`?task=`) and query-only moves | `transitionKind` returns null when only the search changes and the path is the same, so filters, sort and panes don't animate. Correct. | |

**Recommendation:** turn it ON in fix batch 4 (UI_UX_DEFECT_REPORT §D), after these conditions are met:
- the shell tokens (batch 1);
- the CLS fixes on Analytics and Task Summary;
- the `transition.ready` catch (MOT-01);
- a check on real Safari, because WebKit crashed with it ON (MOT-02). If Safari also fails, skip transitions in WebKit.

Use the CSS in point 1 and the popstate check. Keep the Super Admin switch as the off switch.

## 5. Motion Playground (not present)

- There is no Motion Playground or motion catalogue page in the repository (`grep -ri playground` over `app/`, `features/`, `docs/`: no hits).
- The owner wants a hidden, developer-only one.

**Proposal for phase 2:**
- **Route:** `/superadmin/dev/motion`. It is outside the sidebar, refused on the server unless `SUPER_ADMIN`, and also refused unless `NODE_ENV !== "production"` or a Super Admin switch `features.motion_playground` (default OFF) is on.
- **Content:**
  - every token as a live swatch (instant / fast / standard / smooth / emphasis × standard / enter / exit);
  - each shared class (`.motion-*`, `.pop-in`, `.menu-pop`, `ars-dialog` dialog / drawer, BottomSheet, the panes, toast, NavIndicator, LiveNumber, GroupFold reveal, page transition demo);
  - a reduced-motion toggle (emulated via a `data-reduce-motion` attribute that the CSS also honours);
  - a slow-motion ×5 toggle (multiplies the CSS variables).
- **Tests:** a unit test reads the same `MOTION_DURATION` source, so the playground can never drift from the tokens.
- No new library.
