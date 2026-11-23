# Motion implementation log (v1.89.0 stage 2, D-420)

**Date:** 24 Nov 2026. **Branch:** `release-189` (from `e1c87c9`). No schema change, no migration, no new dependency.

## Order of work

1. Reproduced the WebKit page-transition failure (UIQA-MOT-02) on the unchanged build, found the root cause (GLOBAL_MOTION_DESIGN_SYSTEM §3) and rewrote `PageTransitions.tsx`.
2. Replaced the token scale (CSS source, TS mirror, Tailwind) and moved every use of the retired names.
3. Removed the layout-property animations; moved timers and literals onto the tokens.
4. Filled the inventory's missing transitions (overlays, toasts, skeleton swap, press feedback).
5. Fixed the Analytics layout shift (UIQA-PERF-01).
6. Turned page transitions on by default; added the Motion Playground; tests; docs.

## Files

| File | Change |
|---|---|
| `styles/globals.css` | `:root` motion block rewritten: instant 100 / fast 150 / standard 200 / smooth 250 / emphasis 300; easings standard (0.2,0,0,1), enter (0,0,0.2,1), exit (0.4,0,1,1); delays (`--motion-delay-tooltip/-loader`, `--motion-stagger-step`); roles (`--motion-drawer`, `--motion-page-out`, `--motion-reduced`, dialog-in → smooth, page → standard). Retired `--motion-base/-moderate/-slow/-slower` (every use moved). `--t-check/-fill/-pop` → token aliases. Page transitions: old page fades out (fast, exit), new page fades in + 4 px (standard, enter). Dialog scale 0.96 → 0.98, drawer 32 → 16 px, pane scale 0.97 → 0.98. Menus / folds use the enter easing (the bell and + Create now match: UIQA-CON-18 motion part). Reduced-motion 100 ms literals → `--motion-reduced`. Stagger delays and tooltip delay → tokens. PicBot: no radius animation, drawer timing, enter / exit easing. Toast in / out classes. Hover + press on shared buttons. `.drawer-in`. `data-nav-reveal` fade. Journey vans and fill on transform. `[data-link-pending]` fades. Playground styles. Stale comments (120 / 160 / 190 / 220 ms) corrected. |
| `features/ui/motion.ts` (new) | The TS mirror: `MOTION_DURATION`, `MOTION_EASE`, `MOTION_DISTANCE`, `MOTION_DELAY`, `MOTION_ROLE`, `motionMs`, `prefersReducedMotion`, `scrollBehavior`, `afterMotion`. |
| `features/shell/motion-rules.ts` | Token block removed; re-exports the mirror (same objects). |
| `tailwind.config.ts` | `transitionDuration` = DEFAULT (fast), instant, fast, standard, smooth, emphasis; `transitionTimingFunction` = DEFAULT (standard), standard, enter, exit, linear. Every bare `transition*` class is now on the tokens. |
| `features/shell/PageTransitions.tsx` | WebKit fix: the update callback ends at the commit or at 300 ms (`end()` = skip + resolve); a click during a transition ends it; Back / Forward not animated; `ready` / `updateCallbackDone` / `finished` handled (MOT-01); focus to the new h1 only when focus is free. |
| `server/settings/definitions.ts`, `server/settings/features.ts`, `features/shell/AppShell.tsx` | `features.page_transitions` default **ON**; label and comments. |
| `features/shell/SidebarFrame.tsx` | No width animation (MOT-03); just-toggled window and tooltip delay from tokens. |
| `features/shell/NavigationProgress.tsx` | Loader delay token; the page replacing a skeleton fades in (`data-nav-reveal`). |
| `features/shell/Classic.tsx`, `PlaceMemory.tsx`, `features/requests/NextFlash.tsx` | Loader delay and highlight from `MOTION_DELAY`. |
| `features/shell/NavIndicator.tsx`, `features/ui/GroupFold.tsx` | Comments corrected (standard 200 / fast 150). |
| `features/ui/Toast.tsx` | Exit animation (fast, exit) before removal; in = standard, enter. |
| `features/ui/Display.tsx` (`Progress`), `features/requests/StepMap.tsx`, `features/requests/ApprovalRoad.tsx`, `features/ui/Loaders.tsx` | Progress bars move by `translateX` of a full-width bar (were `width`). |
| `features/help/OnboardingTour.tsx` | Spotlight moves by `transform` (was top / left / width / height); its progress by transform; scroll settle and reduced-motion check from the helpers. |
| `features/mobile/MobileTabBar.tsx` | Active pill: fixed size, background scales / fades (was a width animation). |
| `features/journey/ARSApprovalJourney.tsx` | Header van, road van and green fill move by transform (container query units), were `left` / `width`. Scene timings unchanged (D-273 exception). |
| `features/ai/PicBot.tsx` | Exit wait = `MOTION_DURATION.fast` (was a literal 220 for a 220 ms CSS exit). |
| `features/ai/AssistantForm.tsx` | Typing dots: the brand's opacity fade instead of `animate-bounce` with literal delays. |
| `features/public/LandingWelcome.tsx` | `LEAVE_MS` = `MOTION_DURATION.standard` = `.auth-leave` (MOT-05: no early navigation). |
| `features/pwa/InstallInvite.tsx` | `motion-slide-up` instead of `animate-[fadeIn_200ms_ease-out]` (a keyframe that did not exist). |
| `features/ui/Field.tsx`, `features/requests/ReadinessPanel.tsx` | `scrollBehavior()`: instant under reduced motion (A11Y-03). |
| `features/ui/LiveNumber.tsx`, `features/ui/pane-close.ts`, `features/ui/top-layer.ts`, `features/work/celebrate.tsx` | Fallback timers and WAAPI timing from the tokens (top-layer: a named safety cap). |
| `features/work/client.tsx`, `PaneParts.tsx`, `ProjectHeader.tsx`, `ShareDialogs.tsx` | Raw `<dialog>`s close through `closeTopLayer` (their exit now plays in Firefox and Safari). |
| `features/work/FieldControls.tsx`, `GridCellEditors.tsx`, `features/admin/TryAsButton.tsx`, `features/ui/RichEditor.tsx` (emoji), `features/ui/PeoplePicker.tsx`, `features/ui/PersonSelect.tsx`, `features/work/TaskCreator.tsx` (pickers) | `pop-in` (they appeared abruptly). |
| `features/work/CustomizePanel.tsx` | `drawer-in`. `TaskCreator` window: `motion-scale-in`. |
| `features/ui/HubTabs.tsx` | Colour change on the hover token. |
| `features/analytics/FitPages.tsx` | UIQA-PERF-01: the page bar moved below the sections (sticky at the bottom); a measurement restores the shown sections in the same task and renders only when the packing changed (no flicker). |
| `app/superadmin/dev/motion/page.tsx`, `features/superadmin/MotionPlayground.tsx` (new) | The Motion Playground. |
| Tests | New `tests/ui/motion-tokens-v189.test.ts`, `tests/e2e/v1890-motion.spec.ts`; updated `tests/ui/navigation-continuity.test.ts`, `tests/ui/motion-review.test.tsx`, `tests/e2e/v1800-motion.spec.ts` (the switch is put back to its default, not to OFF). |
| Docs | `docs/qa/*` (this set), `docs/GLOBAL_MOTION_NAVIGATION_IMPLEMENTATION.md`, `docs/USER-GUIDE.md`, `app/users/help/page.tsx`, `docs/RELEASE-NOTES.md`, `docs/DEPLOYMENT.md`, `docs/DATA_MODEL.md`, living files. |

## Not changed on purpose

Brand loaders and skeleton shimmer (loops), the approval journey's scene timings, celebration burst length, debounces: see GLOBAL_MOTION_TOKENS "Documented exceptions".
