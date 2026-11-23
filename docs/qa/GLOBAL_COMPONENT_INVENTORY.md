# Global component inventory (UI/UX QA, phase 1)

**Date:** 24 Nov 2026. **Build:** v1.88.0 (`893fb4b`), worktree `qa-ui`. **Status:** discovery only. Nothing in the app was changed.

This file lists every standard UI component the app needs, the current implementation(s), how widely each is used, and the duplicates. It also proposes the one component each part should use. The counts come from `grep` over `app/` and `features/` (`.tsx`) on this build:
- **files** is the number of files that import or use the component or class;
- **uses** is the number of occurrences.

Related documents:
- [GLOBAL_DESIGN_SYSTEM.md](GLOBAL_DESIGN_SYSTEM.md) (tokens);
- [SCREEN_LAYOUT_STANDARD.md](SCREEN_LAYOUT_STANDARD.md) (shell and layout);
- [UI_UX_DEFECT_REPORT.md](UI_UX_DEFECT_REPORT.md) (defects found by measurement).

**Legend:**
- **One:** a single implementation, used consistently.
- **Split:** a shared implementation exists, but many screens bypass it with raw classes or markup.
- **Duplicate:** two or more implementations of the same thing.

## 1. Shell (one per app; owned by `features/shell`)

| Part | Implementation | Status | Notes |
|---|---|---|---|
| App frame | `features/shell/AppShell.tsx` (424 lines), used by the three area layouts (`app/users/layout.tsx`, `app/admin/layout.tsx`, `app/superadmin/layout.tsx`) | **One** | The same frame for all three areas. It branches on: `classic` (Classic view, D-210/D-227), `mobile` (the users phone layout below 768 px, v1.43.0) and `panel` (Admin / Super Admin: Back to the app, Search settings). |
| Desktop header (top bar) | `AppShell.tsx:319` (`h-topbar` 64 px, `px-4 sm:px-6`) | **One** | It holds MobileNav (below md), the Classic logo, CommandPalette, NotificationBell and ProfileMenu. |
| Phone header | `AppShell.tsx:292` (`mob-topbar`, 56 px + safe area) | **Second header** | This is by design (D-176 / v1.43.0 mobile brief), but its height (56) differs from the desktop header (64). Classified as P3 in the defect report (UIQA-RESP-03). |
| Sidebar | `SidebarFrame.tsx` (aside, `w-sidebar` 220 px / `w-20` 80 px rail) + `SideNav.tsx` (links, groups) + `NavIndicator.tsx` (moving current bar) + `CreateMenu.tsx` + `WorkSidebar` (starred / department projects) | **One** | The rail swaps its markup instead of keeping one icon column (gap 3 of the motion audit: not built, a D-229 redesign). |
| Phone / tablet menu | `MobileNav.tsx` (the sheet below md, all areas) | **One** | Users phone layout: `MobileTabBar.tsx` + `/users/more`. Users desktop below md: `BottomNav.tsx`. That is **three bottom/side navigations** in the users area, depending on the width and the layout cookie. |
| Classic view frame | `Classic.tsx` (`ClassicBar`, `ClassicForms`), `ClassicScreens.tsx`, `classic-modules.ts`, about 40 `[data-view="classic"]` rules in `globals.css:603-830` | **Second UI (owner decision)** | A full second visual language (Tally-style). It conflicts with "one global UI". The owner must decide (Q in [GLOBAL_DESIGN_SYSTEM.md §9](GLOBAL_DESIGN_SYSTEM.md)). |
| Page header (title + actions) | `PageHeader.tsx` (94 pages) | **Split** | Ten other h1 implementations: `OverviewParts.tsx:60`, `MyTasks.tsx:313`, `ProjectHeader.tsx:53,188`, `PortfolioHeader.tsx:108`, `TaskDetail.tsx:223` (28 px), `TaskHome.tsx:158` (32 px), `NewProjectWizard`, `app/users/people/[id]/page.tsx:51`, `app/users/ai/assistant/page.tsx:55` (sr-only), `FillForm`. Public and auth pages use their own (32 / 44 px). |
| Breadcrumbs | `Display.tsx:142` `Breadcrumbs` (23 files), `BackLink` (3), `OriginLink` (2) | **Split** | Present on detail pages only. List pages have none. See SCREEN_LAYOUT_STANDARD §4. |
| Hub tabs (second-level navigation) | `HubTabs.tsx` (Admin → Insights), `SettingsLayout.tsx` (Admin → Set-up), `ConsoleLayout.tsx` (2), `ProfileTabs.tsx`, `OwnershipTabs`, `ViewTabs` (projects) | **Duplicate** | There are six second-level navigation patterns, plus 7 files with ad-hoc `role="tablist"`. |
| Toast layer | `Toast.tsx` (`ToastProvider`, `useToast`, `useTopModal`) | **One** | It is portalled into the top modal. |
| Overlay stack | `overlay-stack.ts` (v1.87.0) | **One** | Wired into every overlay listed in D-417. |
| Progress / pending | `NavigationProgress.tsx`, `PendingLink.tsx`, `html[data-nav-pending]` | **One** | |
| Command palette / search | `CommandPalette.tsx` (desktop), `MobileSearch.tsx` (`/users/search`), `SettingsSearch.tsx` (panels), `PowerSearch.tsx` (records), `ToolbarSearch.tsx` (1), the ListToolbar search | **Duplicate by context** | Five search inputs, each with its own markup and height (measured in the defect report). |

