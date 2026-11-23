# Global transition inventory (UI/UX QA, phase 1: audit only)

**Date:** 24 Nov 2026. **Build:** v1.88.0 (`893fb4b`). **Status:** inventory and recommendations only; no motion was changed.
**Update (v1.89.0 stage 2, D-420):** the last column gives each row's fix status; details per row in [TRANSITION_IMPLEMENTATION_REPORT.md](TRANSITION_IMPLEMENTATION_REPORT.md). The token table below is now in force (GLOBAL_MOTION_TOKENS.md).
**Parent document:** [GLOBAL_MOTION_AUDIT.md](GLOBAL_MOTION_AUDIT.md) (token conflict, measured findings, page transitions, Motion Playground).

## How to read this

The owner's transition brief (24 Nov 2026) defines these tokens:

| Token | Duration | Easing |
|---|---|---|
| instant | 100 ms | |
| fast | 150 ms | |
| standard | 200 ms | standard `cubic-bezier(0.2,0,0,1)` |
| smooth | 250 ms | enter `cubic-bezier(0,0,0.2,1)` |
| emphasis | 300 ms | exit `cubic-bezier(0.4,0,1,1)` |

The brief also suggests these roles:

| Role | Duration |
|---|---|
| page | 200 ms |
| modal | 250 ms |
| drawer | 250 ms |
| dropdown | 150 ms |

The **Rec.** column uses those names. `G` means `styles/globals.css`. The "current" values are resolved from the v1.87 tokens:

| v1.87 token | Value |
|---|---|
| instant | 100 ms |
| fast | 150 ms |
| base | 220 ms |
| moderate | 280 ms |
| slow | 350 ms |
| slower | 450 ms |
| `--ease-standard` | `(0.22,1,0.36,1)` |
| `--ease-enter` | `(0.16,1,0.3,1)` |
| `--ease-exit` | `(0.4,0,1,1)` |

**Reuse, don't add:**
- The implementation should reuse the existing motion code:
  - tokens: `styles/globals.css:57-79`, mirrored in `features/shell/motion-rules.ts:50-71` (`MOTION_DURATION`, `MOTION_EASE`, `MOTION_ROLE`);
  - shared classes: `.motion-fade-in/slide-up/slide-down/scale-in/expand/stagger`, `.pop-in`, `.menu-pop` (G:1870-1913);
  - `dialog.ars-dialog` with `top-layer.ts` (exit animation in Firefox and Safari);
  - `overlay-stack.ts` (Escape, trap, inert);
  - `PageTransitions.tsx` (View Transitions);
  - `NavIndicator.tsx` (moving current bar);
  - `LiveNumber.tsx` (changed figure);
  - `pane-close.ts` (wait for exit);
  - `BottomSheet` with `swipe.ts`.
- **No animation library** is needed.
- Every row below can be met with CSS (transform and opacity), the existing keyframes and `MOTION_DURATION`.

**Baseline behaviour:**
- The global reduced-motion rule (G:319-326) cuts every CSS animation and transition to 0.01 ms. JS-driven motion (WAAPI, smooth scroll, Lottie, inline timers) does not get that rule.
- A bare `transition` / `transition-colors` / `transition-transform` with no `duration-*` class falls back to Tailwind's default: 150 ms with `cubic-bezier(0.4,0,0.2,1)`. That is **not** a token easing.

**Risk keys:** LS (layout shift), OV (overlap), BI (blocks input), Z (z-index), P (paint cost, not compositor), RM (no reduced-motion path of its own).

## Inventory: the 50 areas

