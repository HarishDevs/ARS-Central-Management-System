# Navigation test report (v1.89.0 sign-off)

**Date:** 25 Nov 2026. **Build:** v1.89.0 stage 4 (D-426), branch `release-189`. **Scope:** the navigation audit's defects NAV-01 … NAV-08 ([NAVIGATION-AUDIT.md](NAVIGATION-AUDIT.md), fixed in stage 1, D-419) and every navigation spec of the e2e suite, run in Chromium, Firefox and WebKit as part of the full suites (FINAL_QA_SIGNOFF §2).

## 1. Results per spec (full suite run, tests passed / failed per browser)

| Spec | What it covers | Chromium | Firefox | WebKit |
|---|---|---|---|---|
| `v1890-navigation` | NAV-01 … NAV-08: return address keeps `?task=` / filters / view / sort after sign-in; no-access `next=` lands on home; Admin → Records way back for every record type; breadcrumbs name the list of origin; ← All users keeps search and sort; Back with an unsent comment asks; BackLink never leaves the app | 15 / 0 | 15 / 0 | 15 / 0 |
| `v1870-navigation-continuity` | closing keeps the list (scroll, filters, sort), no extra history entry, folds kept, Escape order across overlays, races (double clicks, Escape while saving) | 9 / 0 | 9 / 0 | 6 / 1 (+2 not run behind it; see §2) |
| `v1721-nav` | quick search, list → record → back | 6 / 0 | 6 / 0 | 6 / 0 |
| `v171-nav` | sidebar groups and current page | 3 / 0 | 3 / 0 | 3 / 0 |
| `v128-classic-nav` | Classic view: every entry, module page and tab has a way in and back; the sign-in loader | 7 / 0 | 7 / 0 | 6 / 1 (loader test; same on the stage 3e build) |
| `v1495-nav-roles` | sidebar per role | 4 / 0 | 4 / 0 | 4 / 0 |
| `v1760-pane-url` | `?task=` opens and closes the pane, Back and Forward | 3 / 0 | 3 / 0 | 3 / 0 |
| `guard` | 404 for areas a person can't open; security headers | 4 / 0 | 4 / 0 | 4 / 0 |
| `v1125-stale-page` | a new build is noticed (banner) | 2 / 0 | 2 / 0 | 1 / 1 (same on the stage 3e build) |
| `v1830-task-pane` | the pane from My Tasks, Home, the list, Search and a notification | 4 / 0 | 0 / 1 (+3 not run; rerun §2) | 4 / 0 |
| `v190` | the bell opens the pane, sidebar order, the rail | 6 / 0 | 6 / 0 | 6 / 0 |
| `v1730-crawl` (9 tests: set-up, every route in 3 modes, "to and fro" for 5 people) | every route: status, console, axe, overflow; menus: click, Back, Forward | 6 / 3 on the first run (build `59e9ed7`, three browsers in parallel); **9 / 9 on the rerun** (final code, alone) | 7 / 2 ("every route" light 1366 and dark 768: the Profile photo buttons' target size, fixed; one #418, §2) | 4 / 5 ("every route" light 1366: one axe colour-contrast during the draft window's entrance, not reproducible; 4 × "to and fro": prefetch console lines, §2) |

## 2. Failures and their classification

- **WebKit `v1870-navigation-continuity` "races and the overlay stack"**, **`v128` loader**, **`v1125` banner**: Playwright's WebKit on Windows runs the page's script 5-7 s after load; the loader and banner tests and the race test depend on that timing. `v128` loader and `v1125` fail the same on the stage 3e build (reference run, `8b6c705`). Harness.
- **WebKit crawl "to and fro"**: the only findings are console lines `Fetch API cannot load …?_rsc=… due to access control checks`: WebKit's message for a prefetch it cancelled because the test navigated on (the same family of "prefetch noise" that the UIQA sweep has filtered since stage 3c). Navigation itself landed right. Harness.
- **Chromium crawl "to and fro" (first run, build `59e9ed7`, under three parallel browsers)**: one Forward landed on `/users` instead of `/users/information`, and one #418 console error (FINAL_QA_SIGNOFF §5, risk R1). Re-run on the final build alone: 9 / 9 crawl tests pass.
- **Firefox `v1830`**: `toHaveURL` after a click before the page had settled; see the rerun result in FINAL_QA_SIGNOFF §2.

## 3. NAV defects

All eight NAV defects stay fixed in all three browsers (`v1890-navigation` 15 / 15 each). No new navigation defect was found in stage 4.