## 2. Controls

| Component | Shared implementation | Bypassed by | Status | Proposal |
|---|---|---|---|---|
| Button | `features/ui/Button.tsx` (`Button`, `buttonClass`: **6 files**). CSS classes `btn-primary` (129 uses / 91 files), `btn-secondary` (308 / 137), `btn-danger` (22 / 15), `btn-danger-quiet` (12 / 9), `btn-ghost` (35 / 17), `btn-compact` (502 / 185), `tb-btn` (32 / 13), `tb-split`, `.link` | The classes are the real standard. The `Button` component is almost unused. `SubmitButton` / `useActionForm` (`form.tsx`) adds the pending state. | **Split** | Keep the classes as the only source (tokens) and make `Button` the default for new code. Heights: see GLOBAL_DESIGN_SYSTEM §5. |
| Icon button | Ad-hoc `inline-flex h-9 w-9` / `h-11 w-11` / `h-8 w-8` in the shell and panes | None shared | **Missing** | Add an `IconButton` (40 px, 44 px on touch) with a required `aria-label`. |
| Text input | `.field-input` (580 uses / 138 files), `.field-compact` (87 / 29), `Field.tsx` (`Field`, `Select`, `Checkbox`, `Switch`, `RadioGroup`, `ErrorSummary`: **5 files**) | Many raw inputs with their own height classes (search bars, palette, PowerSearch, grid editors) | **Split** | The classes stay the standard, and `Field` becomes the label / hint / error wrapper everywhere. |
| Select | Native `<select>` (269 uses / 87 files) with `field-input` / `field-compact`; `.pill-select` (3); `PersonSelect` (35 files, a searchable listbox); `PeoplePicker` (14) | Two people pickers with different UIs (`PersonSelect` is single, `PeoplePicker` is multi) | **Duplicate** (people) | One `PeoplePicker` with `multiple`. |
| Date / range | `DateRangePicker.tsx` (16 files); native `type=date` inputs (CommandPalette filters, forms) | Native date inputs | **Split** | Use DateRangePicker (or one `DateField` wrapper) everywhere. Native inputs show browser-specific formats (see the content findings). |
| Checkbox / radio / switch | `Field.tsx` `Checkbox`, `RadioGroup`, `Switch`; `.mob-switch`; `TaskCheck` (`work/client.tsx`); `BulkSelect` | Native inputs styled per page | **Split / Duplicate** (switch: `Field.Switch` and `.mob-switch`) | One Switch. |
| Rich text | `RichEditor.tsx` (18 files) | | **One** | |
| File input | `FileListInput.tsx` (7 files) | `ImportPanel`, the avatar upload | **Split** | |
| Chips / pills | `ChoicePill.tsx` (`ChoicePill`, `PriorityPill`, `RequestPriorityBadge`, `TaskPriorityPill`: 27 files), `.tb-pill` | | **One-ish** | |

## 3. Containers and data display

