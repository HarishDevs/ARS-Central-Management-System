# Final motion QA report (v1.89.0 stage 2, D-420)

**Branch:** `release-189`. **Build:** production (`npm run build`, then `next start` on port 3280); test database `ars_approvals_test_r189` (recreated by the e2e global set-up on every run); mock provider port 4181.

## Static checks and unit tests (final tree)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **clean** |
| `npm run lint` (eslint .) | **clean** |
| `npx vitest run` | **218 files, 2,013 tests passed** (new: `tests/ui/motion-tokens-v189.test.ts`, 15) |
| `npm run build` | **OK** (the final code was built and served for the e2e runs) |

## e2e: the new spec (`tests/e2e/v1890-motion.spec.ts`)

| Browser | Result |
|---|---|
| Chromium | **8 / 8** (final build, twice; the second run together with v1120-analytics: 14 / 14) |
| Firefox 155 | **8 / 8** |
| WebKit (Playwright, Windows) | **7 / 8 passed**, 1 not verified (pane frame times: the WebKit harness was slow for every navigation, switch ON or OFF; see TRANSITION_QA_REPORT) |

## e2e: existing specs re-run on the final build

| Browser | Specs | Result |
|---|---|---|
| Chromium | v1800-motion, v1870-motion-perf, v1760-pane-url, v1830-task-pane | **21 / 21** |
| Chromium | v1870-navigation-continuity, v1890-navigation, v1140-tour, v1120-analytics | 32 / 33 → v1120 test updated (a grid section now obeys the board's pages) → v1120 **6 / 6** on re-run |
| Chromium | v141, v142, v144-journey, v143-mobile, picbot, v1860-header-consistency, v136-ui-states, v1790-overview-parity (+ v1120) | 56 passed; v141's progress-cell test needs requests raised by an earlier spec (pre-existing data-order dependency): approval-flow + v141 **13 / 13** |
| Firefox 155 | v1890-navigation, v1800-motion, v1830-task-pane | **30 / 31**; the 1 is v1830 "axe in light, dark and at phone width": its helper waits until no animation is running, and in Firefox the colour transitions started by switching to dark stay at currentTime 0 (`.field-input` transitions included, which existed before this stage). Not a motion defect of this stage; noted for stage 3 (a theme switch could suppress transitions) |
| WebKit | v1830-task-pane (first test) | timed out on the slow WebKit harness (5-16 s per pane open, the same with page transitions OFF); not counted |

## What was verified by hand

Screenshots of the final build: the Motion Playground (1440), Analytics at 1366 × 768 with the page bar below the sections, Help (the updated topic). No visual defect found.

## Cleanup

The test database `ars_approvals_test_r189` dropped, ports 3280 / 4181 free, the `node_modules` junction removed; the temporary e2e config and the repro spec used during the investigation were deleted before the commit.

## Not done in this stage (and why)

- **Real Safari**: no macOS / iOS device; Playwright WebKit on Windows only (MOT-D2).
- **Inventory rows 15, 34, 35, 38** (drag-and-drop FLIP, preview content during the exit, new-comment entrance): deferred with reasons (TRANSITION_IMPLEMENTATION_REPORT; MOT-D1).
- **UIQA-PERF-02** (Task Summary with a task, 0.36-0.38 in the audit): not reproduced on the test data (0 at every size); guarded by the e2e.
- **Menus / dropdowns / bell exit animation**: decided against (focus returns at once; no duplicate items in the page).

## Re-verified at the v1.89.0 sign-off (stage 4, D-426, 25 Nov 2026)

Full e2e suites (FINAL_QA_SIGNOFF §2); the motion specs per browser (passed / failed):

| Spec | Chromium | Firefox | WebKit |
|---|---|---|---|
| `v1800-motion` (12) | 12 / 0 | 12 / 0 | 2 / 1 (+9 not run behind it): "Escape gives focus back to its button": **fails the same on the stage 3e build** (WebKit does not focus a button on a mouse click) |
| `v1870-motion-perf` (2) | 2 / 0 | 2 / 0 (after the CDP heap read was limited to Chromium) | task pane 50 cycles **pass on the re-run**; record pane 50 cycles timed out under the parallel run (480 s) |
| `v1890-motion` (8) | 8 / 0 | 8 / 0 | 8 / 0 |
| `v1800-cls` (1) | 1 / 0 | 1 / 0 | 1 / 0 |
| `v1760-pane-url`, `v1830-task-pane` | 7 / 0 | 3 / 1 (v1830: a click before the page settled; the step passed on the 3e build) | 7 / 0 |

Sweep: CLS > 0.05 on 0 visits in Chromium (light 1,783 and dark 354), Firefox and WebKit (FINAL_QA_SIGNOFF §3). The stage 4 change that touches motion: the task pane's details are sent with its frame again (no Suspense, D-426); PERF-02 stays fixed by `PaneReserve` (the v1890-accessibility PERF-02 guard passes in all three browsers). Open items unchanged: real Safari (MOT-D2), MOT-D1.
