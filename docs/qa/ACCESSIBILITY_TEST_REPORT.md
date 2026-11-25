# Accessibility test report: WCAG 2.2 AA (UI/UX QA, phase 1)

**Date:** 24 Nov 2026. **Build:** v1.88.0. **Defects:** the A11Y-* entries in [UI_UX_DEFECT_REPORT.md](UI_UX_DEFECT_REPORT.md).

## 1. What ran

| Check | Method | Scope | Result |
|---|---|---|---|
| Automated rules | `@axe-core/playwright` 4.13, tags `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa` (target-size 2.5.8 included) | Every route of every role at **1440×900 and 390×844** (phone layout), Chromium, light theme. 354 runs. | **0 violations** in the final run. One `color-contrast` (serious, 1 node) in the first run, not reproduced (A11Y-04, suspected). |
| Keyboard: skip link, visible focus, focus not obscured (2.4.1, 2.4.7, 2.4.11) | Probe `keyboard`: a fresh load, then 30 Tab presses; the ring is read from the computed outline / box-shadow; in-viewport check | `/users`, `/users/requests`, `/users/work/my-tasks`, `/users/meetings/<id>`, `/admin/users`, `/superadmin` at 1440 | The first stop is "Skip to content" on all 6. **180 / 180 stops show a visible ring; 0 off-screen or hidden.** |
| Overlays: focus in, Escape, focus return (2.1.2, 2.4.3) | Probe `overlays`: palette, bell, account menu, + Create, MobileNav, task pane, Create task, date picker | 5 viewports × users / admin; Chromium, Edge, WebKit | Focus moves in (palette, menus, MobileNav, pane, Create task). Escape closes every overlay. Focus returns to the opener. MobileNav locks scroll (`html overflow: hidden`). The bell panel keeps focus on the bell button (a non-modal disclosure: acceptable). WebKit: see OVL-01. |
| Headings (1.3.1, 2.4.6) | The sweep: the count, size and visibility of h1 | All routes, 9 viewports | Exactly one h1 on every desktop page. **Phone Home and the overviews have no h1** (A11Y-02). The AI assistant has an sr-only h1 only (CON-04). |
| Reflow (1.4.10) | Probe `reflow`: 320×256 (1280 at 400 %), 640×360 (200 %), 1600×900 (80 %) | 12 representative pages | 400 %: **11 / 12 pass**; the task detail page scrolls 20 px sideways (A11Y-01). 200 %: 12 / 12. 80 %: 12 / 12. |
| Text spacing, resize text (1.4.4, 1.4.12) | Not run as a separate probe | — | The Classic text size (`--text-scale`, D-211) scales every token. 203 arbitrary px classes (55 files) don't follow it. Not measured. Phase 3. |
| Reduced motion (2.3.3 AAA, the app's own rule) | Probe `motion` (computed animation with `prefers-reduced-motion: reduce`) + the static inventory | Palette, menu, dialog | Palette animation → 0.01 ms; dialog → a 100 ms opacity fade (as designed, D-407); menus → 100 ms fade. **JS smooth scroll ignores reduce** in 2 places (A11Y-03). |
| Target size (2.5.8 AA) | axe `target-size` + the sweep's control heights at touch viewports | All routes at 390 | axe passes (24 px or spacing). The app's own 44 px touch rule is not met by `tb-btn` (28), the TaskGrid inline selects (19), grid inputs (22) and round checks (20): RESP-05. |
| Contrast (1.4.3, 1.4.11) | axe, plus the existing `scripts/qa/token-contrast.mjs` (D-407: 96 pairs AA, light and dark) | Light theme only in this sweep | Pass, apart from A11Y-04 (suspected). **Dark theme not re-run** (covered by `v1730-crawl` / `v1722-visual` earlier). |
| Status messages (4.1.3) | Probe `offline`, `forms` | Create task offline, Out of office | Offline: a `role=status` banner plus a `role=alert` form message. Out of office: `role=alert` "Choose a delegate." (no `aria-invalid` on the field, FORM-02, suspected). |
| Screen readers (NVDA, VoiceOver) | **Not run** | — | Phase 3 |

## 2. Findings

| ID | WCAG | Sev | Summary |
|---|---|---|---|
| UIQA-A11Y-01 | 1.4.10 Reflow (AA) | P2 | `/users/tasks/<id>` at 320 CSS px scrolls 20 px sideways (the phone task header's button row) |
| UIQA-A11Y-02 | 1.3.1 / 2.4.6 (best practice) | P3 | No h1 on phone Home, the tasks and meetings overviews, and `/users/work` |
| UIQA-A11Y-03 | 2.3.3 (AAA) / app rule | P3 | JS smooth scroll ignores reduced motion (`Field.tsx:177`, `ReadinessPanel.tsx:85`) |
| UIQA-A11Y-04 | 1.4.3 (AA) | P3, suspected | The due date text on the active grid row, once |
| UIQA-LAY-01 | 1.4.10 (related) | P1 | A long unbroken page title widens the whole desktop page (1,809 px of sideways scroll) |
| UIQA-FORM-01 | 3.3.1 / 3.3.2 | P3 | Create task: the disabled Create button gives no reason |
| UIQA-FORM-02 | 3.3.1 | P4, suspected | Out of office: the error isn't tied to the field (`aria-invalid` 0) |
| UIQA-RESP-05 | 2.5.8 passes; app touch rule | P3 | Small touch targets on touch screens |
| UIQA-CON-04 | 2.4.2 / 2.4.6 | P2 | The AI page has no visible title |

## 3. Earlier accessibility work this audit relies on (not re-tested)

- **D-394 (v1.72.2):** axe clean in light and dark at 1366 / 768 / 375 on the changed screens; the definition-list fixes.
- **D-407:** token contrast, 96 pairs.
- **D-417:** overlay stack (focus trap, inert, scroll lock), tested by `v1870-*` e2e.

## 4. Recommendations

1. Add the axe sweep (this spec, at 1440 and 390) to the nightly run, failing on serious / critical.
2. Add the reflow-at-320 check for every detail page to the sweep.
3. Make PageHeader mandatory (one visible h1, a phone variant), so pages can't ship without a heading.
4. Run NVDA / VoiceOver on the 6 representative pages in phase 3, in both themes.

## 5. Stage 3d results (v1.89.0, D-424, 24 Nov 2026)

### Fixed
| ID | Result |
|---|---|
| UIQA-A11Y-04 | Confirmed at 4.23:1 (`#15803d` on `--color-row-active`). Light status text tokens darkened: success `#137333` (5.03:1 on row-active, 5.95 on white), warning `#b93c0b` (4.78 / 5.65). `scripts/qa/token-contrast.mjs` now checks every text token on row-active in light and dark: 0 failures (dark ≥ 7:1). e2e: axe `color-contrast` on the open row and the measured ratio of "Today", light and dark, Chromium / Firefox / WebKit. |
| UIQA-FORM-01 | Create task keeps its button enabled; a missing name / person / due date is announced (`role=alert`) under the name, which is `aria-invalid` and `aria-describedby`, and focus moves to it (3.3.1, 3.3.3). |
| UIQA-FORM-02 | The Out of office picker is marked and described by its error (`aria-describedby`); `aria-invalid` is not permitted on its button role (ARIA 1.2), so it is not used. |
| UIQA-RESP-06 | Phone lists keep a clear strip under the last row and `scroll-padding-bottom` for the Pico Bot launcher, so focus is never hidden behind it (2.4.11). |
| UIQA-ERR-02 | The hydration mismatch (React #418) on Profile → App & devices: a browser check ran during render; now in the effect. |
| meta-refresh | The Dashboards hub is a server redirect (no `<meta http-equiv=refresh>`, 2.2.1 / 3.2.5). |
| Toast live regions | `role=status` (polite) and `role=alert` (assertive) are real boxes present before any toast (were `display: contents`, which some screen readers drop together with the role). |
| Popovers | One surface; PersonSelect returns focus to its button on Escape and after a choice (2.4.3). |

### Screen-reader-oriented pass (without a screen reader)
**No real NVDA, JAWS, VoiceOver or TalkBack was run** (none is available to the agent in this environment). What was checked instead, by script, in Chromium, Firefox and WebKit (`tests/e2e/v1890-accessibility.spec.ts`):
- **Landmarks and headings:** `/users`, `/users/requests`, `/users/work/my-tasks`, `/users/information`, `/admin/users`, `/superadmin` at 1440: exactly one `main`, a banner and navigation, exactly one h1, and no skipped heading level inside `main`.
- **Labelled controls:** axe (wcag2a / aa / 21aa / 22aa) on every route in the sweep (sections 1 and the UI_REFACTORING_LOG stage 3d numbers): no `label`, `button-name`, `link-name`, `aria-*` violations.
- **Live regions:** the toast regions exist with their roles before a toast arrives; Create task's missing-field message is `role=alert`.
- **Focus management:** Create task: focus starts in the task name; the missing-field message moves focus to the first missing part; Escape closes; the task pane: opened from a task link by Enter, focus moves inside, Escape closes it and the address loses `?task=`; menus and pickers give focus back (stage 1-3 e2e).
- **Keyboard-only walks:** + Create → Task (Tab, Enter, ↓, Enter), type the name, the due date, Ctrl + Enter creates it; open the task pane by Enter and close it by Escape; a manager tabs to **Approve** on a request and presses Enter (Approved by Manoj Manager); Admin → Users: the toolbar's Search button by keyboard, type, Enter filters the list. The first Tab is **Skip to content** (Chromium, Firefox). WebKit (Safari) moves Tab between form controls and buttons only by default (links need Option + Tab, which Playwright's WebKit on Windows does not send); there the walks use buttons and fields, and the skip link is checked as the first focusable element.
- **Not verified:** how a screen reader actually voices the pages (reading order, verbosity, the names of icon-only controls in context), VoiceOver rotor / NVDA elements lists, speech for the toasts while a dialog is open (the toasts move into the open dialog: D-394), mobile screen readers, Windows high-contrast mode. Recommended for stage 4 sign-off with a real NVDA + Firefox and VoiceOver + Safari run on the 6 representative pages, both themes.

### Dark theme
axe was run on every sweep route in dark at 1440 and 390 in Chromium for the first time: **0 violations** (354 visits). Light: Chromium 1,783 visits, Firefox 531, WebKit 531: **0 violations** (axe at 1440 and 390). The sweep also found the Task Summary layout shift (PERF-02) in dark, fixed.

## 6. Stage 4 results (v1.89.0 sign-off, D-426, 25 Nov 2026)

### Fixed
| Item | Result |
|---|---|
| Date fields (32) | Every date field is the shared picker: a real `<button>` named by its `<label>` and its value ("Due: Tuesday 1 December 2026, 5:00 pm. Change"), the dialog with a labelled month grid (`role=grid`, arrows / Page Up / Page Down / Home / End / Enter), focus back on the button on close, a bottom sheet with `aria-modal` on phones. A required empty date says "Choose a date." under the button (`role=alert`), the button is described by it and takes focus (3.3.1, 3.3.3). The hidden value input is `aria-hidden` and out of the Tab order. The time beside it is a native time box with its own label ("Due time"). |
| Profile photo buttons (axe `target-size`, Firefox) | With a photo, **Upload new photo** and **Remove photo** were 20 px tall 8 px apart: both are now at least 24 px (2.5.8). Found by the Firefox run of e2e v160-ui RA-03 (Chromium's geometry passed the spacing exception). |
| Task pane after an action | The pane refreshes again after Mark complete / Undo / a reaction (stage 4 v162 root cause): its buttons no longer stay disabled, so keyboard users can continue in the pane (2.1.1 in practice). |

### Measured
See [FINAL_QA_SIGNOFF.md](FINAL_QA_SIGNOFF.md) §3 for the sweep: axe (wcag2a / aa / 21aa / 22aa) at 1440 and 390 in Chromium (light and dark) and at 1440 / 768 / 390 in Firefox and WebKit. The e2e accessibility specs (`v1890-accessibility` 11 tests, `v160-ui` RA-03 on 31 pages in light and dark, `v1722-visual` axe, the crawl's axe on every route) ran in all three browsers in the full suites.

### Still not verified (unchanged from §5)
Real NVDA + Firefox, JAWS, VoiceOver + Safari (macOS, iOS) and TalkBack passes; reading order and verbosity as heard; the toasts' speech while a dialog is open. Scripts cannot replace them; the owner's UAT should include one pass per screen reader on the 6 representative pages in both themes.
