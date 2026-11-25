# Final QA sign-off: v1.89.0

**Date:** 25 Nov 2026. **Branch:** `release-189` (final build at the last stage 4 commit; version still 1.88.0 in `package.json` until the owner's release). **Decisions:** D-419 … D-426. **Status:** **ready for the owner's release**, with the risks in §5 and the gaps in §6. Nothing here was run against the live database or live services: every run used throw-away test databases (`ars_approvals_test_r189`, `_r189ff`, `_r189wk`, `_r189vr`, `_r189int`, the reference `_r189ref`) and a local mock AI provider.

## 1. What the release contains (all stages)

| Stage | Decision | Content |
|---|---|---|
| 1 | D-419 | Navigation audit NAV-01 … NAV-08 fixed (return address keeps the view, no-access `next=` lands home, ways back from Admin → Records, breadcrumbs name the list of origin, ← All users keeps search, Back asks before dropping a comment, BackLink stays in the app); Firefox and WebKit harness. |
| 2 | D-420 | Motion and transition system: the owner's timings, page transitions on by default, transform / opacity only, reduced motion, Analytics CLS fixed. |
| 3a | D-421 | P1 long-title overflow; shell and design tokens (header 64 / 56, sidebar 250 / 72, padding 24 / 16, content left-aligned up to 1,600, control sizes 32 / 40 / 42 / 48); tablet rail. |
| 3b | D-422 | Shared components: sizes only from tokens (lint), buttons size to their words, ListPage and phone cards, StatePage, one Avatar, Dialog parts. |
| 3c | D-423 | Module pages: one toolbar on every list, phone cards for every table, one DataTable, dialogs on Dialog, "New …" wording, RecordNo, back link and badges, unknown addresses inside the shell. |
| 3d | D-424 | Accessibility, overlays, the pre-existing e2e failures: contrast tokens, entry-motion fill bug, devices page, FORM-01 / 02, ListPage everywhere, one popover surface, toast live regions, PERF-02. |
| 3e | D-425 | Content: one date formatter in India time (lint), relative times after mount (#418), 24 date inputs on the shared picker, wording. |
| 4 | D-426 | The last 32 native date inputs on `DateField` (lint), the task pane refresh bug (v162 root cause), v1100 G-3 test, Profile photo target size, Task Summary "Show" label, visual baselines, this sign-off. |

## 2. Test totals

### Static and unit (final tree)
| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` (eslint ., with `ars-ui/control-size`, `spacing-scale`, `type-scale`, `date-format`, `date-input`) | clean |
| `npm run build` | clean (final build) |
| Unit (`vitest run`) | **226 files, 2,081 tests: all pass** |
| Integration (`vitest.integration`, alone on `ars_approvals_test_r189int`) | **100 files, 654 tests: all pass** (v1100 G-3 fixed) |

### End-to-end: the full suite (114 spec files, suite order, chunked, one database per browser)

| Browser | Build | Passed | Failed | Skipped | Not run (behind a failure in a serial file) |
|---|---|---|---|---|---|
| Chromium | `59e9ed7` (stage 4 part 1; three browsers in parallel) | 489 | 8 | 60 | 5 |
| Firefox (`D:\pw-firefox-1543`) | `5d64de6` (final app code except the Profile button fix) | 466 | 14 | 59 | 23 |
| WebKit (Playwright 1.63 on Windows) | `5d64de6` | 393 | 32 | 59 | 78 |

Skipped: 56 in every browser are the gated UIQA / probe specs (`UIQA=1`) and 3-4 are tests a spec skips by design (e.g. Chromium-only checks).

### Re-runs on the final build (alone, the same database)
| Run | Result |
|---|---|
| Chromium: the 4 non-crawl failures (v131, v1523, v1700, CON-18) | **19 / 19 pass** (fixed test races: v131, v1523, CON-18; v1700 passed unchanged) |
| Chromium: crawl (v1730, 9 tests) | **9 / 9 pass** |
| Chromium: the specs touched by stage 4 parts 2-5 (v121, v138, v162, v164, v167, v169, v1850, v1890-content, v1890-accessibility, v1760, v1780) | 49 pass, 1 fail (v1780 "profile's Tasks card": the re-run's new tasks sort below the card's first five on a database that already ran the suite: a re-run artefact; passed in the full run) |
| Chromium: final (v135, v160-ui, v1890-accessibility, -content, -ui-components, -ui-shell) after the Profile fix | **41 / 41 pass** |
| Chromium: v162 (pane refresh root cause) | **3 × 6 / 6** |
| Chromium: zz-site-audit | completes in 16 min; findings: 2 × React #418 (risk R1) |
| Firefox: the 11 failing files | 36 pass, 7 fail, 10 not run → classified in §4 |
| WebKit: the 15 failing files not yet checked on the reference | 42 pass, 12 fail, 38 not run → classified in §4 |

### Visual baselines (Chromium, `VISUAL=1`)
155 screenshots, 19.5 MB; two compare runs on fresh databases after the baselines: **155 / 155 identical, twice**; after the Profile fix the 2 Profile shots were updated and two further compare runs on the final build: **155 / 155 identical, twice** (`final4-compareA`, `final4-compareB`). Details: [VISUAL_REGRESSION_REPORT.md](VISUAL_REGRESSION_REPORT.md).

## 3. UIQA sign-off sweep (final build)

SWEEP_TABLE

## 4. Every failure and its classification

**Rule applied:** an app bug is fixed; a test bug is fixed without loosening an assertion; anything else is harness, with evidence (the same failure on the stage 3e build `8b6c705`, run from a temporary reference worktree on its own database and port, or not reproducible alone).

### App bugs found by the runs (all fixed)
| Where | Bug | Fix |
|---|---|---|
| e2e v162 (all browsers) | The task side pane stopped refreshing after an action (Suspense boundary of D-424) | Boundary removed, Undo sets the button (BUG_FIX_LOG stage 4) |
| e2e v160-ui RA-03 / crawl (Firefox) | Profile photo buttons under 24 px (axe target-size) | `min-h-6` |
| Visual baselines | Task Summary "Show" label squeezed | `shrink-0` / `w-auto` |
| e2e v1552 (Chromium) | (test) calendar text now 12 h | test updated |

### Test bugs (fixed, no assertion loosened)
v1100 G-3 (stale page key), v1552 (12 h), v131 (reload raced the save), v138 (two Undo buttons), v1523 (fixed 400 ms waits), CON-18 (measured mid scale-in), v1722 G1 (clipboard permissions outside Chromium), v1870-motion-perf (CDP heap in Chromium only), the axe helpers' animation wait (bounded to 5 s: Firefox colour transitions stuck at 0), zz-site-audit (time budget 40 min). Rows: BUG_FIX_LOG stage 4.

### Harness only (with evidence)
| Browser | Tests | Evidence |
|---|---|---|
| WebKit | v1125 stale-page banner; v128 sign-in loader; v133 table filters; v141 notifications; v150 draft; v1523 remark; v160-ui UI-02 theme; v160-workspace WS-02; v161 Save view; v1641 sticky heading; v167 workload | **Fail the same on the stage 3e build** (reference run in WebKit, `logs/ref-webkit-1.log`). Common cause: Playwright's WebKit on Windows runs the page's script 5-7 s after load, so the test's first click or key reaches no listener. |
| WebKit | v127, v131, v135, v144, v162 Board / celebrations, v1720, v1722, v1730-layout-parity, v1790, v180, v1800-motion, v1840 ×2, v1870-motion-perf record pane, v1870-navigation-continuity | Different tests fail on each run (e.g. v131, v135, v144, v162 Board pass on the re-run or on the reference); the failing steps are clicks / navigations right after load ("interrupted by another navigation", a click timing out, a list row not yet drawn). Reference result for the files still failing on the re-run: WEBKIT_REF2. |
| WebKit | crawl "to and fro" ×4; zz-site-audit | Console lines only: `Fetch API cannot load …?_rsc=… due to access control checks` / `Failed to fetch RSC payload … Load failed`: WebKit's messages for prefetches cancelled because the test navigated on (filtered as "prefetch noise" by the sweep since stage 3c). Pages landed right. |
| WebKit | crawl "every route" light 1366: one axe colour-contrast inside the Create task window on `/users/tasks/new` | Not reproducible: 4 targeted axe runs in WebKit (settled and straight after load, both themes, 1280 and 1366) found nothing; the sweep's WebKit axe on the page is 0. Measured during the window's entrance. |
| Firefox | v1100-web WEB-01 (console lines: "A ServiceWorker intercepted the request and encountered an unexpected error", `JSHandle@object`) | **Same on the stage 3e build** (`logs/ref-firefox-1.log`). The test changes viewport and page in quick succession; Firefox reports the service worker's aborted fetches. No page scrolled sideways (the assertion the test is about passed in every viewport). |
| Firefox | v1110, v131, v132, v135, v1780 R3 (`NS_BINDING_ABORTED` on `page.goto` / `page.reload`) | The test reloads while the app's own refresh after an action is in flight; Firefox aborts one of the two navigations. **Pass on the stage 3e build and on re-runs** (different tests each run). |
| Firefox | v1770, v1780, v1830 (`waitForFunction` 60 s) | The axe helper's animation wait: Firefox leaves a colour transition at currentTime 0 after a theme switch (also seen in stage 2). **Same on the stage 3e build**; the helper is now bounded (test fix above). |
| Firefox | v1770 "Customise › Fields" (`Browser.removeBrowserContext … _maybeDontRestoreTabs`) | Playwright / Firefox protocol error while closing a context; not in the app. |
| Firefox | v1890-ui-modules RESP-01 (`NS_BINDING_ABORTED` once) | Passed in every other run (stage 3c-3e and the Firefox re-runs of v1890-*). |
| Chromium | first full run: v131, v1523, v1700, CON-18, crawl ×3, zz-site-audit | Fixed test races (above) or passed alone (v1700, crawl 9 / 9); the full run had three browsers and a visual run beside it. |

## 5. Remaining risks

| # | Risk | Evidence | Recommendation |
|---|---|---|---|
| R1 | **Intermittent React #418 (hydration) on long server-streamed list pages**: seen 6 times in stage 4 (Admin task type, Super Admin audit log ×2, deliveries ×2, Task Summary on a phone), only after the full suites had filled the databases and mostly with other browsers running. | Caught once with the HTML: the server's text and the page's final text are identical; the only difference is where a late, outlined segment of the list (the saved-views row, `ListViews`) was streamed (`P:1` / `$RS`) inside the page's loading boundary. React recovers by drawing that part in the browser; nothing visible changes. 0 in 40 loads on the stage 3e build with its small database; 1 in 100 loads on the final build; not seen in the UIQA sweeps (SWEEP_418). | Low user impact (a console error, the page is right). Follow-up after release: reproduce with a development build of React to get the component, and consider loading the saved views with the page's other data. |
| R2 | Real Safari (macOS / iOS) not tested: view transitions stay off in WebKit (D-424); the WebKit e2e suite has many harness failures. | §4 | Owner / IT: one UAT pass on an iPhone and a Mac before go-live. |
| R3 | The visual baselines are Windows-rendered Chromium only. | VISUAL_REGRESSION_REPORT §6 | Regenerate on the CI image if CI runs them. |
| R4 | The e2e WebKit and Firefox suites are not green as a whole on this harness (timing). | §4 | Do not gate releases on them; gate on Chromium + the v1890-* sets in all three. |

## 6. Not tested

- **Real Safari / iOS / iPadOS** (only Playwright's WebKit on Windows), **real Android Chrome** (only Chromium at phone sizes with touch emulation).
- **Screen readers:** no NVDA, JAWS, VoiceOver or TalkBack pass (ACCESSIBILITY_TEST_REPORT §5-6).
- **Slow network / loading states under throttling** (UIQA-TC-137), offline beyond the forms probe.
- **The live site** (GoDaddy), real email / WhatsApp / Google sign-in / push: not part of this stage.
- **Edge**: not re-run in stage 4 (it ran in the phase 1 sweep and is Chromium-based).
- **Print, copy, export file contents**: not re-checked in stage 4.
- **Load / performance** beyond the motion-perf and CLS checks.

## 7. Defect counts (whole release)

| Severity | Phase 1 register (opened) | Fixed | Closed, not a defect | Deferred |
|---|---|---|---|---|
| P0 | 0 | 0 | 0 | 0 |
| P1 | 1 | 1 | 0 | 0 |
| P2 | 9 | 9 | 0 | 0 |
| P3 | 27 | 26 | 1 (OVL-01, harness) | 0 |
| P4 | 7 | 7 | 0 | 0 |

Found and fixed during the stages (not in the register): 1 P1 (never released: the users catch-all route, 3c), 3 P2 (entry-motion transform 3d, WebKit view-transition crash 3d, **task pane refresh 4**), 5 P3 (rail icons 3a, Records rows 3c, devices hang 3d, 32 date inputs 4, Profile target size 4), 5 P4 (button order 3a, meta-refresh 3d, 24 h texts 3e, lint gaps, "Show" label 4). Deferred: the motion rows MOT-D1 (owner decision, stage 2) and R1 above (P3, investigation).

## 8. For the owner before tagging

1. Version bump to 1.89.0 (`package.json`), the release-notes heading date, merge `release-189` to `main`, tag, deploy (unchecked item "RELEASE v1.89.0" in PLAN-CHECKLIST).
2. No migration, no new environment variable, no setting to change (except, only if it was ever saved Off, Super Admin → Settings → Features → Page transitions).
3. The visual baselines (`tests/visual/__screenshots__`, 19.5 MB) are in the branch; they run only with `VISUAL=1`.
4. Plan a short UAT on a real iPhone / Mac (R2) and one screen-reader pass.
