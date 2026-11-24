# Responsive standard

**Date:** 25 Nov 2026. **Build:** v1.89.0 (stage 4, branch `release-189`). **Status:** adopted; a pointer document.

The responsive rules are written once, in [SCREEN_LAYOUT_STANDARD §5](SCREEN_LAYOUT_STANDARD.md#5-responsive-standard). In short (details and reasons there):

| Width | Layout |
|---|---|
| ≥ 1280 | Sidebar open (250) unless folded by the person; content left-aligned up to 1,600; the task pane beside the list. |
| 1024-1279 | Desktop layout; sidebar starts folded to the rail (72) with no saved choice (`ars_vw`). |
| 768-1023 | Tablet: rail by default, ☰ opens the sidebar; the task opens as the centred window. |
| < 768 | Phone: phone top bar 56, tab bar (users), page padding 16; lists become cards (`DataTable cards`, each value after its column name); the task opens its own page; dialogs and pickers are bottom sheets. |
| Touch (`pointer: coarse`) | Every named control ≥ 44 px (`--touch-min`). |

The nine test viewports: 1920×1080, 1440×900, 1366×768, 1280×720, 1024×768, 768×1024, 430×932, 390×844, 360×800 (`tests/e2e/ui-qa-shared.ts`).

## Guarded by

- The UIQA sweep at the nine viewports (Chromium) and 1440 / 768 / 390 (Firefox, WebKit): page overflow, elements outside the viewport, squeezed phone tables. Results: [RESPONSIVE_TEST_REPORT.md](RESPONSIVE_TEST_REPORT.md), [FINAL_QA_SIGNOFF.md](FINAL_QA_SIGNOFF.md).
- Visual baselines at 1440 / 1024 / 390, the shell pages at all nine ([VISUAL_REGRESSION_REPORT.md](VISUAL_REGRESSION_REPORT.md)).
- e2e `v143-mobile`, `v1890-ui-components` (phone cards), `v1890-accessibility` (reflow).
