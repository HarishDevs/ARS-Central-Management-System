# Performance validation: motion and transitions (v1.89.0, D-420)

**Measured, not estimated.** Production build (`npm run build` + `next start`, port 3280), test database `ars_approvals_test_r189` (fresh per run), Playwright 1.5x on Windows 11 (build 26300): Chromium (headless shell), Firefox 155 (`D:\pw-firefox-1543`), WebKit (Playwright's Windows build, a stand-in for Safari). Source: `tests/e2e/v1890-motion.spec.ts`, which writes `test-results/motion-<browser>.json`; the numbers below are copied from those files of the final runs.

**How:**
- **Frames:** a `requestAnimationFrame` loop records the gap between frames while the test navigates (4 sidebar page changes with transitions on) or opens and closes the task pane 3 times. Reported: frames, the longest gap, the 95th percentile gap, and the share of frames under 20 ms (60 FPS = 16.7 ms per frame). This covers the whole interaction (network, React render, animation), not only the animation.
- **CLS:** `PerformanceObserver("layout-shift")` from the first paint, shifts after input left out, 2 s after network idle, second visit of each page (the first warms the server). Engines without layout-shift entries (Firefox, WebKit) report **n/a**, never 0.
- **Long tasks:** `PerformanceObserver("longtask")` during the same load (Chromium only; n/a elsewhere).

## 1. Layout shift (target < 0.1)

| Page | Viewport | Before (phase 1 audit, Chromium) | After (Chromium) | Firefox / WebKit |
|---|---|---|---|---|
| `/users/analytics` (manager) | 1366 × 768 | 0.548 | **0.0208** | n/a |
| | 1280 × 720 | 0.405 | **0** | n/a |
| | 1920 × 1080 | 0.317 | **0.0083** | n/a |
| `/admin/insights/analytics` (IT admin) | 1366 × 768 | 0.364 | **0.0001** | n/a |
| | 1920 × 1080 | 0.255 | **0.0091** | n/a |
| `/users/work/my-tasks?task=<id>` (staff) | 1366 × 768 | 0.381 | **0** | n/a |
| | 1280 × 720 | 0.365 | **0** | n/a |
| | 1440 × 900 | 0 | **0** | n/a |
| `/users/work/my-tasks?task=<id>` (manager) | 1366 × 768 | — | **0** | n/a |
| | 1280 × 720 | — | **0** | n/a |

- Same-build check of the Analytics fix (this stage, Chromium, `/users/analytics` 1366): before any fix **0.349**; with the page bar below the sections **0.156**; with hidden grid sections really hidden **0.0208**. The remaining 0.02 is the "Refreshed at" line under the board moving when the board's first page is drawn (below the fold at 1366; under the target).
- **Task Summary with a task open:** the 0.36-0.38 of the audit was measured on the audit's data set. On the test database it is **0** for both a staff member and a manager at 1280 / 1366 / 1440, before and after this stage, so the trigger was not reproduced; the e2e keeps it guarded at < 0.1.
- Page transitions add no layout shift (the snapshots are pseudo-elements): the phase 1 probe measured CLS 0.0001 over a navigation session with the switch on; the e2e above runs with transitions on (default).

## 2. Long tasks while a page loads (Chromium)

Per page load in the CLS run: 1-2 long tasks, the longest **86-130 ms** (Analytics 86-105 ms, Task Summary with the pane 105-130 ms). These are the page's hydration, not motion; no long task was attributed to an animation (all motion runs on the compositor: opacity and transform).

## 3. Frame times

| Interaction | Browser | Frames | Longest gap | p95 gap | Frames < 20 ms |
|---|---|---|---|---|---|
| 4 page changes, transitions on | Chromium | 108 | 133 ms | 50 ms | 70 % |
| | Firefox | 964 | 144 ms | 12.1 ms | 98 % |
| | WebKit | 541 | 289 ms | 169 ms | 4 % |
| Task pane open / close × 3 | Chromium | 159 | 200 ms | 49.9 ms | 81 % |
| | Firefox | 269 | 184 ms | 38 ms | 91 % |

Reading:
- **Firefox (a real, GPU-composited headless engine here) holds 60 FPS** through the page transitions (p95 12 ms, 98 % of frames under 20 ms); the longest gaps (≈ 140-180 ms) are the moments the new page is rendered by React, once per navigation, not the animation.
- **Chromium headless shell** paces `requestAnimationFrame` at about 20-30 Hz in this harness (its p95 of ~50 ms is the same with and without an overlay animating: pane cycles 49.9 ms, page changes 50 ms), so it can't show 60 FPS here; it shows no extra gaps during the animations.
- **Playwright's WebKit on this Windows machine** was slow for everything in the final runs, with transitions **off** as well: each sidebar navigation took about 10 s with the switch **OFF** and about 10 s with it **ON** (same harness, same build, measured back to back), and frames were 4 % under 20 ms. Earlier in the same session the same navigations took 0.46-1.0 s. So the WebKit frame numbers describe the harness, not the motion; real Safari was not available (open item MOT-D2).
- The 60 FPS target is met where the engine can show it (Firefox). Every animation moves only opacity and transform (unit-guarded), so it stays on the compositor.

## 4. Transition timing (Chromium, click to new address)

Four sidebar navigations with transitions on: **158-199 ms** each (first run of the final build: 181 / 177 / 161 / 158 ms). View transitions started 4, skipped 0; rapid clicks (3 × 3 within 120 ms each round, then Back / Forward): 12 started, 0 skipped in Chromium and Firefox; WebKit (slow harness, above): 12 started, 12 skipped at the 300 ms limit, and every navigation still landed with no page error and no freeze.

## 5. Before / after of the WebKit hold (UIQA-MOT-02)

| | Before (v1.88 code) | After |
|---|---|---|
| Update callback after a skip | stayed pending until the route committed, measured 3,131 ms and 4,261 ms (4 s fallback) | ends at 300 ms at the latest |
| Rapid clicks in WebKit (audit harness: route interception + wrapped `startViewTransition`) | the page stopped answering (test timed out on a plain `waitForTimeout`) | the rapid-click and Back / Forward test passes |
| Uncaught "Transition was skipped" | yes (Chromium, Edge, WebKit) | none (e2e asserts no page errors) |

## 6. Memory and leftovers

`v1870-motion-perf` (50 open / close cycles of the task pane and the record pane, CDP heap, DOM nodes, leftovers) passed on the final build in Chromium (task pane 23.8 s, record pane 30.1 s).
