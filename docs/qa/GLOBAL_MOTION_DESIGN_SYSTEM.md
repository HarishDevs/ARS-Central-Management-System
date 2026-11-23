# Global motion design system (v1.89.0, D-420)

**Status:** built in v1.89.0 stage 2 on branch `release-189` (one release v1.89.0; not on main yet).
**Supersedes:** the motion values of v1.87.0 (D-417). The architecture of v1.87.0 (overlay stack, pane control, place memory, `docs/GLOBAL_MOTION_NAVIGATION_IMPLEMENTATION.md`) stays; this document is the motion layer on top of it.
**Tokens:** [GLOBAL_MOTION_TOKENS.md](GLOBAL_MOTION_TOKENS.md). **What changed, file by file:** [MOTION_IMPLEMENTATION_LOG.md](MOTION_IMPLEMENTATION_LOG.md). **The 50 areas:** [TRANSITION_IMPLEMENTATION_REPORT.md](TRANSITION_IMPLEMENTATION_REPORT.md). **Numbers:** [PERFORMANCE_VALIDATION.md](PERFORMANCE_VALIDATION.md).

## 1. Principles (the owner's brief)

1. **Subtle and fast.** 100 / 150 / 200 / 250 / 300 ms only. Nothing in the interface takes longer than 300 ms; loops (loaders) and the approval journey's scene are illustrations, not interface motion.
2. **Enter decelerates, exit accelerates, moves use standard.** `enter (0,0,0.2,1)`, `exit (0.4,0,1,1)`, `standard (0.2,0,0,1)`. Exits are shorter than entrances (fast 150).
3. **Transform and opacity only.** No width, height, top or left animation anywhere in the interface (unit-tested). Colour changes on hover are allowed (paint only).
4. **One source.** CSS variables in `styles/globals.css` are the source; `features/ui/motion.ts` mirrors them for code; Tailwind maps to the variables (and its bare `transition` DEFAULT does too). No literal duration or easing in interface code (unit-tested).
5. **Reduced motion is respected everywhere.** CSS: the global 0.01 ms rule plus a block per shared class. Code: `prefersReducedMotion()`, `motionMs()`, `afterMotion()`, `scrollBehavior()`. Page transitions don't start.
6. **Never wait for motion.** Nothing blocks input during an animation; a slow page appears without its transition (300 ms); a pane's exit is capped.
7. **No library.** CSS animations / transitions, the View Transitions API and a few lines of WAAPI. No dependency was added.

## 2. Roles

| What | In | Out | Properties |
|---|---|---|---|
| Page (main area only) | standard 200, enter: fade + 4 px rise | fast 150, exit: fade | opacity, transform (view-transition pseudo-elements) |
| Modal (`Dialog`, raw `dialog.ars-dialog`) | smooth 250, enter: fade + scale 0.98 | fast 150, exit | opacity, transform (+ `display`/`overlay` discrete) |
| Drawer (Dialog drawer, task / record pane, Customise, sheets) | smooth 250, enter: fade + 16 px | fast 150, exit | opacity, transform / translate |
| Dropdown, menu, popover, filter panel | fast 150, enter: fade + 4 px | instant (closes at once; see §5) | opacity, translate |
| Tooltip | fast 150 after 300 ms | at once | opacity |
| Toast | standard 200, enter: fade + 8 px | fast 150, exit: fade + 4 px | opacity, transform |
| Hover / press | instant 100 (colour); press scale 0.98 | | colour, transform |
| New item, stagger | standard 200, 30 ms steps | | opacity, transform |
| Changed figure (LiveNumber), highlight | emphasis 300 | | opacity, transform / outline colour |
| Progress | emphasis 300 | | transform (translateX of a full-width bar) |
| Skeleton → content | fast 150 fade of the new page | | opacity |
| Sidebar fold | width changes in one step; labels / rail items fade in, standard 200 | | opacity, translate |

## 3. Page transitions

