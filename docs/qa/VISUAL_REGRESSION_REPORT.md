# Visual regression: baseline plan

**Date:** 24 Nov 2026. **Status:** a plan only. **No baselines were created.** They come after the fix batches (QA_TEST_PLAN §8, phase 4), so that they record the agreed UI and not today's inconsistencies.

## 1. Today

- No `toHaveScreenshot` / `toMatchSnapshot` assertions exist in the repository (`grep` over `tests/`).
- Screenshots are taken today only as evidence:
  - `v1730-crawl` → `test-results/crawl/shots`;
  - `v1722-visual` with `VISUAL_SHOTS=1`;
  - the header audit → `audit/header/`;
  - this audit → `audit/ui-qa/shots/<browser>/<viewport>/<role>__<route>.jpg`.
- All of these are git-ignored.

## 2. What to baseline

**Tier 1, on every pull request (fast, about 120 images):** Chromium only, at 1440×900, 768×1024 and 390×844, **light** theme.

| Role | Routes |
|---|---|
| USER (`E2E_REQ`) | `/users` (approvals overview), `/users?home=tasks`, `/users/requests`, `/users/requests/{id}`, `/users/queue` (as `E2E_MGR`), `/users/custom` (step 1), `/users/work/my-tasks`, `/users/tasks/{id}`, `/users/work/projects/{id}` (list) and `?view=board`, `/users/information`, `/users/information/{id}`, `/users/meetings`, `/users/meetings/{id}`, `/users/tickets`, `/users/tickets/{id}`, `/users/calendar`, `/users/profile`, `/users/help` |
| IT_ADMIN | `/admin`, `/admin/users`, `/admin/users/{id}`, `/admin/records/requests`, `/admin/insights`, `/admin/setup`, `/admin/setup/doa`, `/admin/setup/task-types/{id}` |
| SUPER_ADMIN | `/superadmin`, `/superadmin/security/features`, `/superadmin/monitoring/audit`, `/superadmin/connections/email` |
| Public | `/`, `/login`, `/privacy` |
| Overlays | The search palette, a Dialog (`ConfirmDialog`), the task pane (`?task=`), the bell panel, the phone menu (390), the Create task dialog |

**Tier 2, nightly or before a release:**
- every route in `routesFor()` (`tests/e2e/ui-qa-shared.ts`) for its role;
- the 9 viewports;
- Chromium plus Edge, Firefox and WebKit at 1440 / 768 / 390;
- dark theme at 1440 and 390.

That is about 1,500 images. Tier 2 replaces nothing in tier 1.

## 3. Determinism

| Source of change | Treatment |
|---|---|
| Dates and times ("23 Nov 2026", "2 h ago", Today, greetings "Good morning") | Freeze the clock in the browser: `page.clock.install({ time: new Date("2026-11-20T09:30:00+05:30") })` before navigation. The server renders relative dates too, so mask what remains with `mask: [page.locator("time"), page.locator("[data-relative-time]")]`. |
| Record numbers and ids (`REQ-…`, `/123`) | The fixed test database and a fixed set-up order give stable ids. Mask the number badges (`[data-testid$="-number"]`) where the order is not fixed. |
| Avatars and photos | `defaultAvatar` initials are deterministic. Mask `img[data-testid^="menu-photo"]` and uploaded photos. |
| Random data (`stamp`, UIQA titles) | Baseline specs use fixed titles (no `Date.now()`). A separate seeded database is recreated per run. |
| Counts (unread, waiting) | Fixed set-up. Mask the bell's badge if notification jobs run. |
| Animations | `animations: "disabled"`, `reducedMotion: "reduce"`. The journey panel (`.jr-panel`) is masked or paused (`.jr-paused`). The skeleton shimmer is off under reduce. |
| Caret and focus | `caret: "hide"`; click on the body before the shot. |
| Fonts | Inter is loaded through `next/font` (self-hosted). Wait for `document.fonts.ready`. |
| Scrollbars | `scrollbar-gutter: stable` exists. Take full-page shots of `main` only (`locator("main").screenshot()`) for page bodies, plus a viewport shot for the shell. |
| Tour, install invite, update notice | Already suppressed by `sessionCookie` (`TOUR_DONE`, `INSTALL_INVITE_DISMISSED`). The update notice depends on the build id: mask it. |
| Charts (Insights) | Fixed data; mask the chart canvas if its rendering differs between runs. |
| OS font rendering | Baselines are generated on one OS. CI should use the same image (Playwright's Linux container). Keep Windows-local baselines out of git. |

Thresholds: `maxDiffPixelRatio: 0.002` for page bodies and `0.001` for the shell; `threshold: 0.2`.

## 4. Where to store

- Spec: `tests/visual/ui-baseline.spec.ts`, with a config `playwright.visual.config.ts` (`snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}"`).
- Baselines: `tests/visual/__screenshots__/chromium/<role>/<viewport>/<route-slug>.png`. Commit tier 1 only (about 120 PNGs, roughly 15 MB). Store tier 2 as a CI artefact (not in git).
- Update: `npx playwright test -c playwright.visual.config.ts --update-snapshots`, only in a pull request labelled "visual change", with the owner's approval of the diff.
- Report: the HTML report's diff view, attached to the pull request.

## 5. When

| Phase | Work |
|---|---|
| Phase 2 | Each fix batch lands with its unit and e2e tests. No baselines yet. |
| Phase 4 | Generate tier 1 after the last fix batch. Review every image with the owner, then commit. Tier 2 runs nightly from then on. |
| Ongoing | Any change to a token, the shell or a shared component must show its diff in tier 1. |
