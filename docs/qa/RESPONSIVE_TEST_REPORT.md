# Responsive test report (UI/UX QA, phase 1)

**Date:** 24 Nov 2026. **Build:** v1.88.0.

**Method:**
- The sweep `tests/e2e/zz-ui-qa-audit.spec.ts` opened every route of each role at 9 viewports in Chromium.
- 768 and below ran as touch devices. Below 768 the users area got the phone layout (`ars_layout=mobile`, as `LayoutSync` sets it).
- The same sweep ran at 1440 / 768 / 390 in Edge, Firefox and WebKit.
- Probes covered reflow at zoom, resize with overlays open, and long text.

**Standard:** [SCREEN_LAYOUT_STANDARD.md §5](SCREEN_LAYOUT_STANDARD.md).

## 1. Coverage

| Viewport | Device class | Roles × routes (Chromium) | Edge / WebKit (Firefox BLOCKED) |
|---|---|---|---|
| 1920×1080 | desktop | 177 | — |
| 1440×900 | desktop | 177 | yes |
| 1366×768 | desktop | 177 | — |
| 1280×720 | desktop | 177 | — |
| 1024×768 | small desktop / tablet landscape | 177 | — |
| 768×1024 | tablet (touch) | 177 | yes |
| 430×932 | large phone (touch, phone layout) | 177 | — |
| 390×844 | phone | 177 | yes |
| 360×800 | small phone | 177 | — |
| 320×256 / 640×360 / 1600×900 | zoom 400 % / 200 % / 80 % of 1280-wide | 12 representative pages | — |

There are 177 role × route pairs per viewport: 1,593 page visits in Chromium, plus 130 with the collapsed sidebar. Edge and WebKit had 531 visits each. Firefox is BLOCKED (§5). Raw data: `audit/ui-qa/geometry.json`; screenshots: `audit/ui-qa/shots/<browser>/<viewport>/`.

## 2. Results at a glance (Chromium)