- **On by default** (`features.page_transitions` default ON; the Super Admin switch is the kill switch). A saved row wins (see D-420 for how a saved OFF is treated).
- `features/shell/PageTransitions.tsx` uses same-document view transitions. Only `main#main` has a `view-transition-name`; the sidebar and top bar are part of the root snapshot, whose animation is off, so they don't move.
- **The update callback holds the old picture until Next commits the new route, or for 300 ms at most** (`MOTION_DELAY.slowPage`), whichever is first. Past 300 ms the transition is skipped and the page simply appears (the skeleton and progress bar show as usual, then fade in).
- A click during a running transition ends it at once (no stacking). **Back and Forward are never animated** (the browser's own history moves stay instant; PlaceMemory restores the scroll without a fade in between).
- Every promise of the transition (`ready`, `updateCallbackDone`, `finished`) is handled (UIQA-MOT-01).
- After an animated move, focus goes to the new `main h1` unless the person has already moved focus somewhere else.
- A request or ticket opened from a list morphs its title into the heading (smooth 250).
- No support (an older browser) or reduced motion: nothing animates; navigation is unchanged.

### WebKit crash (UIQA-MOT-02): root cause

The v1.80 code held the update callback open until the route committed, with a 4 s fallback, and only *skipped the animation* after 300 ms. Skipping does not end the callback: per the View Transitions spec the document stays in the "update callback pending" state, holding the old picture, until the callback's promise settles. Measured in Playwright WebKit (Windows) with the audit's instrumentation: after a skip at 300 ms the callback stayed pending for 3.1 s and 4.26 s (the 4 s fallback), the route did not land in that time, and with rapid clicks the WebKit page stopped answering (the test timed out on a plain `waitForTimeout`; the audit's harness reported it as a page crash). Fix: the 300 ms timer now ends the callback as well (`end()`: skip + resolve), a click during a transition ends the running one, and Back / Forward don't start one. After the fix: the rapid-click and Back / Forward test passes in WebKit, Chromium and Firefox (see TRANSITION_QA_REPORT).

## 4. Where the code is

| Part | File |
|---|---|
| Tokens (source) | `styles/globals.css` `:root` |
| Token mirror and helpers | `features/ui/motion.ts` |
| Tailwind names, DEFAULT | `tailwind.config.ts` |
| Page transitions | `features/shell/PageTransitions.tsx`, globals.css "4. Page transitions" |
| Skeleton → content fade | `features/shell/NavigationProgress.tsx` (`data-nav-reveal`) |
| Dialog / drawer | `features/ui/Dialog.tsx`, `features/ui/top-layer.ts` (exit in Firefox / Safari; raw dialogs now close through it too) |
| Panes | `features/ui/PaneControl.tsx`, `pane-close.ts` |
| Toast exit | `features/ui/Toast.tsx` |
| Shared classes | globals.css: `.motion-*`, `.pop-in`, `.drawer-in`, `.menu-pop`, `.toast-in/-out`, `.bulk-bar-in` |
| Playground | `/superadmin/dev/motion` (`app/superadmin/dev/motion/page.tsx`, `features/superadmin/MotionPlayground.tsx`) |
| Guards | `tests/ui/motion-tokens-v189.test.ts`, `tests/ui/motion-review.test.tsx`, `tests/ui/navigation-continuity.test.ts`, `tests/e2e/v1890-motion.spec.ts` |

## 5. Decisions on what does not move

- **Menus, dropdowns and the bell close at once.** Keyboard focus returns to the opener immediately, and keeping the closed menu in the page for an exit would keep a second copy of its items (duplicate names for screen readers and tests). Opening animates.
- **Accordions never animate height**; rows fade in on open; close is instant.
- **Tabs (HubTabs) are separate pages:** the colour change is instant 100 ms and the page transition covers the panel; a sliding indicator would need state across pages.
- **No list stagger by default** (`.motion-stagger` stays available): lists redraw on every filter and refresh; staggering them would be excess motion.
- **Header, radios, empty states, search suggestions:** static.
- **Drag and drop reorder (FLIP)**, a new-comment entrance and KPI animations in Admin Insights: not built in this stage (see TRANSITION_IMPLEMENTATION_REPORT, reasons per row).

## 6. Playground

`/superadmin/dev/motion`: every duration (CSS value next to the TS mirror, a live track), the three easings, the role map, the delays, and live patterns (modal, drawer, dropdown, toast, changed figure, progress, page transition, popover, stagger, fold reveal, skeleton → content, hover / press). **Reduce motion (this page)** applies the reduced-motion rule to the playground; **Slow motion × 5** redefines the CSS variables on the playground only (it works because nothing is hard-coded). Super Admin only (`requireArea("superadmin")`, a 404 for everyone else; the area metadata keeps the page title out of that 404, D-419 NAV-01). Not linked from any menu, the sidebar or the settings search.