| Component | Implementation(s) | Status | Notes |
|---|---|---|---|
| Card | `.card` class (463 uses / 185 files); `Display.tsx:54` `Card` component; `.card-link` (5); `StatusCard.tsx` (3); `.mob-card` (phone) | **Split** | The class is the standard. `rounded-xl` (34 uses / 26 files) and `rounded-2xl` (8 / 7) boxes sit beside `.card`'s `rounded-lg` (12 px). The measured radius spread is in the defect report. |
| Table | Raw `<table>` (83 uses / 65 files), of which `.data-table` is 61 / 50. `DataTable.tsx` (**1 file**), `RecordTable.tsx` (2), `ClientSortTable.tsx` (3), `TaskGrid` (3, work), `PagedRows` (11), `SortTh` / `SortLink` (19), `TableColumns` (global resize), `GroupFold` / `FoldTbody` (29) | **Duplicate** | Four table components plus raw tables. Sort, paging, sticky header, empty row and density differ (see the probes in the defect report). |
| List rows (phones) | `ApprovalCard.tsx`, `MobileInfoList.tsx`, `MobileTasks.tsx`, `.mob-card` | **Phone-only set** | By design (mobile brief). |
| Empty state | `Display.tsx` `EmptyState` (55 uses / 44 files), `NoResults` (16 / 15) | **One** | Some lists render an empty table instead (see the probes). |
| Error state | `States.tsx` `ErrorState` (8 files), `app/error.tsx`, `app/users/error.tsx`, `app/admin/error.tsx`, `app/superadmin/error.tsx`, `app/global-error.tsx`, `SectionBoundary` | **One-ish** | |
| Not found | `app/not-found.tsx`, `app/users/not-found.tsx`, `app/admin/not-found.tsx`, `app/superadmin/not-found.tsx`, `NoAccess.tsx`, `/users/no-access`, `/admin/no-access`, `/users/switched-off` | **Duplicate by area** | Four not-found pages with their own markup. |
| Loading | `Spinner` / `InlineLoading` / `SkeletonBlock` (`Spinner.tsx`, 19 files), `Skeleton.tsx` (Header/Tiles/List/Table/Chart/Form/Page skeletons, 15 files), `MobileSkeletons.tsx`, `BrandLoader.tsx` (4), `RoundLoader.tsx` (1), `Loaders.tsx` (`LogoSpinner`, `DotsRingLoader`, `BarLoader`, `CircularProgress`, `UploadProgress`, `StepLoader`, `SuccessTick`: 3 files; UploadProgress, CircularProgress and StepLoader are unused), `.loader-bar`, `.skeleton`, 17 route `loading.tsx` | **Duplicate** | Seven loader families. Proposal: Spinner (inline), Skeleton (page / section), BrandLoader (splash only). Retire the unused ones. |
| Badge / status | `Display.tsx` `Badge` (80 uses / 31 files), `.badge` class (19 / 15), `status-tones.ts`, `HealthBadge` | **Split** | |
| Avatar | `features/ui/Avatar.tsx` (`Avatar`, `initialsFor`: 8 files) **and** `features/ui/Display.tsx:43` `Avatar` + `:29` `initials` | **Duplicate (confirmed)** | Two `Avatar` components with different props (`src` + `approver` vs `name` + `size`) and two initials functions. |
| Progress | `Display.tsx:166` `Progress`, `StepMap`, `ApprovalRoad`, `Loaders.UploadProgress`, `CircularProgress` | **Duplicate** | All of them animate `width` (motion audit). |
| Pagination | `Display.tsx:176` `Pagination` (2 files), `PagedRows` (11), the per-list "Show more", TaskGrid's own paging | **Duplicate** | |
| Details / definition list | `DetailsList.tsx` (3), ad-hoc `<dl>` | **Split** | |
| Tooltip | `Hint.tsx` (69 files, CSS `::after`), `.rail-tooltip`, native `title` | **Split** | |

## 4. Overlays

