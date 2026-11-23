# UI/UX QA test plan: global UI standardisation programme

**Date:** 24 Nov 2026. **Build under test:** v1.88.0 (`893fb4b`), branch `qa-ui`. **Owner's goal:** "one application, one global UI, one design system, one screen structure".

**Phases:**

| Phase | Work | Status |
|---|---|---|
| 1 | Discovery, standards (proposals), measured audit and reports | **This phase** |
| 2 | Fixes in batches | After the owner approves the standards |
| 3 | Retest | After the fixes |
| 4 | Visual-regression baselines | After the fixes |

**Out of scope here:** navigation, routing and RBAC correctness are covered by **NAVIGATION-AUDIT (separate)**, which runs in its own worktree (`nav-audit`, port 3260). This plan covers navigation only where it touches layout, the shell or UI consistency. Server-side permission checks are listed under role-based UI, but they are verified there, not here.

## 1. Environment and isolation

| Item | Value |
|---|---|
| App | Production build (`npm run build`, `next start -p 3270`) with the e2e environment (`playwright.config.ts` `E2E_ENV`; test-only secrets) |
| Database | `ars_approvals_test_qa` (Docker MySQL on 3307), recreated by `tests/e2e/global-setup.ts`, dropped at the end |
| Mock AI provider | Port 4171 (not exercised by the sweep) |
| People (seeded) | `E2E_REQ` (USER, requester), `E2E_MGR` (USER, manager and approver), `E2E_HOD`, `E2E_STAFF` (USER, no records), `E2E_ADMIN` (USER + IT_ADMIN), `E2E_SUPER` (USER + IT_ADMIN + SUPER_ADMIN). The `EXPORTER` role exists (seed `001_roles.sql`) but changes no layout. |
| Sign-in | A signed session cookie (`tests/e2e/db.ts` `sessionCookie`), tour and install invite marked done |
| Modules | All modules granted to the E2E people for the audit (APPROVAL, TASK, PROJECT, INFORMATION, MEETING, TICKET, AI); PM switches ON (global set-up) |
| Records | `tests/e2e/ui-qa-shared.ts` `setUpRecords`: a project + task + form + automation, a portfolio, a custom request (Ravi → Manoj), a ticket, a meeting, a calendar entry, an information type + notice, a 190-character unbroken task title, a markup/emoji task title, 60 bulk tasks. Ids are in `audit/ui-qa/ids.json`. |
| Never | Production, `D:\PBI New\.env.local`, real secrets, real providers |

## 2. Specs and tools

| Spec / tool | What | Output |
|---|---|---|
| `playwright.ui-qa.config.ts` | Reuses the running server; DB set-up only with `UIQA_SETUP=1`; projects `chromium`, `msedge` (channel), `firefox`, `webkit` | |
| `tests/e2e/zz-ui-qa-audit.spec.ts` | The geometry sweep: every route of each role at the 9 viewports (+ the collapsed sidebar at desktop widths, sampled). Header, sidebar, main offsets, padding, max-width, h1 / h2 / body type, button and input heights by class, card and box radius, overflow and elements outside the viewport, date / number formats, console errors, failed requests, navigation time, CLS, axe (wcag2a, wcag2aa, wcag21aa, wcag22aa) at 1440 and 390, a JPEG per page | `audit/ui-qa/raw/<browser>/<role>__<vp>.json`, `audit/ui-qa/shots/` |
| `tests/e2e/zz-ui-qa-probes.spec.ts` | Targeted probes on a representative page per module: overlays (palette, bell, account menu, + Create, MobileNav), resize with an overlay open, task pane, date picker, upload, forms (required, whitespace, special characters, double submit, unsaved guard), offline submit, tables, keyboard / focus, reflow at 80 / 200 / 400 % zoom, reduced motion, sidebar motion, page transitions ON, the cross-module request, error / empty states, long text, rapid clicks | `audit/ui-qa/probes/<browser>.json` |
| `scripts/qa/ui-qa-analyze.mjs` | Merges the raw files into `audit/ui-qa/geometry.json`; computes the inconsistencies per viewport / area / module into `audit/ui-qa/summary.json` | |
| Static scans (grep) | Tokens, arbitrary px, `!important`, raw colours, component duplicates, motion | Recorded in the inventory documents |

