# Final motion audit (v1.89.0 stage 2, D-420)

**Against:** the owner's motion brief (24 Nov 2026), [GLOBAL_MOTION_AUDIT.md](GLOBAL_MOTION_AUDIT.md) and [GLOBAL_TRANSITION_INVENTORY.md](GLOBAL_TRANSITION_INVENTORY.md). Each line says how it was checked; "checked by a test" names the test; nothing is claimed without one of: a test, a measurement, or a code search that is itself a unit test.

## The brief, point by point

| Requirement | Met? | How it was checked |
|---|---|---|
| Durations instant 100 / fast 150 / standard 200 / smooth 250 / emphasis 300 | Yes | `motion-tokens-v189` (CSS and TS values); Playground e2e (CSS = TS rendered in Chromium, Firefox, WebKit) |
| Easing standard (0.2,0,0,1), enter (0,0,0.2,1), exit (0.4,0,1,1) | Yes | `motion-tokens-v189` |
| Page 200, modal and drawer 250, dropdown 150 | Yes | `motion-tokens-v189` (roles, CSS role variables); `motion-review` |
| One token source in CSS + a TS mirror | Yes | `motion-tokens-v189` (CSS = TS; motion-rules re-exports the same object) |
| No hard-coded durations / easings in components (`.picbot-in` included) | Yes, with documented exceptions (loops, journey scene, debounces, safety caps) | `motion-tokens-v189` "no hard-coded durations or easings" (all of `features/` and `app/` except the journey) and "globals.css: interface motion is on the tokens" |
| Old tokens mapped / retired and documented | Retired, documented | `motion-tokens-v189` "retires the v1.87 names"; GLOBAL_MOTION_TOKENS "Retired" |
| Transform and opacity only, no layout-property animation | Yes (colour on hover allowed: paint only) | `motion-tokens-v189` "never animates width, height, top or left"; `motion-review` "only animates opacity and transform" (plus colour) |
| Full prefers-reduced-motion support | Yes | global 0.01 ms rule + per-class blocks (`navigation-continuity`, `motion-review`); code helpers; unguarded smooth scroll forbidden (unit); e2e "reduced motion" (3 browsers) |
| 60 FPS target | Met where measurable (Firefox: p95 12 ms, 98 % of frames < 20 ms during page transitions) | PERFORMANCE_VALIDATION §3; headless Chromium paces rAF at ~20-30 Hz in this harness; WebKit harness slow regardless of motion |
| No new library / dependency | Yes | `package.json` unchanged |
| Page transitions ON by default, subtle fade + small rise, 200 ms, enter | Yes | e2e test 1 (3 browsers); `motion-tokens-v189` (default ON, CSS) |
| Super Admin switch stays as a kill switch | Yes | e2e test 4 (3 browsers) |
| Stored OFF handling decided | Yes (no row = ON; a saved row respected; release notes tell the owner) | D-420; `planSettingChanges` writes rows only on a change |
| WebKit crash: reproduce, root cause, fix | Yes | reproduced on the old code (callback pending 3.1 s / 4.26 s; page stopped answering); fixed; e2e tests 1-2 pass in WebKit |
| No layout shift from transitions | Yes | e2e test 6 runs with transitions on; CLS ≤ 0.021 (Chromium) |
| No focus loss | Yes | e2e test 1: the new h1 is focused after an animated move; focus kept when the person moved it |
| No scroll-position bugs | Yes | e2e test 3 (scrollY kept after Back, 3 browsers) |
| No double render of the side pane | Yes | e2e test 7 (one pane at a time; Chromium, Firefox); one `main#main`, one sidebar (test 1) |
| Back / Forward not broken | Yes | e2e test 2 (3 browsers); v1890-navigation (Chromium, Firefox) |
| The 50 inventory areas implemented or marked "not appropriate" with a reason | Yes (25 done, 16 kept on tokens, 5 not appropriate, 4 deferred with reasons) | TRANSITION_IMPLEMENTATION_REPORT; inventory Fix status column |
| CLS Analytics 0.25-0.55 → < 0.1 | Yes: 0.000-0.021 | e2e test 6 (Chromium) |
| CLS Task Summary with a task 0.36-0.38 → < 0.1 | 0 measured; the audit's trigger not reproduced on the test data | e2e test 6 |
| Motion Playground: hidden, Super Admin only, 404 for others, no title leak, not linked | Yes | e2e test 8 (3 browsers); unit (requireArea, static title, no link anywhere) |
| Unit tests for the token mirror | Yes | `motion-tokens-v189` (15) |
| e2e v1890-motion in Chromium, Firefox, WebKit | Chromium 8/8, Firefox 8/8, WebKit 7/8 + 1 not verified (harness, see TRANSITION_QA_REPORT) | |

## Defects from phase 1, final state

| ID | Final |
|---|---|
| UIQA-MOT-01 | Fixed |
| UIQA-MOT-02 | Fixed in Playwright WebKit; **real Safari not verified** (no Mac available) |
| UIQA-MOT-03 | Fixed (one-step width + label fade) |
| UIQA-MOT-04 | Fixed (all 11) |
| UIQA-MOT-05 | Fixed |
| UIQA-A11Y-03 | Fixed |
| UIQA-PERF-01 | Fixed (0.021 max) |
| UIQA-PERF-02 | Not reproduced (0); guarded |
| UIQA-CON-18 | Motion part fixed; radius / z / aria-modal parts go to stage 3 (UI unification) |
| UIQA-OVL-01 (WebKit pane Escape, suspected) | Not in this stage's scope; not re-tested |

## Open items

1. Real Safari check of page transitions (MOT-D2).
2. Deferred inventory rows 15, 34, 35, 38 (MOT-D1).
3. WebKit test 7 (pane frame times) not verified because the WebKit harness was slow for every navigation at the end of the session.

## Sign-off re-check (v1.89.0 stage 4, D-426, 25 Nov 2026)

Every point above was re-checked by the final runs (FINAL_MOTION_QA_REPORT, last section): the motion specs pass in Chromium and Firefox and, in WebKit, `v1890-motion` 8 / 8 and `v1800-cls` 1 / 1 (the one WebKit failure in `v1800-motion` fails the same on the stage 3e build). No CLS above 0.05 in any browser's sweep. No motion decision changed in stage 4; the defects table above stands, with UIQA-PERF-02 now held by `PaneReserve` alone.