| Component | Implementation(s) | Status | Notes |
|---|---|---|---|
| Modal dialog | `Dialog.tsx` (`Dialog`, `ConfirmDialog`, `DiscardDraftDialog`: 29 files) | **One (standard)** | |
| Raw `<dialog>` | `work/client.tsx:193`, `PaneParts.tsx:224`, `ProjectHeader.tsx:260`, `ShareDialogs.tsx:78,261`, `CommandPalette.tsx:338` (8 files) | **Duplicate** | They close with `dialog.close()`, not `closeTopLayer`, so there is no exit animation in Firefox or Safari. |
| `role="dialog"` divs | 21 uses / 17 files: `BottomSheet`, `MobileNav`, `NotificationBell`, `DateRangePicker`, `PowerSearch`, `PicBot`, `OnboardingTour`, `InstallInvite`, `TaskPane`, `RecordPane`, `TaskCreator:306`, `CustomizePanel:61`, `FieldControls` (3), `GridCellEditors` (2), `TryAsButton`, `RichEditor` emoji | **Duplicate** | The overlay stack (v1.87) unified Escape, trap and inert for most of them. Each still has its own markup, radius, shadow and motion. |
| Drawer / side pane | `Dialog` drawer variant, `TaskPane.tsx` + `TaskPaneHost`, `RecordPane.tsx`, the TaskCreator panel | **Duplicate (3 drawer families)** | |
| Bottom sheet (phones) | `BottomSheet.tsx`, DateRangePicker phone sheet, PowerSearch phone panel | **Duplicate** | |
| Dropdown menu | `Menu.tsx` / `MenuCore.tsx` (27 files), `Drop.tsx` (4), raw `<details>` panels (30 uses / 26 files) | **Duplicate** | |
| Popover | DateRangePicker, PeoplePicker, PersonSelect, PowerSearch, the bell panel | **Duplicate** | |
| Toast | `Toast.tsx` | **One** | |
| Unsaved guard | `UnsavedGuard.tsx` (12), `DiscardDraftDialog`, `PaneControl` / `pane-draft.ts` | **One-ish** | |

## 5. Forms infrastructure

| Part | Implementation | Status |
|---|---|---|
| Action forms | `features/ui/form.tsx` (`useActionForm`, `ResultMessage`, `FieldError`, the action error copy: 77 files) | **One** |
| Field wrapper | `Field.tsx` `Field` (5 files) vs `field-label` + `field-input` + `FieldError` by hand (138 files) | **Split** |
| Error summary | `Field.tsx` `ErrorSummary` | Rarely used |

## 6. Duplicates to merge (ordered by impact)

| # | Duplicate | Implementations | Effect measured or seen | Proposed single component |
|---|---|---|---|---|
| D1 | Page title (h1) | PageHeader + 10 custom h1s | h1 sizes 14 (sr-only) / 20 / 28 / 32 / 44 px across modules (MODULE_UI_CONSISTENCY_REPORT) | `PageHeader` with `variant="detail"` for record titles |
| D2 | Table | `.data-table` raw, DataTable, RecordTable, ClientSortTable, TaskGrid | Different sort affordance, paging, row height, sticky header (probes) | One `DataTable` (sort / paging / empty / sticky / density) on the existing `.data-table` tokens |
| D3 | Second-level navigation | HubTabs, SettingsLayout, ConsoleLayout, ProfileTabs, OwnershipTabs, ViewTabs, ad-hoc tablists | Different heights and indicators | `Tabs` (links) and `SectionNav` (settings list) |
| D4 | Overlay surfaces | Dialog, 8 raw `<dialog>`, 17 `role=dialog` divs, 3 drawers, 3 sheets | Different radius, shadow and motion | `Dialog` (modal / drawer / sheet variants) + `Popover` |
| D5 | Loaders | 7 families | | Spinner, Skeleton, BrandLoader |
| D6 | Dropdown | Menu / MenuCore, Drop, raw details | | `Menu` and `Popover` |
| D7 | Avatar + initials | `Avatar.tsx`, `Display.Avatar` | | `Avatar.tsx` |
| D8 | People picker | PersonSelect, PeoplePicker | | One picker, `multiple` |
| D9 | Switch | `Field.Switch`, `.mob-switch` | | `Field.Switch` |
| D10 | Search inputs | 5 | Different heights | `SearchField` |
| D11 | Not found / no access | 4 not-found pages + 3 no-access pages | | One `StatePage` (not found / no access / switched off) inside the shell |
| D12 | Pagination | Pagination, PagedRows, Show more, TaskGrid paging | | One `Pagination` |
| D13 | Progress bar | Progress, StepMap, ApprovalRoad, UploadProgress | All animate `width` | One `ProgressBar` (transform: scaleX) |