Both specs skip unless `UIQA=1`, so they never run in the normal e2e suite or CI. The evidence folder `audit/ui-qa/` is git-ignored.

**Run (chunked, never one blocking call):**
```
# once: database + records
UIQA=1 UIQA_SETUP=1 TEST_DB_NAME=ars_approvals_test_qa E2E_PORT=3270 E2E_MOCK_PORT=4171 \
  npx playwright test -c playwright.ui-qa.config.ts --project=chromium tests/e2e/zz-ui-qa-audit.spec.ts -g "set up"
# per role / viewport group
UIQA=1 UIQA_ROLES=user UIQA_VP=1440x900,390x844 ... -g geometry
# probes (all), and the browser-compatibility subset
UIQA=1 npx playwright test -c playwright.ui-qa.config.ts --project=chromium tests/e2e/zz-ui-qa-probes.spec.ts
UIQA=1 UIQA_PROBES=overlays,resize,pane,picker,upload ... --project=firefox|webkit|msedge
node scripts/qa/ui-qa-analyze.mjs
```

## 3. Matrix

| Dimension | Values |
|---|---|
| Viewports | 1920×1080, 1440×900, 1366×768, 1280×720, 1024×768, 768×1024 (touch), 430×932, 390×844, 360×800 (touch, phone layout in the users area) |
| Roles | public, USER (requester / approver / no-records), IT_ADMIN, SUPER_ADMIN |
| Browsers | Chromium (full); Edge `msedge` and WebKit (Safari stand-in, with `webkitHttpsShim` for the localhost https upgrade): geometry at 1440×900, 768×1024, 390×844 + key interactions. **Firefox: installed with the owner's approval but BLOCKED (does not start: SideBySide "mozglue" error, UIQA-BRW-01).** |
| Theme | Light (the audit). Dark is covered by the earlier crawl (`v1730-crawl`) and token-contrast script; not repeated here (see §7). |
| Zoom | 80 / 200 / 400 % emulated by the equivalent CSS viewport (1600×900, 640×360, 320×256) |
| Motion | `prefers-reduced-motion` reduce and no-preference |

## 4. Test categories and how each is covered

| # | Category | Method in phase 1 | Coverage claim |
|---|---|---|---|
| 1 | Visual UI (tokens, type, radius, controls) | Sweep measurements + static token scan | Measured on every route × viewport (Chromium) |
| 2 | Layout and alignment (overflow, clipping, overlap, z-index, in-viewport overlays) | Sweep (overflow, outside-viewport) + overlay probes (box, top-most at centre) | Measured |
| 3 | UX heuristics | Expert review against `docs/UX_DESIGN_STANDARDS.md` and the owner's brief, from the screenshots | Sampled (representative pages), not exhaustive |
| 4 | Interaction | Probes: palette, bell, menus, + Create, pane, picker, upload, sort, rapid clicks, double submit | Representative page per area |
| 5 | Modals and drawers | Probes: in viewport, focus in, Escape, focus return, scroll lock, resize | Measured for the shell overlays and task pane |
| 6 | Forms | Probes on Create task and Out of office | Two forms; other forms are in the test cases for phase 3 |
| 7 | Responsive | Sweep at 9 viewports + resize probes | Measured |
| 8 | Accessibility (WCAG 2.2 AA) | axe at 1440 and 390 on every route; keyboard probe on 6 pages; reflow; reduced motion | axe: every route at 2 viewports; keyboard: 6 pages. Contrast is axe-only (no manual review). Screen-reader runs: **not done** |
| 9 | Motion | Static inventory + probes (sidebar frames, computed animations, page transitions ON) | See GLOBAL_MOTION_AUDIT.md |
| 10 | Tables and grids | Table probe on 6 lists (structure, sort, paging, sticky header, row height, load time) | 6 lists |
| 11 | Browser compatibility | Edge and WebKit subset (Firefox BLOCKED) | 3 viewports + key interactions |
| 12 | Error / empty / loading states | States probe (not found ×10, empty lists ×8) | Loading states: **not measured** (they need throttling; phase 3) |
| 13 | Role-based UI | The sweep per role (what each role sees); server checks are NAVIGATION-AUDIT's | UI only |
| 14 | Content and readability | Date / number / currency formats counted per page; long text and markup probes | Formats on every 1440 page |
| 15 | Performance | Navigation time and CLS per visit; table load time | Indicative only (two or three sweeps ran in parallel on one machine) |
| 16 | Cross-module integration | One request seen from detail, list, search, home, queue, notifications, Admin records | One record |
| 17 | Edge cases | Long text, markup, zero records, rapid clicks, zoom 80-400 %, resize with an overlay open, offline during submit | As listed |

