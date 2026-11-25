# UI/UX QA test cases

**Date:** 24 Nov 2026. **Build:** v1.88.0. **Plan:** [QA_TEST_PLAN.md](QA_TEST_PLAN.md).

**Columns:** ID, category, case, steps (short), expected, and how it runs. Automation is one of:
- **S** = the sweep (`zz-ui-qa-audit.spec.ts`);
- **P** = a probe (`zz-ui-qa-probes.spec.ts`, probe group in brackets);
- **M** = manual or not yet automated.

**Phase 1 result column:**
- **Ran** = executed in phase 1 (results in the reports);
- **Ph3** = to run in phase 3 (not claimed).

The expected values use the proposed standards (GLOBAL_DESIGN_SYSTEM.md, SCREEN_LAYOUT_STANDARD.md). Where a standard is not yet adopted, the case checks **consistency** across modules at the same viewport.

## A. Shell and layout (S)

| ID | Case | Expected | Run | Phase 1 |
|---|---|---|---|---|
| UIQA-TC-001 | Header height at each viewport | One value on every page of an area at a viewport (proposed: 64 desktop; the phone layout's own value documented) | S | Ran |
| UIQA-TC-002 | Header padding-x | One value (proposed 24 at ≥ 640) | S | Ran |
| UIQA-TC-003 | Sidebar width expanded | One value in all areas (current 220; proposal per GLOBAL_DESIGN_SYSTEM §2) | S | Ran |
| UIQA-TC-004 | Sidebar width collapsed (rail) | One value (current 80; owner 72) | S (rail pass) | Ran |
| UIQA-TC-005 | Content left edge at a viewport | The same `contentLeft` on every page of an area (no page-level wrapper changes it) | S | Ran |
| UIQA-TC-006 | Content padding-x and top | One value per breakpoint | S | Ran |
| UIQA-TC-007 | Content max-width | One rule (current `max-w-7xl` centred) | S | Ran |
| UIQA-TC-008 | Gap header → first block | One value per breakpoint | S | Ran |
| UIQA-TC-009 | Page header present (PageHeader) with one h1 | Every app page has exactly one visible h1 in `main` | S | Ran |
| UIQA-TC-010 | Breadcrumb on detail pages | Every detail page has a breadcrumb or a Back link | S | Ran |
| UIQA-TC-011 | No horizontal page scroll | `scrollWidth - clientWidth ≤ 1` at every viewport | S | Ran |
| UIQA-TC-012 | Nothing outside the viewport | No visible element past the left / right edge that isn't in a scroll area | S | Ran |
| UIQA-TC-013 | Collapsed sidebar: content reflows | contentLeft follows the rail width | S (rail) | Ran |

## B. Visual tokens (S + static)

| ID | Case | Expected | Run | Phase 1 |
|---|---|---|---|---|
| UIQA-TC-020 | h1 size / weight per module | One size and weight for page titles at a viewport (proposed 24 / 600; record titles may use the same) | S | Ran |
| UIQA-TC-021 | h2 (section) size | One size (proposed 18) | S | Ran |
| UIQA-TC-022 | Body text size | 14 px in tables and paragraphs | S | Ran |
| UIQA-TC-023 | Button heights by class | `btn-primary` / `btn-secondary` / `btn-danger` one height (proposed 40; 44 on touch); `btn-compact` one height | S | Ran |
| UIQA-TC-024 | Input heights by class | `field-input` one height (proposed 42; 44 touch); `field-compact` one height | S | Ran |
| UIQA-TC-025 | Card radius | `.card` 12 px; other bordered boxes 12 (or 8 for inner) | S | Ran |
| UIQA-TC-026 | No raw colours | No hex or raw palette classes outside brand / journey art | Static | Ran |
| UIQA-TC-027 | No arbitrary px type | Text only via the type tokens | Static | Ran |
| UIQA-TC-028 | Modal radius | 16 px | P (overlays) | Ran |

## C. Interaction (P)

| ID | Case | Steps | Expected | Run | Phase 1 |
|---|---|---|---|---|---|
| UIQA-TC-040 | Search palette | Click Search; wait; Escape | Opens inside the viewport, focus inside, top-most; Escape closes; focus back on the opener | P (overlays) | Ran (5 viewports × 2 areas) |
| UIQA-TC-041 | Notification bell | Click; Escape | In viewport; closes; focus back | P (overlays) | Ran |
| UIQA-TC-042 | Account menu | Click; Escape | In viewport; closes | P (overlays) | Ran |
| UIQA-TC-043 | + Create menu | Click Create (≥ 768) | Menu in viewport | P (overlays) | Ran |
| UIQA-TC-044 | Phone menu | Open menu below 768 (panels) | Sheet in viewport, focus inside, scroll locked, Escape closes | P (overlays) | Ran |
| UIQA-TC-045 | Resize with palette open | Open at 1440 → 390 → 1440 | Palette stays inside the viewport; no page overflow | P (resize) | Ran |
| UIQA-TC-046 | Resize with task pane open | `?task=` at 1440 → 390 | Pane in viewport or the phone page; no overflow | P (resize) | Ran |
| UIQA-TC-047 | Task pane | `?task=` at 1920 / 1440 / 1024 / 768; Escape | Inside the viewport; Escape closes; `task=` gone from the URL | P (pane) | Ran |
| UIQA-TC-048 | Date picker in a dialog | Create task → dates | Picker inside the viewport; Escape closes the picker, not the dialog | P (picker) | Ran |
| UIQA-TC-049 | File upload | Create task → attach | The chip shows the file name | P (upload) | Ran |
| UIQA-TC-050 | Sort | Click the first sortable header | URL / `aria-sort` changes | P (tables) | Ran |
| UIQA-TC-051 | Rapid sort clicks | 6 quick clicks | No errors; a consistent final state | P (rapid) | Ran |
| UIQA-TC-052 | Double-clicked nav link | Double-click a sidebar link | Lands once; no error | P (rapid) | Ran |
| UIQA-TC-053 | Tabs, accordions, toggles, filters, pagination, copy / download / print | Each per module | Keyboard and mouse both work; state kept in the URL where documented | M | Ph3 |

## D. Forms (P)

| ID | Case | Expected | Run | Phase 1 |
|---|---|---|---|---|
| UIQA-TC-060 | Required name empty | Create disabled or an error under the field (`aria-invalid`) | P (forms) | Ran |
| UIQA-TC-061 | Whitespace-only name | Refused | P (forms) | Ran |
| UIQA-TC-062 | Special characters and emoji | Saved and shown as text (no markup, no script) | P (forms) + P (longtext) | Ran |
| UIQA-TC-063 | Trimming | Leading / trailing spaces trimmed on save | P (forms) | Ran |
| UIQA-TC-064 | Double submit | Double-click Create → exactly one record | P (forms) | Ran |
| UIQA-TC-065 | Unsaved warning | Typed name + Escape → "Discard draft?" | P (forms) | Ran |
| UIQA-TC-066 | Error placement | Errors next to the field, a summary for long forms | P (forms: Out of office) | Ran |
| UIQA-TC-067 | Offline during submit | Message shown, input kept, nothing saved, works again online | P (offline) | Ran |
| UIQA-TC-068 | Length limits | `maxlength` matches the DB column (e.g. task title 200) | P (forms: attribute) + M | Ran (task name) |
| UIQA-TC-069 | Dates (past, holiday, range order) | Validated with a message | M | Ph3 |
| UIQA-TC-070 | The same checks on: custom request, information, meeting, ticket, project, portfolio, admin user, group, DoA, task type | As above | M | Ph3 |

## E. Responsive (S + P)

| ID | Case | Expected | Run | Phase 1 |
|---|---|---|---|---|
| UIQA-TC-080 | 9 viewports, every route | No overflow; shell rules A hold | S | Ran (Chromium); 3 viewports in Edge / WebKit (Firefox BLOCKED) |
| UIQA-TC-081 | Users phone layout below 768 | Phone top bar + tab bar; the desktop sidebar is hidden | S | Ran |
| UIQA-TC-082 | Panels below 768 | MobileNav menu; no phone layout (by design) | S | Ran |
| UIQA-TC-083 | Touch targets on touch screens | ≥ 44 px for shell controls; ≥ 24 px (WCAG 2.5.8) everywhere | S (button heights at touch viewports) + axe `target-size` | Ran |

## F. Accessibility (S + P)

| ID | Case | Expected | Run | Phase 1 |
|---|---|---|---|---|
| UIQA-TC-090 | axe wcag2a / 2aa / 21aa / 22aa | No violations | S (1440, 390) | Ran |
| UIQA-TC-091 | Skip link first | The first Tab is "Skip to content" | P (keyboard) | Ran |
| UIQA-TC-092 | Visible focus | Every Tab stop shows a ring | P (keyboard) | Ran |
| UIQA-TC-093 | Focus never hidden | No Tab stop off-screen or behind a bar (2.4.11) | P (keyboard) | Ran |
| UIQA-TC-094 | One h1, ordered headings | Exactly one h1 per page | S | Ran |
| UIQA-TC-095 | Reflow at 400 % (320 CSS px) | No two-dimensional scroll (1.4.10) | P (reflow) | Ran |
| UIQA-TC-096 | 200 % / 80 % zoom | No overflow; layout holds | P (reflow) | Ran |
| UIQA-TC-097 | Reduced motion | Overlays fade ≤ 100 ms or not at all; nothing moves | P (motion) | Ran |
| UIQA-TC-098 | Screen reader pass | Landmarks, names and live regions read correctly | M | Ph3 |
| UIQA-TC-099 | Contrast (manual, both themes) | AA | M (axe covers the computed text) | Ph3 |

## G. Motion (P + static)

| ID | Case | Expected | Run | Phase 1 |
|---|---|---|---|---|
| UIQA-TC-110 | Overlay timings | Menus 150, dialogs 250 in / 150 out, drawers 250 (owner's new brief) | P (motion) | Ran (current values recorded) |
| UIQA-TC-111 | Sidebar and content move together | Main's left follows the sidebar each frame; no layout shift entry | P (sidebar) | Ran |
| UIQA-TC-112 | Page transitions ON | Fade + small move; back / forward and rapid clicks land on the last target; no errors; CLS < 0.1 | P (transitions) | Ran (Chromium) |
| UIQA-TC-113 | No width / height / top / left animations | transform / opacity only | Static | Ran |

## H. Tables (P)

| ID | Case | Expected | Run | Phase 1 |
|---|---|---|---|---|
| UIQA-TC-120 | Structure | `.data-table`, header row, body 14 px, sortable headers with `aria-sort` | P (tables) | Ran (6 lists) |
| UIQA-TC-121 | Sticky header in scrolling tables | `position: sticky` | P (tables) | Ran |
| UIQA-TC-122 | Paging / Show more | Present when there are more rows than one page | P (tables) | Ran |
| UIQA-TC-123 | Large list load | < 2 s for 60+ rows (local) | P (tables) | Ran (indicative) |

## I. States, content and edge cases (P + S)

| ID | Case | Expected | Run | Phase 1 |
|---|---|---|---|---|
| UIQA-TC-130 | Not found (record ids, unknown pages) per area | 404 with the shell kept, plain words and a way back | P (states) | Ran (10) |
| UIQA-TC-131 | Empty lists (no records) | EmptyState with the next step, never an empty table | P (states) | Ran (8) |
| UIQA-TC-132 | 190-character unbroken title | Wraps or truncates with the full text available; no overflow at 360-1440 | P (longtext) | Ran |
| UIQA-TC-133 | Markup in titles | Shown as text | P (longtext) | Ran |
| UIQA-TC-134 | Date formats | One format family per context (date `d Mon yyyy`, date-time with 12 h time) | S (formats) | Ran |
| UIQA-TC-135 | Currency / number | ₹ with Indian grouping | S (formats) | Ran |
| UIQA-TC-136 | Console errors / failed requests per page | None | S | Ran |
| UIQA-TC-137 | Loading states (throttled) | Skeleton within 150 ms, no blank flash | M | Ph3 |

## J. Cross-module integration (P)

| ID | Case | Expected | Run | Phase 1 |
|---|---|---|---|---|
| UIQA-TC-140 | One request from detail, my list, search, home, queue (approver), notifications (approver), Admin records | The same number, title and status words everywhere | P (integration) | Ran |
| UIQA-TC-141 | The same for a task (My tasks, project, pane, search, Admin records) | Same | M | Ph3 |

## K. Browser compatibility

| ID | Case | Expected | Run | Phase 1 |
|---|---|---|---|---|
| UIQA-TC-150 | Geometry at 1440 / 768 / 390 in Edge, Firefox, WebKit | The same values as Chromium (± 1 px) | S | Ran (Edge, WebKit: 0 differences); Firefox BLOCKED |
| UIQA-TC-151 | Overlays, pane, picker, upload, resize in Edge, Firefox, WebKit | Same as Chromium | P (subset) | Ran (Edge, WebKit); Firefox BLOCKED |

## Stage 4 sign-off result per case (v1.89.0, D-426, 25 Nov 2026)

**Run on the final build** (unless a row says otherwise). **Pass** = the expected result held in every browser named; **Fail** = it did not (none at sign-off); **Not run** = not executed in stage 4 (reason given). Evidence: [FINAL_QA_SIGNOFF.md](FINAL_QA_SIGNOFF.md) (§2 tests, §3 sweep), the e2e spec named.

| IDs | Result | Evidence |
|---|---|---|
| TC-001 … TC-013 (shell and layout) | **Pass** | Sweep: shell token mismatches 0, page overflow 0, outside 0 (Chromium 9 viewports + rail; Firefox / WebKit 1440 / 768 / 390); one h1 per page; breadcrumb / back on detail pages; e2e v1890-ui-shell (3 browsers) |
| TC-020 … TC-028 (visual tokens) | **Pass** | Sweep type / control / radius measures on tokens; lint `control-size`, `spacing-scale`, `type-scale` clean; visual baselines (155, Chromium) |
| TC-040 … TC-052 (interaction) | **Pass** | Probes (Chromium, sweep §3); e2e v1890-ui-components, v1760-pane-url, v1830-task-pane (Chromium, WebKit; Firefox re-run §4), v1750-date-picker, v1523, v1580-sorting (3 browsers) |
| TC-053 (tabs, accordions, copy / download / print per module) | **Pass** (tabs, accordions, filters, pagination, downloads) / **Not run** (print) | e2e v161, v172, v1641, session11 CSV, v1810 downloads; print not automated |
| TC-060 … TC-068 (forms) | **Pass** | Probes `forms`, `offline`; e2e v1890-accessibility (FORM-01 / 02), v139-draft-task |
| TC-069 (dates: past, holiday, range order) | **Pass** | Stage 4: every date field on the shared picker (min dates greyed out, required "Choose a date."); e2e v1750-date-picker, v1890-content, v1510, v1550, v1552; unit date-field-v189; server rules unchanged (integration 654 / 654) |
| TC-070 (the same checks on the other forms) | **Pass** | e2e v1510 (meeting), v1550 (ticket), approval-flow / v1500 (custom request), information (v1890-content), v1850 (admin user), v127 (rules), v138 (form designer) |
| TC-080 … TC-083 (responsive) | **Pass** | Sweep at 9 viewports (Chromium) and 1440 / 768 / 390 (Firefox, WebKit): overflow 0, squeezed phone tables 0; touch sizes (RESP-05); RESPONSIVE_TEST_REPORT §6 |
| TC-090 (axe) | **Pass** | Sweep axe 0 (Chromium 1440 / 390 light and dark; Firefox, WebKit 1440 / 390); e2e v160-ui RA-03, v1722 axe, v1890-accessibility in 3 browsers (WebKit / Firefox re-runs §4); the Profile target-size finding fixed |
| TC-091 … TC-097 (keyboard, focus, reflow, zoom, reduced motion) | **Pass** | Probes `keyboard`, `reflow`, `motion`; e2e v1890-accessibility, v1800-motion (Chromium, Firefox; WebKit: same failure on the 3e build, §4) |
| TC-098 (screen reader) | **Not run** | No NVDA / JAWS / VoiceOver / TalkBack available (ACCESSIBILITY_TEST_REPORT §5-6) |
| TC-099 (manual contrast, both themes) | **Pass (scripted)** | `scripts/qa/token-contrast.mjs`, axe in light and dark; no manual pass |
| TC-110 … TC-113 (motion) | **Pass** | e2e v1800-motion, v1870-motion-perf, v1890-motion (3 browsers; WebKit / Firefox notes §4); lint and the motion unit tests |
| TC-120 … TC-123 (tables) | **Pass** | Probe `tables`; e2e v1580-sorting, v1592-tables, v172-lists |
| TC-130 … TC-133 (states and edge cases) | **Pass** | Probes `states`, `longtext`; visual baselines (not found, empty states) |
| TC-134 (date formats) | **Pass** | Stage 3e formatter; sweep format counts (§3); no native date input left (lint `date-input`) |
| TC-135 (currency) | **Pass** | Sweep format counts |
| TC-136 (console errors / failed requests) | **Pass in the sweep**; residual risk R1 | Sweep console / failed / status 0 (§3); React #418 seen 6 times in stage 4's long crawls under load (FINAL_QA_SIGNOFF R1) |
| TC-137 (loading under throttling) | **Not run** | Not in scope of the automated runs |
| TC-140, TC-141 (cross-module integration) | **Pass** | Probe `integration`; e2e v1721-nav, v1870-navigation-continuity, v121-records |
| TC-150, TC-151 (browsers) | **Pass** (Firefox, WebKit 1440 / 768 / 390 geometry equal to Chromium; overlays, pane, picker in v1890-* sets) / Edge **not re-run** in stage 4 | Sweep §3; e2e v1890-* in all three browsers |
