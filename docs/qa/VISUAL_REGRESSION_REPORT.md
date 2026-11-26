# Visual regression baselines

**Date:** 25 Nov 2026. **Build:** v1.89.0 stage 4 (D-426), branch `release-189`. **Status:** in place. Chromium baselines are committed; Firefox and WebKit baselines are not (§6).

The plan this replaces (24 Nov 2026, phase 1) proposed two tiers. Tier 1 is built below, extended with the overlays, empty and not-found states, a dark sample and the nine viewports for the shell pages. Tier 2 (every route × 9 viewports × 4 browsers, about 1,500 images) stays a measuring job: the UIQA sweep already visits every route at every viewport and counts layout faults (FINAL_QA_SIGNOFF), so a second full set of images would add size without adding a check.

## 1. What is baselined

`tests/visual/ui-baseline.visual.ts`, one screenshot per screen and viewport (the visible window, not the full page):

| Group | Screens | Viewports |
|---|---|---|
| Public | landing, sign-in, privacy, not found | 1440 / 1024 / 390; **sign-in at all 9** |
| Users (requester, Ravi) | Home (**all 9**), Home tasks overview, My requests, a request, New request step 1, Task Summary, a task page, a project (list and board), Information list and item, Meetings list, a meeting, New meeting, Tickets list, a ticket, Calendar, Profile, Help, an unknown address (not found inside the shell) | 1440 / 1024 / 390 |
| Approver (Manoj) | Waiting for me | 1440 / 1024 / 390 |
| A person with no records (Sita) | My requests (empty state), My tickets (empty state) | 1440 / 1024 / 390 |
| IT Admin (Elena) | Admin home (**all 9**), Users, a user, Records → Requests, Insights, Set-up, DoA, a task type | 1440 / 1024 / 390 |
| Super Admin (Sam) | Super Admin home (**all 9**), Feature switches, Audit log, Email connection | 1440 / 1024 / 390 |
| Overlays | the task side pane (`?task=`), the search window (Ctrl+K), Create task, the date picker (New ticket → Required date; the phone's bottom sheet at 390) | 1440 / 1024 / 390; search 1440 / 1024 (on a phone the users area's search is its own page); Create task 1440; date picker 1440 / 390 |
| Dark theme sample | users Home, My requests, Admin home | 1440 / 390 |

The phone cards (every list at 390) are in the 390 shots of the lists. The nine viewports are the owner's: 1920×1080, 1440×900, 1366×768, 1280×720, 1024×768, 768×1024, 430×932, 390×844, 360×800.

**Count and size:** see §5 (result).

## 2. How it stays deterministic

