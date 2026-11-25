# Final global UI audit (v1.89.0)

**Date:** 25 Nov 2026. **Build:** v1.89.0 stage 4 (D-426), branch `release-189`. **Against:** the phase 1 register ([UI_UX_DEFECT_REPORT.md](UI_UX_DEFECT_REPORT.md), 44 defects on v1.88.0), the owner's goal "one application, one global UI, one design system, one screen structure", and the standards adopted in stage 3 ([GLOBAL_DESIGN_SYSTEM.md](GLOBAL_DESIGN_SYSTEM.md), [SCREEN_LAYOUT_STANDARD.md](SCREEN_LAYOUT_STANDARD.md)). The measured sign-off numbers are in [FINAL_QA_SIGNOFF.md](FINAL_QA_SIGNOFF.md).

## 1. The phase 1 register, final state

| Severity | Total | Fixed | Closed, not a defect | Open |
|---|---|---|---|---|
| P0 Critical | 0 | 0 | 0 | 0 |
| P1 High | 1 | 1 (LAY-01) | 0 | 0 |
| P2 Medium | 9 | 9 | 0 | 0 |
| P3 Low | 27 | 26 | 1 (OVL-01: WebKit harness timing, D-424) | 0 |
| P4 Cosmetic | 7 | 7 | 0 | 0 |
| **Total** | **44** | **43** | **1** | **0** |

Per ID (stage that fixed it; rows in [BUG_FIX_LOG.md](BUG_FIX_LOG.md)):

| Area | IDs | Stage |
|---|---|---|
| Layout | LAY-01 (P1), LAY-02, LAY-03 | 3a, 3a, 3c |
| Visual consistency | CON-01, 02, 03, 04, 05, 06, 07, 09, 10, 11, 12, 13, 15, 17, 18; TBL-01 | 3b-3c |
| Content | CON-08 (one date formatter; the last native date inputs in stage 4), CON-16 | 3e (+4), 3b |
| Responsive | RESP-01 … RESP-07 | 3a-3d |
| Accessibility | A11Y-01, 02, 03, 04 | 3a, 3b, 2, 3d |
| Layout shift | PERF-01, PERF-02 | 2, 3d (kept in stage 4 by PaneReserve alone, §3) |
| Motion | MOT-01 … MOT-05 | 2 (MOT-02: no view transitions in WebKit; real Safari not checked) |
| Console | ERR-01, ERR-02 | 3e, 3d |
| Forms | FORM-01, FORM-02 | 3d |
| Overlays | OVL-01 | closed in 3d (harness) |

Duplicates counted once (CON-14 = RESP-01, RESP-08 = LAY-02, RESP-09 = PERF-02); ERR-03 (test log noise) is not a defect.

## 2. Found and fixed after phase 1 (not in the register)

| Stage | Finding | Severity |
|---|---|---|
| 3a | Rail groups without an icon (Projects, every Admin / Super Admin group) | P3 |
| 3a | `btn-danger btn-compact` stayed large (declaration order) | P4 |
| 3c | Admin → Records → Tickets / Meetings rows did not open the record pane | P3 |
| 3c | `/users/[...unknown]` beside `@pane/[...rest]` made Next refuse every /users request (caught by e2e) | P1 (never released) |
| 3d | Entry animations left a transform behind: the pane's ⋯ menu off screen, the phone date sheet above the edge | P2 |
| 3d | Playwright WebKit renderer crash on view transitions across areas | P2 (WebKit only) |
| 3d | Devices page hang in WebKit (subscription lookup before permission); Dashboards hub meta-refresh | P3, P4 |
| 3e | The last 24 h clocks and yyyy-mm-dd texts in the text | P4 |
| 4 | **The task side pane stopped refreshing after an action** (Suspense boundary of D-424): stale pane, busy buttons, Undo leaving Mark complete pressed | **P2** |
| 4 | 26 + 6 native date inputs (the 6 had their type as an expression) | P3 |
| 4 | Task Summary's "Show" label squeezed to "Sho / w" (found by the visual baselines) | P4 |

## 3. The goal, point by point

| Point | State at sign-off | Evidence |
|---|---|---|
| One shell | Header 64 / 56, sidebar 250 / rail 72, padding 24 / 16, content left-aligned up to 1,600, in users, Admin and Super Admin. Classic keeps its own box (owner). | Sweep: shell token mismatches 0 (FINAL_QA_SIGNOFF) |
| One design system | Control sizes, spacing and type only from tokens (ESLint `control-size`, `spacing-scale`, `type-scale`); one popover surface; one Dialog; one Avatar; one RecordNo; one formatter for dates (ESLint `date-format`); **one date picker** for every date field (ESLint `date-input`, stage 4). | Lint clean; unit `shell-tokens-*`, `ui-components-v189`, `ui-modules-v189`, `content-v189`, `date-field-v189` |
| One screen structure | List = ListPage + ListToolbar + DataTable (phone cards); detail = PageHeader with badge / back slots; not found inside the shell. | Sweep `listPages`; e2e `v1890-ui-*` |
| Responsive | No page overflow, nothing outside the viewport, no squeezed phone table at the nine viewports (Chromium) and 1440 / 768 / 390 (Firefox, WebKit). | FINAL_QA_SIGNOFF |
| Accessible | axe wcag2a / aa / 21aa / 22aa 0 at 1440 and 390, light and dark; keyboard walks; reduced motion. Real screen readers not run. | ACCESSIBILITY_TEST_REPORT §5-6 |
| Motion | The owner's scale; transform / opacity only; reduced motion respected; no CLS above 0.05. | FINAL_MOTION_AUDIT, FINAL_MOTION_QA_REPORT |
| Guarded from now on | Visual baselines (155 Chromium screenshots, `VISUAL=1`), the sweep, the lint rules. | VISUAL_REGRESSION_REPORT |

## 4. What remains (not defects of this release)

- Real Safari (macOS, iOS): view transitions stay off in WebKit until checked there (MOT-D2); the devices page and the service worker were checked only in Playwright's WebKit on Windows.
- NVDA + Firefox and VoiceOver + Safari passes (ACCESSIBILITY_TEST_REPORT §5 lists what scripts cannot check).
- Loading under a slow network (skeleton timing, UIQA-TC-137).
- Deferred motion rows MOT-D1 (drag-and-drop FLIP, preview during exit, comment entrance).
- Report-file date cells keep their machine form (D-425, on purpose).
