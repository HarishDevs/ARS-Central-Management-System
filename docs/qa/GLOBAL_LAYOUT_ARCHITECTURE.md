# Global layout architecture

**Date:** 25 Nov 2026. **Build:** v1.89.0 (stage 4, branch `release-189`). **Status:** adopted; a pointer document.

The layout architecture is written once, in [SCREEN_LAYOUT_STANDARD.md](SCREEN_LAYOUT_STANDARD.md). This page says where each part is, so the two documents can never disagree.

| Topic | Where |
|---|---|
| One shell for `/users`, `/admin`, `/superadmin` (header, sidebar, `main`, the `@pane` slot) | [SCREEN_LAYOUT_STANDARD §1](SCREEN_LAYOUT_STANDARD.md#1-global-layout-architecture-one-shell) |
| Shell geometry, measured and adopted (header 64 / 56 on phones, sidebar 250 / rail 72, page padding 24 / 16, content max 1,600 left-aligned) | [SCREEN_LAYOUT_STANDARD §2](SCREEN_LAYOUT_STANDARD.md#2-measured-shell-geometry-current-and-the-proposed-standard); tokens in [GLOBAL_DESIGN_SYSTEM §A](GLOBAL_DESIGN_SYSTEM.md#a-adopted-tokens-v1890-d-421) |
| Screen templates (list = `ListPage` + `ListToolbar` + `DataTable`; detail = `PageHeader` with badge / back slots; settings; dashboard) | [SCREEN_LAYOUT_STANDARD §3](SCREEN_LAYOUT_STANDARD.md#3-screen-templates); components in [GLOBAL_COMPONENT_INVENTORY.md](GLOBAL_COMPONENT_INVENTORY.md) |
| Navigation inside the layout (breadcrumbs, ← Back, the side pane, place memory) | [SCREEN_LAYOUT_STANDARD §4](SCREEN_LAYOUT_STANDARD.md#4-navigation-inside-the-layout); tests in [NAVIGATION_TEST_REPORT.md](NAVIGATION_TEST_REPORT.md) |
| Responsive rules | [RESPONSIVE_STANDARD.md](RESPONSIVE_STANDARD.md) → [SCREEN_LAYOUT_STANDARD §5](SCREEN_LAYOUT_STANDARD.md#5-responsive-standard) |
| Overlay layers (z-index scale, one overlay stack, popover surface) | [GLOBAL_DESIGN_SYSTEM §8](GLOBAL_DESIGN_SYSTEM.md#8-z-index-keep-one-fix), [UI_REFACTORING_LOG stage 3d](UI_REFACTORING_LOG.md) |
| What changed per stage (D-421 shell and tokens … D-426 sign-off) | [UI_REFACTORING_LOG.md](UI_REFACTORING_LOG.md) |

## Guarded by

- Unit: `tests/ui/shell-tokens-*.test.ts`, `tests/ui/ui-modules-v189.test.ts`, ESLint `ars-ui/control-size`, `ars-ui/spacing-scale`, `ars-ui/type-scale`.
- e2e: `v1890-ui-shell`, `v1890-ui-components`, `v1890-ui-modules`, `v1860-header-consistency`.
- The UIQA sweep (shell token mismatches, page overflow, elements outside the viewport): 0 at sign-off ([FINAL_QA_SIGNOFF.md](FINAL_QA_SIGNOFF.md)).
- Visual baselines of the shell at all nine viewports ([VISUAL_REGRESSION_REPORT.md](VISUAL_REGRESSION_REPORT.md)).
