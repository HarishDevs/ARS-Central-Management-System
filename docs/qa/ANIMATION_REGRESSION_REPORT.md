# Animation regression report (v1.89.0 stage 2, D-420)

**Question:** did the new motion system (new tokens, page transitions on by default, transform-only motion, the FitPages change) break anything that worked?
**Method:** the existing e2e specs that touch motion, navigation, overlays, the shell, the tour, the journey, Analytics and the phone layout, re-run on the final build (production build, `ars_approvals_test_r189`, fresh per run, port 3280), plus all unit tests. Transitions are **on** in every run (the new default), so every spec below also exercised them.

## Unit

| Suite | Result |
|---|---|
| All unit tests (`npx vitest run`) | **218 files, 2,013 tests passed** (before the last small fixes; re-run at the end, see FINAL_MOTION_QA_REPORT) |
| `tests/ui/motion-tokens-v189.test.ts` (new, 15) | passed |
| `tests/ui/navigation-continuity.test.ts` (token values updated to D-420) | passed |
| `tests/ui/motion-review.test.tsx` (role values, reduced-motion token, switch default ON) | passed |

## e2e, Chromium (final build)

| Specs | Result | Notes |
|---|---|---|
| v1800-motion, v1870-motion-perf, v1760-pane-url, v1830-task-pane | **21 / 21 passed** | v1800-motion now restores the switch to its default (it used to leave an explicit OFF row behind) |
| v1870-navigation-continuity, v1890-navigation, v1120-analytics, v1140-tour | 32 / 33, then **fixed** | v1120 "choosing whose numbers … keeps the dashboard" expected "Delivery against due dates" visible on the first page. That section is a grid and used to ignore `hidden` (the same bug that caused the Analytics flicker), so it showed on every page. Now it is on its own page; the test uses the file's own `seeOnSomePage` helper. Re-run: see FINAL_MOTION_QA_REPORT |
| v1120-analytics, v141, v142, v144-journey, v143-mobile, picbot, v1860-header-consistency, v136-ui-states, v1790-overview-parity | 56 passed, 1 failed, 3 skipped, 3 not run | The failure is v141 "My requests: … progress cell": "No requests match" for E2E_REQ. It needs requests raised by an earlier spec (data-order dependency, like v172-lists in stage 1). Run after `approval-flow`: **13 / 13 passed** (v141 + approval-flow). The skipped / not-run tests are v141's serial tail after that failure |
| v1890-motion (new) | **8 / 8 passed** | |

## e2e, Firefox 155 and WebKit

See TRANSITION_QA_REPORT for v1890-motion per browser and FINAL_MOTION_QA_REPORT for the re-run of v1890-navigation / v1800-motion / v1830-task-pane in Firefox.

## Behaviour changes that are intended (not regressions)

| Change | Where a test or person could notice |
|---|---|
| Page transitions on by default | a 200 ms fade on page changes; `data-vt` appears on `<html>` during a navigation |
| Back / Forward not animated | v1.80 animated Back with a fade; now instant |
| Analytics page bar below the sections | the "Page 1 of N" bar is at the bottom of the window (sticky), not the top |
| Grid sections on Analytics obey the pages | a section that showed on every page now shows on its own page only |
| Sidebar width snaps | no 150 ms width animation; labels fade in |
| Menus close at once | unchanged from v1.87 (documented now) |
| Toasts leave with a 150 ms fade | a toast stays in the DOM 150 ms after dismissal (tests that wait for it to be hidden keep working) |
| Durations | modal 220 → 250 ms, drawer 280 → 250, page 150 → 200, emphasis 350 → 300 |
