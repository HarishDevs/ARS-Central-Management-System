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