| # | Area | Where (file:line) | Current | Appropriate? | Rec. (token, property) | Risk | Fix status (v1.89.0, D-420) |
|---|---|---|---|---|---|---|---|
| 1 | Page navigation | `features/shell/PageTransitions.tsx:41-87` (mounted only with the switch, `AppShell.tsx:234,373`); G:1808-1834; `NavigationProgress.tsx:164-170` | Switch OFF (default): **none**. ON: View Transition cross-fade of `main` 150 ms linear (comments say 120); title morph 220 ms; skipped when the page takes over 300 ms. Progress bar `.loader-bar` 1.1 s, after 150 ms. | Yes, subtle (owner) | `standard` 200 ms; opacity + `translateY(4px)` on `::view-transition-new(page-main)` only, the old view fading out 150 ms (`fast`) | Back/forward, rapid clicks, focus move (see the motion audit §4); RM covered (PT:43, G:1828) | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 2 | Route changes (loading, skeleton swap) | `NavigationProgress.tsx:121-161`; 17 `app/**/loading.tsx` | Skeleton overlay after 150 ms, removed at commit: **no cross-fade** (abrupt swap) | Yes, a fade on the swap only | `fast` 150 ms, opacity out of the skeleton | LS when skeleton and page heights differ (CLS measured, defect report) | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 3 | Sidebar | `SidebarFrame.tsx:84`; `SideNav.tsx:126-130,180`; `NavIndicator.tsx:13-37`; G:2003-2024 | Aside **width** 150 ms `ease-standard`; labels slide 220 ms after a toggle; indicator transform 220 ms; group body expand 220 ms; group collapse instant | Yes | `standard` 200 ms. Keep the width (main must reflow), but move the icon column with transform (gap 3); labels opacity only. Indicator: `standard` 200 ms transform. | **LS**: animating width relayouts the main column every frame (measured: see the motion audit §3.2); RM ok | Done (alt.) (see TRANSITION_IMPLEMENTATION_REPORT) |
| 4 | Header | `AppShell.tsx:319` (desktop), `:292` (phone, `backdrop-blur`) | none | No (static chrome) | none (only hover on its buttons: `instant`) | none | Not appropriate (see TRANSITION_IMPLEMENTATION_REPORT) |
| 5 | Nav menus | `SideNav.tsx:152,168,170,197` (chevrons, rows); `MobileNav.tsx:46-48`; `BottomNav.tsx` | Chevron rotate 150 ms (Tailwind default easing); rows `transition-colors` 150 ms; MobileNav `.motion-fade-in` 150 ms, opacity only, **close instant**; BottomNav none | Yes | Menus: `fast` 150 ms opacity + `translateX(-8px)` for the side sheet in, 150 ms out (`exit`); chevrons `fast` | RM: chevrons ok (motion-reduce) | Kept / partly (see TRANSITION_IMPLEMENTATION_REPORT) |
| 6 | Modals | `features/ui/Dialog.tsx:144-195`; G:1638-1704 | In: opacity + scale(0.96), 220 ms `ease-enter`; out 150 ms `ease-exit`; backdrop fades the same | Yes | `smooth` 250 ms in (owner "modal 250"), `fast` 150 ms out; opacity + scale(0.98) | Z: the top layer is fine; RM ok (100 ms fade kept, G:1839) | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 7 | Dialogs (other markup) | Raw `<dialog class="ars-dialog">`: `work/client.tsx:193`, `PaneParts.tsx:224`, `ProjectHeader.tsx:260`, `ShareDialogs.tsx:78,261`. `role=dialog` divs **with no motion**: `TryAsButton.tsx:29`, `RichEditor.tsx:561`, `FieldControls.tsx:243,269,305`, `GridCellEditors.tsx:84,141`, `CustomizePanel.tsx:61`, `TaskCreator.tsx:306`. Inline alert dialogs: `ImportPanel.tsx:383`, `UsersBulkActions.tsx:132`, `RequestForm.tsx:281`. | Raw dialogs close with `dialog.close()`, so **no exit animation in Firefox or Safari**. The divs appear and vanish abruptly. | Yes | Move to `Dialog` (modal) or `Popover` (small editors): `smooth` 250 ms in / `fast` 150 ms out | Abrupt; RM n/a | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 8 | Drawers | Dialog drawer variant G:1660-1687; `TaskPane.tsx`, `RecordPane.tsx` (G:1918-1945); `pane-close.ts:70-77`; `TaskCreator.tsx` | Dialog drawer: translate 32 px, 220 ms in / 150 ms out. Panes (side, from 1024 px): slide 16 px 280 ms / out 150 ms. Pane in dialog mode: scale 220 ms. TaskCreator: none. | Yes | `smooth` 250 ms in (owner "drawer 250"), `fast` 150 ms out; transform translateX(16px) + opacity; one value for both drawer families | BI: `pane-close` waits up to 300 ms for the exit; RM ok | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 9 | Dropdowns | `MenuCore.tsx:191,204` (`.menu-pop`); `Drop.tsx:70`; `<details>` in 26 files; G:1712-1746 | `menu-in`: opacity + 4 px `translate`, 150 ms `ease-standard`; **close instant** | Yes | `fast` 150 ms in, `instant` 100 ms out (opacity); `enter` easing | RM ok (100 ms fade, G:1741) | Done (open) / Not appropriate (close) (see TRANSITION_IMPLEMENTATION_REPORT) |
| 10 | Popovers | `DateRangePicker.tsx:659-660`; `PowerSearch.tsx:122`; `PeoplePicker.tsx`; `PersonSelect.tsx` | DateRangePicker desktop `.pop-in` 150 ms; phone `.mob-sheet` 280 ms with **no exit**; PowerSearch `.pop-in` at every width; PeoplePicker / PersonSelect: **none** | Yes | `fast` 150 ms opacity + 4 px; phone sheets `smooth` 250 ms | OV / Z: popovers in dialogs use `--z-popover` 50 < `--z-dialog` 60 (they work only because they sit in the top layer). Note it for the Popover component. | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 11 | Tooltips | `features/ui/Hint.tsx:16` + G:1980-1982; `SidebarFrame.tsx:48-62,131` + G:1983-1998; native `title` | Hint fades 150 ms after a 300 ms delay, hides at once; rail tooltip 150 ms after a 300 ms JS delay | Yes | `fast` 150 ms opacity, 300 ms delay (keep) | none | Kept (see TRANSITION_IMPLEMENTATION_REPORT) |
| 12 | Buttons | G:349-353, 426-466 (`btn-*`, `tb-*`); `features/ui/Button.tsx` | `transition-colors` 150 ms, **Tailwind default easing**; no press feedback | Yes (hover / press only) | `instant` 100 ms colour; press `scale(0.98)` `instant` (optional) | none | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 13 | Icons | `Spinner.tsx:8` (`animate-spin`); chevrons `NotificationCenter.tsx:107`, `TaskWorkPanel.tsx:278,409`, `ScheduleView.tsx:651`, `WorkflowBuilder.tsx:290`, `ARSApprovalJourney.tsx:521`, `RichEditor.tsx:531` | Spin 1 s linear infinite; chevrons 150 ms default easing | Yes | Chevrons `fast` rotate; spinner unchanged | RM: `animate-spin` relies on the global 0.01 ms rule (an infinite spin; whether it renders still or jitters is unverified) | Kept (see TRANSITION_IMPLEMENTATION_REPORT) |
| 14 | Cards | `.card-link` G:363-364 | `transition` (all default properties) 150 ms, lift -1 px + shadow | Yes (links only) | `fast` 150 ms transform + shadow | P (box-shadow) | Kept (see TRANSITION_IMPLEMENTATION_REPORT) |
| 15 | Dashboard widgets | `features/home/OverviewParts.tsx` (LiveNumber); `HomeWidgets.tsx:209-232`; `work/reporting/Dashboard.tsx:295` | Changed figure 350 ms; drag: `opacity-50` / outline with **no transition**; reporting grab `scale-[1.01]` snaps | Yes (drag feedback) | Lift `fast` 150 ms transform; reorder: FLIP with transform `standard` 200 ms (optional) | LS while dragging (none: static) | Deferred (see TRANSITION_IMPLEMENTATION_REPORT) |
| 16 | Tables | G:383-384 (row hover); G:1766-1769 (`data-nav-pending` dim 100 ms); G:1786-1789 (current row); `TableColumns.tsx:107-144` | Row hover 150 ms; pending dim to 60 % (100 ms linear); resize live | Yes (hover, pending only) | `instant` 100 ms colour; never animate row height | none | Kept (see TRANSITION_IMPLEMENTATION_REPORT) |
| 17 | Forms | `features/ui/Field.tsx:170-178` (error summary) | Smooth `scrollIntoView` (**unconditional**) | Yes (scroll to the error) | Respect reduced motion (`behavior: reduce ? "auto" : "smooth"`) | **RM missing** | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 18 | Inputs | `.field-input` G:336; `.pill-select` G:346 | Border, shadow and background `duration-150` literal; default easing | Yes | `fast` 150 ms (token) | none | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 19 | Checkboxes | `work/client.tsx:144-151` (TaskCheck); G:1577-1610 (`pm-check`); native elsewhere | PM: fill 120 ms, pop 200 ms (spring `linear()`), tick 160 ms (a second private scale `--t-check/--t-fill/--t-pop`, G:121-123); non-PM: `brand-pop` 0.45 s + `brand-draw-tick` 0.35 s | Yes (completion only) | Map `--t-*` to `instant` / `fast` / `standard`; native boxes: none | RM ok (G:1584, 1608) | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 20 | Radios | Native (e.g. `NotificationRuleEditor.tsx:90`) | none | No | none | none | Not appropriate (see TRANSITION_IMPLEMENTATION_REPORT) |
| 21 | Toggles | `Field.tsx:91` (Switch); `.mob-switch` G:1094-1117 | Track colour + knob transform 150 ms (two implementations) | Yes | `fast` 150 ms transform (knob) + colour | RM: Field switch global rule only | Kept (see TRANSITION_IMPLEMENTATION_REPORT) |
| 22 | Tabs | `HubTabs.tsx:53,64-65`; `ProfileTabs.tsx`; `OwnershipTabs.tsx`; tablists `NotificationBell.tsx:191`, `TaskActivity.tsx:127`, `FieldDialog.tsx:147,289`, `IntakeBuilder.tsx:338`, `ImportPanel.tsx:157`, `MoveCentre.tsx:55`, `FieldProperties.tsx:78` | **No indicator motion, no panel transition**; only the `.hub-tabs-cue` edge fade 150 ms | Yes (indicator only) | Indicator `standard` 200 ms transform (reuse the NavIndicator approach); panel content: `fast` opacity | LS none | Done (alt.) (see TRANSITION_IMPLEMENTATION_REPORT) |
| 23 | Accordions | `GroupFold.tsx:97,115` + G:1750-1761; `FoldSections.tsx`, `.mob-section` (`MobileTasks.tsx:125`, `PhoneFold.tsx:7`, `calendar/page.tsx:111`) G:1120-1121; `<details>` | Rows fade + 4 px 150 ms on open only (the GroupFold comment says 190); **collapse instant**; caret 150 ms | Yes | Open `fast` 150 ms opacity + 4 px; close `instant` 100 ms opacity; **never animate height** (keep) | RM ok | Kept (see TRANSITION_IMPLEMENTATION_REPORT) |
| 24 | Loading indicators | `Spinner.tsx:3-30`; `Loaders.tsx:10-68`; `RoundLoader.tsx`; `BrandLoader.tsx:27-55`; `.loader-bar` G:575; `Classic.tsx:160` | brand-spin 1 s, dot-fade 1.2 s (inline `animationDelay`, `Loaders.tsx:48`), loader-bar 1.1 s, `animate-spin` 1 s | Yes | Keep the loops (not tokens); show only after 150 ms (`fast`, already done for navigation) | RM: Tailwind `animate-*` global rule only | Kept (see TRANSITION_IMPLEMENTATION_REPORT) |
| 25 | Skeletons | `Skeleton.tsx`; `MobileSkeletons.tsx`; `Spinner.tsx:33-34` | `.skeleton` shimmer 1.6 s via `background-position` | Yes | Keep; optionally move to a transform-based sweep (pseudo-element) | P (background-position repaint); RM ok (G:883) | Kept (see TRANSITION_IMPLEMENTATION_REPORT) |
| 26 | Progress | `Display.tsx:170` (width 350 ms); `StepMap.tsx:183` (width, default 150 ms); `ApprovalRoad.tsx:35` (width 450 ms); `Loaders.tsx:81` (stroke), `:103` (width 280 ms, unused) | **Width animations** (4 bars) | Yes (value changes) | `standard` 200 ms `transform: scaleX()` with `transform-origin:left` | **LS-free but layout work per frame**; RM: Display.tsx global only | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 27 | Toasts | `Toast.tsx:104-131`; G:483-492 | In: opacity + translateY(8 px) 150 ms; **out: none (removed at once)** | Yes | In `standard` 200 ms; out `fast` 150 ms opacity | RM ok (`motion-safe`) | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 28 | Notification panel | `NotificationBell.tsx:173-181`; `NotificationCenter.tsx:107` | `.pop-in` 150 ms, **no exit**; Center: details menu-in + chevron | Yes | `fast` 150 ms in, `instant` out | none | Kept (see TRANSITION_IMPLEMENTATION_REPORT) |
| 29 | Search suggestions | `CommandPalette.tsx` (results); `PeoplePicker.tsx`; `RichEditor.tsx:440` (mentions) | none (palette itself: row 6/7) | No for items (results change while typing) | none; highlight colour `instant` | none | Not appropriate (see TRANSITION_IMPLEMENTATION_REPORT) |
| 30 | Filter panels | `ListToolbar.tsx:71,110` (`Drop`), `PowerSearch.tsx:122`, `ProjectWorkspace` / `TaskGrid` `<details>` | menu-in 150 ms / `.pop-in` | Yes | = dropdowns (`fast`) | none | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 31 | Pagination | `Display.tsx:176-195`; `PagedRows.tsx`; `PendingLink.tsx:22-35` | none; `[data-link-pending]` opacity 0.7 with no transition; spinner | Yes (pending only) | `instant` 100 ms opacity on pending | none | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 32 | Scroll | `PlaceMemory.tsx:67` (instant); smooth with a reduce check: `FitPages.tsx:113`, `OnboardingTour.tsx:142`, `ARSApprovalJourney.tsx:371,455`, `CustomApprovalForm.tsx:239`, `PaneLayout.tsx:174`, `PortfolioProgress.tsx:123`, `ProjectForms.tsx:329`, `StatusComposer.tsx:82` | Smooth only where listed | Yes (in-page jumps) | Browser smooth scroll, guarded by reduce | **RM missing**: `Field.tsx:177`, `ReadinessPanel.tsx:85` | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 33 | File uploads | `FileListInput.tsx:111` | Dropzone `transition-colors` 150 ms; no progress (`UploadProgress` unused) | Yes | `fast` colour; real progress where uploads are slow | none | Kept (see TRANSITION_IMPLEMENTATION_REPORT) |
| 34 | File previews | `AttachmentList.tsx:68-76`, `FilesTab.tsx:257-265` (Dialog + `<img>`) | Dialog motion; the image content **unmounts at close** (vanishes during the exit; read from code) | Yes | Keep the content until the exit ends (Dialog already keeps its own) | Abrupt exit | Deferred (see TRANSITION_IMPLEMENTATION_REPORT) |
| 35 | Drag and drop | `ProjectWorkspace.tsx:617-628,778,791`; `TaskGrid.tsx:850`; `MyTasks.tsx:129`; `ViewTabs.tsx:77`; `ReorderHeader.tsx:82`; `FormFieldsEditor.tsx:374`; `WorkflowBuilder.tsx:253`; `HomeWidgets.tsx:209`; `TaskCalendar.tsx:199,427`; `.pm-lifted` G:1622 | Static state classes (opacity 50 %, rings, dashed outline); **no reorder animation**; handle `opacity-0 → group-hover:opacity-100` with no transition | Yes (feedback) | Lift `fast` 150 ms (shadow + scale 1.01); drop `standard` 200 ms transform (FLIP); handle `instant` opacity | LS on drop (rows jump) | Deferred (see TRANSITION_IMPLEMENTATION_REPORT) |
| 36 | Approval workflow steps / timeline | `ARSApprovalJourney.tsx` (`:120-152`, `:551-600`, `:691-705`), `JourneyActivities.tsx:20,59-61`, `controller.ts:19`; G:1167-1365, 1494-1510; `StepMap.tsx:183`; `ApprovalRoad.tsx:35` | A long-form scene animation (owner-approved journey, D-273): van **`left`** 1.5 s, header van `transition-[left]` 700 ms, fill **width** 1.2 s, many loops (0.35 to 3 s); paused in hidden tabs | Yes (owner feature; keep) | Keep as a feature exception. Move `left` / `width` to transform (`translateX`, `scaleX`) | Layout per frame; RM ok (`.jr-panel *` none) | Done (alt.) (see TRANSITION_IMPLEMENTATION_REPORT) |
| 37 | Task status updates | `work/client.tsx:144-151`; `celebrate.tsx:26-55` (WAAPI confetti 520-700 ms, `cubic-bezier(.2,.7,.3,1)`, removed after 1200 ms); G:1594-1609 | Check animation (row 19); confetti; status pills **none** | Yes (completion), pills: colour only | Pill colour `fast` 150 ms; confetti stays an opt-in celebration | RM ok (`celebrate.tsx:23,27,62`) | Kept (see TRANSITION_IMPLEMENTATION_REPORT) |
| 38 | Activity timelines | `CommentThread.tsx:216`; `EditableComment.tsx`; `RequestTimeline.tsx`; `TaskActivity.tsx` | none (a new comment appears abruptly; the "Posting…" row is optimistic, D-407 point 9) | Yes (a new entry only) | New item `standard` 200 ms opacity + 4 px (`.motion-slide-up`, already exists and is unused) | none | Deferred (see TRANSITION_IMPLEMENTATION_REPORT) |
| 39 | AI chat | `PicBot.tsx:80-91,126-132,231,254`; G:1128-1136; `AssistantForm.tsx` | Panel grows from the launcher: scale 0.06 → 1 + **border-radius** 280 ms with an overshoot curve `(0.2,0.9,0.3,1.05)`; out 220 ms; JS waits a literal 220 ms (`PicBot.tsx:90`); launcher hover `scale-105` | Yes (launcher "character") | In `smooth` 250 ms, out `fast` 150 ms, `enter` / `exit` easing; drop the radius animation; JS wait from `MOTION_DURATION` | P (border-radius); RM ok | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 40 | AI streaming | `AssistantForm.tsx:43-46` (`animate-bounce` x3, `[animation-delay:120ms/240ms]`); `PicBot.tsx:363-366` (static "Analysing…") | Bouncing dots; **no streamed text reveal** (answers arrive whole: no `getReader` in `features/ai`) | Yes (typing indicator) | Dots: opacity pulse (transform-free) 1.2 s loop; reveal of the arrived answer: `standard` 200 ms opacity | RM: `animate-bounce` global only | Done / Not appropriate (see TRANSITION_IMPLEMENTATION_REPORT) |
| 41 | Responsive / mobile nav | `MobileTabBar.tsx:42`; `MobileNav.tsx:48`; `BottomNav.tsx` | Tab pill **width** 150 ms (`w-10 → w-14`); MobileNav fade 150 ms; BottomNav none | Yes | Pill: `fast` 150 ms `scaleX` or opacity of a fixed-width pill | Layout per frame; RM global only | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 42 | Mobile bottom sheets | `BottomSheet.tsx:28-60`; G:1078-1093, 1963-1964; `swipe.ts:22-55` | In translateY(100 %) 280 ms; backdrop 220 ms; out 150 ms then unmount (`MOTION_DURATION.fast`) | Yes | In `smooth` 250 ms, out `fast` 150 ms | RM ok | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 43 | Empty states | `Display.tsx:85` `EmptyState` | none | Optional | `standard` 200 ms opacity on first show (with content reveal, row 48) | none | Not appropriate (see TRANSITION_IMPLEMENTATION_REPORT) |
| 44 | Error states | `States.tsx:10-35`; `app/error.tsx`, `app/users/error.tsx`, `app/global-error.tsx`, `app/not-found.tsx`; `FailedCross` (`brand-shake`) via BrandAnimation (`form.tsx:314`, `Toast.tsx:123`) | none on the state; a shake on failed toasts | Inline errors: no motion. Toast: ok | Field errors: `fast` opacity (no shake); keep the toast icon | RM ok | Kept (see TRANSITION_IMPLEMENTATION_REPORT) |
| 45 | Success states | `Loaders.tsx:151-189`; `BrandAnimation.tsx:37-62` (Lottie); `NextFlash.tsx:8-20` + G:1790-1794 | Lottie (task-done, success, approved, celebrate); SVG fallback 0.35-0.5 s; NextFlash outline 350 ms, removed after 1.6 s | Yes | Keep (feature moments); NextFlash `emphasis` 300 ms | RM: Lottie skipped (`BrandAnimation.tsx:41`); NextFlash global only | Kept (see TRANSITION_IMPLEMENTATION_REPORT) |
| 46 | Confirmations | `Dialog.tsx:199-289` (ConfirmDialog, DiscardDraftDialog); `ConfirmButton.tsx` | Dialog motion; 800 ms re-arm (not motion) | Yes | = modals | BI: none (busy lock, D-417) | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 47 | Focus / hover feedback | `:focus-visible` G:314-317; `hover:` classes | Focus ring **instant** (correct); hover 150 ms where present, many hovers with no transition (`Hint.tsx:16`, `Dialog.tsx:175`, `MobileNav.tsx:41`, `SidebarFrame.tsx:96,119`) | Hover: yes; focus: no | Hover `instant` 100 ms everywhere (one utility); focus stays instant | none | Done (see TRANSITION_IMPLEMENTATION_REPORT) |
| 48 | Page content reveal | `.motion-stagger` G:1906-1913 | **Defined, not used anywhere** | Optional (owner: subtle) | If used: `standard` 200 ms opacity + 4 px, stagger 30 ms, max 6 items, first paint only (never on Back) | CLS none (transform); excess motion risk: lists must not stagger on every filter | Not appropriate (see TRANSITION_IMPLEMENTATION_REPORT) |
| 49 | Data updates | `LiveNumber.tsx:11-31` (home only); G:1972-1976; `router.refresh()` (~52 sites) | Changed figure: opacity + 4 px 350 ms; refreshed rows: none | Yes (changed values only) | `emphasis` 300 ms; extend to KPI cards in Admin Insights | none | Kept (see TRANSITION_IMPLEMENTATION_REPORT) |
| 50 | Advanced (View Transitions list → detail) | `PageTransitions.tsx:47,54` (`view-transition-name: page-title`, request / ticket rows only) | Title morph 220 ms when the switch is on | Yes, behind the switch, with the App Router-safe pattern already built (waits for commit, skips after 300 ms, never on Back for the title) | `smooth` 250 ms title group; extend to task rows only after the transitions probe passes in all four browsers | Firefox has no `startViewTransition` in Playwright's build (see the motion audit §4); falls back to none | Kept (see TRANSITION_IMPLEMENTATION_REPORT) |

