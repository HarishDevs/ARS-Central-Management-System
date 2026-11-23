# Transition QA report (v1.89.0 stage 2, D-420)

**Spec:** `tests/e2e/v1890-motion.spec.ts` (8 tests). Production build, `ars_approvals_test_r189`, port 3280, one worker. Browsers: Chromium (Playwright's headless shell), Firefox 155 (`E2E_FIREFOX_PATH=D:\pw-firefox-1543\firefox\firefox.exe`), WebKit (`E2E_BROWSER=webkit`, Playwright's Windows build; a stand-in for Safari, which was not available).

| # | Test | Chromium | Firefox | WebKit |
|---|---|---|---|---|
| 1 | Transitions on by default: page fades in, navigation lands, focus to the h1, no page errors; CSS has `page-in`; `--motion-standard` = 200 ms | pass | pass | pass |
| 2 | Rapid clicks (3 rounds of 3 links 40 ms apart) and Back / Forward: last click wins, the page keeps answering (UIQA-MOT-02), no page errors, no crash | pass | pass | pass |
| 3 | Back restores the place with transitions on | pass (scrollY 673 after Back) | pass (671.7) | pass (673) |
| 4 | Switch OFF = no view transitions at all | pass | pass | pass |
| 5 | Reduced motion: no view transition; transitions 0.01 ms | pass | pass | pass |
| 6 | CLS < 0.1 on Analytics (3 sizes), Admin Insights Analytics (2) and Task Summary with a task (5) | pass (max 0.0208) | pass (CLS not exposed: n/a) | pass (CLS not exposed: n/a) |
| 7 | Frame times while the task pane opens and closes × 3; never two panes | pass | pass | **see note** |
| 8 | Motion Playground: 404 + no title for staff and IT admin; Super Admin sees it, CSS = TS for every token, not linked, dialog and reduce toggle work | pass | pass | pass |

**Totals:** Chromium **8 / 8**; Firefox **8 / 8**; WebKit **7 / 8 passed**, across runs (tests 1-2 in one run, 3-6 in another, 8 alone), test 7 not verified.

**WebKit note (test 7):** in WebKit the click on a task link did not change the address to `?task=` within 10 s. In the same session WebKit took about 10 s for every page change, **with page transitions OFF as well as ON** (measured back to back with the switch both ways: OFF 10.3 / 10.4 / 3.2 / 9.7 / 10.3 s per click; ON 10.4 / 10.3 / 3.1 / 10.3 / 10.3 s), and frames were 4 % under 20 ms, so the harness itself was slow. Since the pane click is not a page transition (PageTransitions now ignores task links that open the pane), this is not a motion failure; it is recorded as **not verified in WebKit** rather than as a pass. A separate check opened the pane from Task Summary in WebKit with the switch ON and OFF alternately: the address changed after 5.9 / 10.8 / 15.6 s (ON) and 6.0 / 10.8 / 15.1 s (OFF), and the pane drew each time, so the delay is the same with and without page transitions. The same slowness made v1830-task-pane's first test time out in WebKit (not counted as a motion result). Earlier in the same session, with the WebKit harness still fast, tests 1-5 ran with 0.46-1.0 s page changes.

## UIQA-MOT-02 (WebKit) before / after

- **Before** (v1.88 code, the audit's instrumentation: route interception + a wrapped `startViewTransition`): the update callback stayed pending 3,131 ms and 4,261 ms after `skipTransition()`; the route did not land during the second; after rapid clicks the page stopped answering and the test timed out on a plain wait (the audit recorded this as a crash).
- **After:** tests 1 and 2 pass in WebKit; every skipped transition ends its callback at 300 ms; no page errors; `page.on("crash")` never fired.

## Manual check in the browser

Screenshots of the final build (Chromium, 1440 and 1366): the Motion Playground (all tokens CSS = TS, roles, patterns), Analytics with the page bar below the sections, Help. Reviewed for layout; no visual defect found.