## 5. Severity

| Level | Meaning |
|---|---|
| **P0 Critical** | Blocks a task, loses data, exposes data, or crashes a page |
| **P1 High** | A main task is hard or wrong for a role or viewport; a WCAG A failure on a main page; a shell-level inconsistency seen on every page |
| **P2 Medium** | Inconsistent or confusing UI on a module; a WCAG AA failure; overflow or clipping on a supported viewport |
| **P3 Low** | Minor inconsistency; one page; a workaround exists |
| **P4 Cosmetic** | Pixel-level polish |

**Standard deviations:** a value that differs from the owner's reference dimensions is **not** a defect on its own. The current values are earlier decisions; the reference values are "starting values, configurable via tokens". Such differences are listed as **conflicts** with a recommendation (GLOBAL_DESIGN_SYSTEM.md). They become defects only once the owner adopts the standard. Differences **between modules** at the same viewport are defects (inconsistency), whatever the standard.

## 6. Defect record

Each defect has:
- ID, module, page, route, role, browser, viewport, category, severity;
- steps, expected, actual;
- evidence (screenshot path, console, network, measured value);
- root cause (file:line);
- suggested fix (shared component or token first);
- confirmed or suspected;
- retest status (empty until phase 3).

Rules:
- Intended behaviour (DEVELOPMENT-MEMORY decisions, release notes, `docs/GLOBAL_MOTION_NAVIGATION_IMPLEMENTATION.md`, `docs/qa/HEADER-AND-MOTION-AUDIT.md` "Expected design rules") is not reported as a defect.
- Suspected items are kept apart from confirmed ones.

## 7. Not covered in phase 1 (stated, not claimed)

- Dark theme sweep. Earlier dark crawls exist (`v1730-crawl`, `v1722-visual`). Re-run in phase 3.
- Classic view sweep. This is the owner's second UI (D-210/D-227). Only the static rules are reviewed; its runtime geometry is not measured. It needs the owner's decision first (GLOBAL_DESIGN_SYSTEM §9).
- Screen readers (NVDA / VoiceOver), manual contrast review, loading states under throttling, print, copy / download / export buttons, file preview, and real iOS / Android devices (no device service; WebKit stands in for Safari).
- Every form other than the two probed (listed in QA_TEST_CASES for phase 3).
- Performance under load. Large-table timing uses 60+ rows only.

## 8. Exit criteria per phase

| Phase | Exit criteria |
|---|---|
| Phase 1 | The standards are proposed. Every route × viewport is measured in Chromium. Edge and WebKit subsets are run (Firefox BLOCKED). The defects are recorded with evidence and grouped into fix batches. |
| Phase 2 | Each batch is merged with its tests. The standards' assertions are added to the sweep (the sweep then fails on a deviation). |
| Phase 3 | Every defect is retested (Fixed / Not fixed / Won't fix). The sweep is green at the 9 viewports in all 4 browsers. axe has no serious or critical findings. |
| Phase 4 | `toHaveScreenshot` baselines exist per route, role and viewport (VISUAL_REGRESSION_REPORT.md). |