## Other interactive motion found (outside the 50)

| Where | Current | Note |
|---|---|---|
| Landing → sign-in (`LandingWelcome.tsx:19,35,63`; `AuthLayout.tsx:65`; G:536-548) | `.auth-leave` 220 ms, `.auth-enter` 350 ms | **`LEAVE_MS = 200` navigates 20 ms before the 220 ms exit ends** (possible cut-off frame). Rec.: `standard` 200 ms both. |
| Install invite (`InstallInvite.tsx:99`) | `animate-[fadeIn_200ms_ease-out]` | Hard-coded; Rec.: `.motion-fade-in`. |
| Onboarding tour (`OnboardingTour.tsx:239,263`) | Spotlight `transition-[top,left,width,height]` 220 ms; progress width | **Layout-property animation**; Rec.: transform (translate + scale) on a fixed-size ring. |
| Pane "Saving…" chip (`PaneControl.tsx:115`, G:1946-1957) | slide-up 150 ms | ok |
| Bulk bar (`MoreParts.tsx:399`, `.bulk-bar-in`) | slide-up 220 ms | ok (`standard`) |
| Row highlight (`RowKeys.tsx:30-44`, `PlaceMemory.tsx:72-73`) | background 100 ms, 1.6 s highlight | ok |
| Classic loader (`Classic.tsx:160`, `BrandLoader.tsx:41-55`) | after 150 ms | ok |
| Swipe to close (`swipe.ts:29`) | direct `translate` while dragging | ok (gesture-driven) |