| Source of change | Treatment |
|---|---|
| Data | `VISUAL_SETUP=1` recreates the database (real migrations and seeds, the e2e people) for every run; the first test makes the records with fixed titles (`setUpRecords(page, context, "vr")`: a project with a task, a form and an automation, a portfolio, a request to the manager, a ticket, a meeting, a calendar entry, a notice, 62 tasks with fixed offsets). Record numbers and ids come out the same on every fresh database. |
| The clock | `page.clock.setFixedTime(<run start>)`: the browser's time does not move during a run. |
| Relative times | The spec waits for every `time[data-relative]` to read `ready` (D-425: relative text appears after mount). |
| Dates on another day | Every date, time and relative text the app writes is replaced in the page by one fixed text before the shot (`1 Jan 2026`, `9:00 am`, `Jan 2026`, `Today`, `just now`, `Mon`, `Good day`), so a run on another day or hour shows the same characters. The regular expressions follow `lib/format/date.ts`, the one formatter. |
| Motion | `reducedMotion: "reduce"`, `animations: "disabled"`, and the spec waits for finite animations (menus, dialogs) to finish. |
| Readiness | The app shell's markers (`data-session-watch`, `data-place-memory`, D-424), no pending navigation, network idle, `document.fonts.ready`. |
| Caret, hover | `caret: "hide"`; the mouse is moved to 0,0. |
| Masks | `canvas`, `input[type=time]` (a meeting's start and end default to now), the journey panel, the update notice, the calendar's month grid, Insights charts, the audit log's rows (sign-in times and addresses), the date picker's month grid and title. |
| Locale | `en-IN`, `Asia/Kolkata`, device scale 1, the phone layout cookie below 768 and touch at phone and tablet sizes (as the UIQA sweep). |

Thresholds: `maxDiffPixelRatio: 0.002`, `threshold: 0.2` (playwright.visual.config.ts).

**Known limits:** counts that depend on the weekday (Task Summary's "Next 7 days", the bulk tasks' Overdue / Today split) are fixed relative to the run day. They are the same on every run of the same day and on most days, but a run near a week boundary can move a row between groups. Such a diff is data, not a layout change; review it in the report and update only if the layout is unchanged.

## 3. How to run

The server is the e2e production build with its own throw-away database (it is never the live database: `E2E_ENV` in `playwright.config.ts`, test-only values).

```
npm run build
# compare against the committed baselines (fresh database each run):
VISUAL=1 VISUAL_SETUP=1 TEST_DB_NAME=ars_approvals_test_vr E2E_PORT=3283 E2E_MOCK_PORT=4184 \
  npx playwright test -c playwright.visual.config.ts
# the HTML report with the diffs: playwright-report/visual/index.html
```

`playwright.visual.config.ts` starts `next start` on `E2E_PORT` when nothing is listening there (or reuses a running server). Without `VISUAL=1` every test is skipped, and the normal `npm run test:e2e` never looks in `tests/visual` (its `testDir` is `tests/e2e`). CI does not run it unless a job sets `VISUAL=1` and uses this config.

**Updating** (only for an intended change, reviewed in the diff view):

```
VISUAL=1 VISUAL_SETUP=1 ... npx playwright test -c playwright.visual.config.ts --update-snapshots
```

Commit the changed PNGs with the change that caused them and say why in the commit. A run on another operating system renders fonts differently: take and compare baselines on the same machine image (today: Windows 11, Chromium of Playwright 1.63.0).

**Other browsers:** `VISUAL_BROWSERS=chromium,firefox,webkit` adds Firefox (`E2E_FIREFOX_PATH`) and WebKit projects; their baselines would go to `tests/visual/__screenshots__/<browser>/`.

## 4. Where

- Config: `playwright.visual.config.ts` (`snapshotPathTemplate: {testDir}/__screenshots__/{projectName}/{arg}{ext}`).
- Spec: `tests/visual/ui-baseline.visual.ts`; database set-up: `tests/visual/global-setup.ts`.
- Baselines: `tests/visual/__screenshots__/chromium/<area>/<viewport>/<screen>.png`.
- The records' ids of a run: `audit/ui-qa/visual/ids.json` (git-ignored).

## 5. Result (stage 4)

See the stage 4 section of [UI_REFACTORING_LOG.md](UI_REFACTORING_LOG.md) and [FINAL_QA_SIGNOFF.md](FINAL_QA_SIGNOFF.md) for the runs; the figures are repeated here.

| Measure | Value |
|---|---|
| Baselines (Chromium) | **155 PNG** (47 screens: 43 at 1440 / 1024 / 390 or a subset of them, 4 shell pages at all 9 viewports) |
| Size in the repository | **19.5 MB** (19,459,280 bytes): under the 40 MB budget, so nothing was cut |
| Time per run | about 4 minutes (156 tests: the set-up and 155 shots) on the e2e production build |
| Stability | After the final baselines (run `v2-create`), **two compare runs on fresh databases: 155 / 155 identical, twice** (`v2-compareA`, `v2-compareB`, 25 Nov 2026). After the Profile photo-button fix (the final build) the 2 Profile shots at 1024 / 390 changed by design and were updated; then **two more compare runs: 155 / 155 identical, twice** (`final4-compareA`, `final4-compareB`). |
| Found while building them | (1) Task Summary's "Show" label squeezed to "Sho / w" at 1440 (fixed, BUG_FIX_LOG stage 4). (2) A determinism gap in the data, not the app: the 60 bulk tasks shared a due second per day, so a list sorted by due date could draw them in either order (first compare run: 2 diffs at 390, Task Summary and the calendar list). The set-up now puts them one second apart by number. (3) The search window has no phone shot: on a phone the users area's search is a page. |

## 6. Firefox and WebKit

Not committed. The config can take them (`VISUAL_BROWSERS`), but they were not added because (a) Firefox in this environment is the copy at `D:\pw-firefox-1543` started outside Playwright's own folder and slows down badly when other browsers run beside it (closing a page took over a minute during the parallel sign-off run), and (b) Playwright's WebKit on Windows hydrates pages 5-7 s after load and its fonts render differently from Safari, so its images would be neither stable nor representative of real Safari. The cross-browser layout is checked by the UIQA sweep in Firefox and WebKit instead (page overflow, elements outside the viewport, shell geometry, CLS, axe), with every counter at 0 at sign-off. Add them when CI runs on Playwright's Linux image, where both browsers are first-class.

## 7. v1.91.0 (26 Nov 2026): Collaborating moved in the sidebar (D-433)

Compare run on a fresh database (`VISUAL_SETUP=1`, `ars_approvals_test_v191`): 127 / 156 identical; 29 differed. Every desktop / tablet shot with the users sidebar (or its 1024 rail) changed because Collaborating left the My Approvals group and became a top-level item just before Calendar, and Help changed (new topic, sidebar topic). Reviewed (diff images) and updated deliberately with `--update-snapshots=changed`, 29 PNG:
`approver/1440x900/queue`, `dark/1440x900/users-home`, `overlay/1440x900/{create-task,date-picker,search-palette,task-pane}`, `staff/1440x900/tickets-empty`, `users/1024x768/{help,information}`, `users/1280x720/home`, `users/1366x768/home`, `users/1920x1080/home`, `users/1440x900/{calendar,help,home,home-tasks,information,information-detail,meeting-detail,meeting-new,meetings,not-found,profile,project-board,project-list,task-detail,task-summary,ticket-detail,tickets}`.
Not updated: `users/390x844/home-tasks` (differed in the first run only, by fixture data: "20" vs "21 tasks overdue", KF-15; no sidebar on phones). Recheck after the update: 154 / 155 identical, then `users/information @ 1024x768` (the rail, intended) updated and `users/information|users/home|dark/users` repeated twice: 44 / 44 identical. Phone shots (390, 430, 360) unchanged: the phone layout has no sidebar (Collaborating moved to More, not in a baseline).

## 8. v1.91.1 (26 Nov 2026): Waiting for me layout (D-435)

Compare run on a fresh database (`VISUAL_SETUP=1`, `ars_approvals_test_v1911vr`): 151 / 156 identical; 5 differed. The three Waiting for me shots changed as intended (no title bar, the Request cell is the title only, the select bar and then the count / pager below the table, Select all in the tick column header): updated deliberately with `--update-snapshots --grep "approver/queue|set up"`, 3 PNG: `approver/1440x900/queue`, `approver/1024x768/queue`, `approver/390x844/queue`. Recheck after the update: identical. Not updated: `users/information @ 1440x900` and `@ 1024x768` (fixture data by date / time: the tab counts, KF-16; the page is untouched).

## v1.92.0 (26 Nov 2026): ticket collaborators (D-438..D-441)

Compare run on a fresh database (`VISUAL_SETUP=1`, `ars_approvals_test_v192`, Chromium): first a targeted run of `users/ticket-detail` (the changed screen): 1440x900 and 1024x768 differed because the **Collaborators** card now sits above the Timeline on the ticket page (intended; reviewed); 390x844 identical (the card is below the fold). Those two baselines were updated deliberately and rechecked identical. Then the full set: **154 / 156 identical**; the 2 others are `users/information @ 1440x900` and `@ 1024x768` (the Unread count and the row's unread dot depend on fixture state; KF-16, not touched by v1.92.0; not updated). The Collaborating screen has no baseline (none existed; its Tickets tab is covered by e2e `v1920-ticket-collaborators`, incl. phone cards at 390). The users sidebar did not change for any baseline role.