| Check | Result |
|---|---|
| Page-level horizontal scroll (`scrollWidth > clientWidth`) | **0 pages at all 9 viewports** with the sweep's records. With a 190-character unbroken title, the task page overflows at desktop widths (UIQA-LAY-01, probe `longtext`). |
| Visible elements outside the viewport (not in a scroll area) | **0** |
| Console errors / page errors / failed requests | 0 / **2** (React #418 hydration, intermittent, UIQA-ERR-01) / 0 |
| Status ≥ 400 or navigation failures | **0** |
| Layout shift > 0.1 on load | 3 pages at some desktop widths (UIQA-PERF-01 / 02) |
| Shell geometry identical across modules at a viewport | **Yes** (SCREEN_LAYOUT_STANDARD §2) |

## 3. Findings

| ID | Viewport(s) | Finding | Evidence | Sev. |
|---|---|---|---|---|
| UIQA-RESP-01 | 430 / 390 / 360 | **Lists keep a squeezed desktop table on phones** in Tasks (Assigned to me), Meetings, Tickets, Admin Users and Super Admin logs: 2-3 columns visible, titles truncated to a word, sideways scroll inside the card. Requests and Information switch to phone cards. | `shots/chromium/390x844/user__users_{tasks,meetings,tickets}.jpg`, `admin__admin_users.jpg` | P2 |
| UIQA-RESP-02 | 768 (touch) | The sidebar is **expanded (220)** on a 768 px tablet, leaving 484 px of content, which then wraps toolbars. The rail (80) is used only if the person collapsed it before (cookie). | sweep: `sidebarW 220` on all 140 pages at 768 | P3 (proposal: rail by default below 1024) |
| UIQA-RESP-03 | < 768 | **Two phone shells.** Users phone layout: header 56, padding 12 / 16, top 16, tab bar. Admin / Super Admin on phones: header 64, padding 16, top 24, MobileNav sheet. | sweep shell table (SCREEN_LAYOUT_STANDARD §2) | P3 (the phone layout is by design, v1.43.0; the token difference is not) |
| UIQA-RESP-04 | < 768 | **Phone page titles in four styles:** 20 / 600 (most), 22 / 800 (`.mob-screen-title`: Information, Inbox, Assigned to me, Notifications), 28 / 600 (task detail, `TaskDetail.tsx:223`), and **no h1** on Home and the two overviews (`/users`, `?home=tasks`, `?home=meetings`, `/users/work`). | sweep h1 at 390 | P2 (no h1: see the accessibility report) |
| UIQA-RESP-05 | 768, 430, 390, 360 (touch) | **Touch targets under the app's own 44 px rule** (spec #5, `globals.css:470`, which covers only `btn-compact` and `field-input`): `tb-btn` toolbar buttons 28 px on 42 pages at 390; TaskGrid inline selects **19 px** (`/users/work/search`, project list); the project grid's inline inputs 22 px; `pill-select` 32 px (AI assistant); round task checks 20 px (Tasks, Task Summary, Calendar: 64 on `/users/calendar`). axe's `target-size` (WCAG 2.5.8, 24 px or spacing) passed, so these meet AA by spacing but not the app's rule. | sweep `buttons` / `inputs` at 360 / 390 | P3 |
| UIQA-RESP-06 | 390 / 360 | **Floating stack over content:** the Pico Bot launcher (bottom right) sits over list rows and links while scrolling (e.g. Super Admin Health console "Open" links, the Admin users table). The page bottom padding lets the last row clear it, but mid-page rows pass under it. | `shots/chromium/390x844/super__superadmin.jpg`, `admin__admin_users.jpg` | P3, **suspected** (a covered link was not clicked by the probe) |
| UIQA-RESP-07 | 1920 | The content is centred in a 1280 box: it starts **462 px** from the left edge, leaving 242 px of empty margin on the right. With the rail it starts at 392, so the content moves by only 70 px when the sidebar collapses by 140. | sweep `contentLeft` | P3 (owner decision C16 / Q-UI-2) |
| UIQA-RESP-08 | all | **Public Privacy / Terms header 68-69 px** (others 64); the auth pages have no header (a split screen). | sweep public | P4 |
| UIQA-RESP-09 | 1280 / 1366 | **Task Summary with an open task pane shifts** by 44 px as the pane mounts (CLS 0.36-0.38); none at 1440 / 1920 | `probes/chromium-cls.json` | P2 (= UIQA-PERF-02) |

Reflow, zoom, resize and long-text probe results: §4.

## 4. Probe results

| Probe | Result |
|---|---|
| Reflow at zoom (`reflow`, 12 pages) | 400 % (320×256): 11 / 12 pass; the task page scrolls 20 px sideways (UIQA-A11Y-01). 200 % (640×360) and 80 % (1600×900): 12 / 12 pass. |
| Long text (`longtext`: a 190-character unbroken title, plus markup + emoji) | **1440: the task page scrolls 1,809 px sideways** (UIQA-LAY-01, P1). The pane, lists and Admin Records are fine. At 390 / 360 everything wraps. Markup shows as text everywhere; no `<b>` element is created. |
| Resize with an overlay open (`resize`) | Palette open, 1440 → 390 → 1440: stays inside the viewport and modal; no page overflow. Task pane open, 1440 → 390: the layout switches to the phone page `/users/tasks/<id>` (by design, LayoutSync); no overflow. Chromium, Edge and WebKit all pass. |
| Overlays at 1440 / 1024 / 768 / 390 / 360 (`overlays`) | Every overlay is inside the viewport and top-most. At 390 / 360 in the users area, Search is a page link and the menu is the tab bar (by design). Admin uses MobileNav (a full-screen sheet, scroll locked). |
| Task pane (`pane`) | 1920 / 1440 / 1024: a 440 px side pane (slide 280 ms). At 1920 the pane overlaps the centred content by 230 px, and from 1440 down by 440 px (the list keeps its room, D-410). 768: a centred dialog (scale 220 ms, radius 16). Escape closes it and clears `?task=`. |
| Date picker inside Create task (`picker`) | Inside the viewport at 1440 and 768. Escape closes the picker, not the dialog. |
| Layout shift (`cls`) | PERF-01 / PERF-02 (§3) |

## 5. Browser compatibility

| Browser | Geometry sweep (1440 / 768 / 390, every role × route) | Key interactions (overlays, resize, pane, picker, upload, transitions) | Differences from Chromium |
|---|---|---|---|
| Chromium (Playwright 1.63) | 1,593 visits (9 viewports) + 130 rail | all | — |
| **Microsoft Edge** (`channel: "msedge"`, installed) | 531 visits | 51 probes | **None** in the shell geometry, h1, controls, radius or overflow (0 differences over 531 pages). 2 intermittent React #418 hydration errors (UIQA-ERR-01). The transitions probe gave the same result as Chromium (MOT-01). |
| **WebKit** (Playwright `webkit-2359`, the Safari stand-in) | 531 visits (with `webkitHttpsShim`, see below) | 41 + 12 probes over 3 runs | **No geometry differences** (0 over 531 pages). Errors: React #418 on `/users/profile/devices` at all 3 viewports (UIQA-ERR-02). The task pane Escape failed 3 of 12 times (UIQA-OVL-01, suspected). **Page crash with page transitions ON**, 3 / 3 runs (UIQA-MOT-02). |
| **Firefox** (`firefox-1543`, installed) | **BLOCKED** | **BLOCKED** | The browser does not start: Windows SideBySide error "Dependent Assembly mozglue could not be found" (UIQA-BRW-01). It needs a repaired install (owner / IT approval). |

**WebKit test-environment note:**
- The production headers (HSTS and the CSP's `upgrade-insecure-requests`, `lib/security/csp.ts:45`) make WebKit request every `/_next` asset at `https://localhost`.
- On the plain-http test server this failed with "SSL connect error", so pages had no CSS or JS. Chromium never upgrades localhost.
- `tests/e2e/ui-qa-shared.ts` `webkitHttpsShim` routes those requests back to http for WebKit only.
- The service worker and RSC prefetch errors that the shim causes are excluded.
- Production runs on https, so this is not an app defect.


## 6. Stage 4 sign-off (v1.89.0, D-426, 25 Nov 2026, final build)

The standard: [RESPONSIVE_STANDARD.md](RESPONSIVE_STANDARD.md). The sweep (`zz-ui-qa-audit.spec.ts`) on a fresh database per browser:

| Run | Visits | Page overflow | Outside the viewport | Shell token mismatches | Squeezed phone tables | CLS > 0.05 |
|---|---|---|---|---|---|---|
| Chromium, 9 viewports + folded sidebar (light) | 1,783 | 0 | 0 | 0 | 0 | 0 |
| Chromium, dark, 1440 / 390 | 354 | 0 | 0 | 0 | 0 | 0 |
| Firefox, 1440 / 768 / 390 | 531 | 0 | 0 | 0 | 0 | 0 |
| WebKit, 1440 / 768 / 390 | 531 | 0 | 0 | 0 | 0 | 0 |

Probes (Chromium; overlays, resize, pane, picker, upload, forms, offline, tables, keyboard, reflow, motion, sidebar, transitions, integration, states, long text, rapid clicks): **147 checks, 0 not OK.**

New in stage 4: every date field opens the date picker as a bottom sheet below 768 px (visual baseline `overlay/390x844/date-picker`); the time box beside a date-time field is 128 px and the date button takes the rest of the row (it shortens its text with … when the row is narrow). The visual baselines fix the look of 47 screens at 1440 / 1024 / 390 and the shell pages at all nine viewports ([VISUAL_REGRESSION_REPORT.md](VISUAL_REGRESSION_REPORT.md)).