## Hard-coded values that must move to tokens (from the inventory)

- **TS timers tied to motion:**
  - `PicBot.tsx:90` (220);
  - `LandingWelcome.tsx:19` (`LEAVE_MS=200` vs 220 ms CSS);
  - `SidebarFrame.tsx:43` (400 "just toggled", for a 220 ms animation) and `:57` (300 tooltip delay);
  - `pane-close.ts:76` (300 cap);
  - `top-layer.ts:36` (2000 cap);
  - `LiveNumber.tsx:23` (600);
  - `NextFlash.tsx:8` / `PlaceMemory.tsx:73` (1600);
  - `OnboardingTour.tsx:143` (350);
  - `celebrate.tsx:49,54`;
  - `NavigationProgress.tsx:83` (150);
  - `Classic.tsx:160` (150);
  - `PageTransitions.tsx:22` (300).
  - Only `BottomSheet.tsx:41` reads `MOTION_DURATION`.
- **Tailwind literals:**
  - `AssistantForm.tsx:45-46`;
  - `ARSApprovalJourney.tsx:149` (`duration-700`), `:553` (`duration-[1200ms]`), `:599` (`duration-500`);
  - `InstallInvite.tsx:99`;
  - G:336 and G:346 (`duration-150`);
  - every bare `transition*` with no duration (rows 5, 12-16, 21-22, 26, 28, 33, 39, 41).
- **CSS literals:**
  - G:121-123 (`--t-check/--t-fill/--t-pop`, a second scale);
  - G:575, 853-881 (loaders);
  - G:1132 (`picbot-in` overshoot curve);
  - G:1187 (`.jr-vanwrap` curve);
  - G:1177-1342, 1501 (journey);
  - G:1744, 1842 (100 ms reduce fades);
  - G:1907-1913 (stagger steps);
  - G:1981 (300 ms tooltip delay).
- **Comments that disagree with the code:**
  - `PageTransitions.tsx:12` and G:1805 (say 120, actual 150);
  - `GroupFold.tsx:48` (190 vs 150);
  - G:1785 (120 vs 100);
  - G:1635 (160 vs 150).
