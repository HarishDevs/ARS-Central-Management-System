# Screen layout standard: proposal

> **This document also covers GLOBAL_LAYOUT_ARCHITECTURE and RESPONSIVE_STANDARD.** Those two are sections 1 and 5 of this file, not separate files.

**Date:** 24 Nov 2026. **Build:** v1.88.0. **Status:** a proposal (phase 1). The values are tokens from [GLOBAL_DESIGN_SYSTEM.md](GLOBAL_DESIGN_SYSTEM.md). "Measured" means the sweep (`audit/ui-qa/summary.json`, Chromium, 9 viewports).

## 1. Global layout architecture (one shell)

```
<html data-theme>                                   app/layout.tsx
 └ AppShell (area = users | admin | superadmin)     features/shell/AppShell.tsx
    ├ skip link "Skip to content" → #main
    ├ Sidebar (≥ 768)                               SidebarFrame + SideNav + NavIndicator (+ CreateMenu in users, Search settings + Back to the app in panels)
    └ column
       ├ Header (sticky, z-header)                  MobileNav button (< 768) · CommandPalette · NotificationBell · ProfileMenu
       ├ Global banners (maintenance, offline, slow network, update, view-only, try-as, demo)
       ├ NavigationProgress (bar after 150 ms; skeleton by route)
       ├ <main id="main">                           content wrapper: the ONLY place for page padding and max-width
       │   ├ Breadcrumb (detail and second-level pages)
       │   ├ PageHeader (h1 + meta + primary actions)
       │   ├ Second-level navigation (Tabs / SectionNav), when the page is a hub
       │   └ Sections (gap = --section-gap)
       ├ Bottom navigation (users phone layout: MobileTabBar; users desktop layout < 768: BottomNav)
       └ Layers (portalled): pane (@pane / RecordPane) z-sticky / z-drawer · popovers z-popover · dialogs (top layer) · toasts z-toast · palette (top layer)
```

**Rules:**
1. Pages never set their own outer padding, max-width or top margin.
   - Measured today: no page does. Every app page has the same `main` padding and left edge at a viewport (§2). **Keep this rule as a lint check.**
2. Every page has a `PageHeader` with exactly one `h1`.
   - The exceptions are measured in §3.
   - A page whose layout needs a custom title (project, portfolio, task) uses `PageHeader` slots (`title`, `badge`, `meta`, `actions`, `leading`) instead of its own h1.
3. Every detail page and every page below a hub has a breadcrumb.
   - **List pages have none** (measured: 16 of 95 users pages and 5 of 45 Admin pages have one).
   - Proposal: breadcrumbs on detail, settings and hub child pages. List pages keep the sidebar as their location. That is the current practice, written down.
4. One second-level navigation component: `Tabs`.
   - It covers HubTabs, ProfileTabs, OwnershipTabs, ViewTabs and the ad-hoc tablists.
   - `SettingsLayout` (a section list) stays as `SectionNav` for settings hubs.
5. Layers come only from the z tokens (GLOBAL_DESIGN_SYSTEM §8) and the overlay stack (`overlay-stack.ts`).

## 2. Measured shell geometry (current) and the proposed standard

The **measured** values are identical on every page of an area at each viewport. Chromium; all users, admin and superadmin pages; light theme. The exceptions are listed under the table.

| Viewport | Area | Header h / px | Sidebar | main padding x / top | max-width | content left / right | header → first block |
|---|---|---|---|---|---|---|---|
| 1920×1080 | users, admin, superadmin | 64 / 24 | 220 (rail 80) | 32 / 40 | 1280 centred | **462** / 242 (rail: 392) | 40 |
| 1440×900 | all | 64 / 24 | 220 (rail 80) | 32 / 40 | 1280 | 252 / 32 (rail: 152) | 40 |
| 1366×768 | all | 64 / 24 | 220 (rail 80) | 32 / 40 | 1280 | 252 / 32 (rail: 115) | 40 |
| 1280×720 | all | 64 / 24 | 220 (rail 80) | 32 / 40 | 1280 | 252 / 32 (rail: 112) | 40 |
| 1024×768 | all | 64 / 24 | 220 (rail 80) | 32 / 40 | 1280 | 252 / 32 (rail: 112) | 40 |
| 768×1024 (touch) | all | 64 / 24 | **220 expanded** | 32 / 40 | 1280 | 252 / 32 | 40 |
| 430 / 390 / 360 | users (phone layout) | **56 / 12** | none (tab bar) | 16 / **16** | none | 16 / 16 | 16 |
| 430 / 390 / 360 | admin, superadmin | **64 / 16** | none (MobileNav) | 16 / **24** | 1280 | 16 / 16 | 24 |
| all | public (Privacy, Terms) | **68-69** / 0 | none | 24 / 40 | **896** | centred | 40 |
| all | public (landing, login, auth) | none (split screen) | none | 0 | none | 0 | n/a |

**Exceptions measured:**
- `/users/work/my-tasks?task=<id>`: content right 452 at 1440. The side pane takes 440 px and the list keeps its room. This is by design (v1.83.0).
- `/users/tasks/<id>` and `?task=` on phones: header → first block 0 (the task page's own sticky bar).
- The page header's bottom margin is 24 on 63 users pages, **20** on the Home overviews (`OverviewParts`) and **0** on the request detail. 28 users pages have no PageHeader (Home, Task Summary, project, portfolio, AI assistant, the phone screens).

**Proposed standard (tokens):**

| Token | Desktop ≥ 1024 | Tablet 768-1023 | Phone < 768 |
|---|---|---|---|
| `--header-h` | 64 | 64 | 56 (`--header-h-mobile`) in every area (today: 56 users, 64 panels) |
| `--page-px` (header and content) | 24 | 24 | 16 |
| `--page-pt` | 24 | 24 | 16 |
| `--sidebar-w` / `--sidebar-w-rail` | 250 (or 248) / 72 | **rail by default** (72) | none |
| content max-width | owner's choice (GLOBAL_DESIGN_SYSTEM C16 / Q-UI-2). Recommended: left-aligned, `--content-max` 1440 for data pages and 960 for forms and reading pages | full | full |
| `--section-gap` | 24 | 24 | 16 |
| PageHeader | h1 24 / 600; actions right; meta under the title; `mb` = section gap | same | h1 22 / 700; the primary action moves to the bottom bar or a FAB (phone layout) |
| Breadcrumb | detail, settings and hub child pages; above the h1; 12 / 16 muted | same | the back arrow in the phone top bar |

## 3. Screen templates

Every page is one of these templates. The column "today" names the pages measured or seen as off-template.

| Template | Structure | Used by | Today |
|---|---|---|---|
| **List** | Breadcrumb (none) · PageHeader (title, count meta, primary action "New …") · Tabs (ownership / status) · Toolbar (Filter, Sort, Group, Options, Search, Columns; chips) · DataTable / cards · Pagination | Requests, Tasks, Information, Meetings, Tickets, Projects, Admin Users, Admin Records, Super Admin logs | The toolbars differ by module: Requests has status cards + Filter / Sort / Group / Options / Search + Columns; Tasks has count tabs + Filter / Sort / Group / Options; Meetings has tabs + pill filters + Filter / Group / Search; Tickets has tabs + pills + Group + Search (no Filter / Sort); Projects has tabs + "Find a project…" input (no toolbar); Admin Records has PowerSearch "Add filter" + Sort / Group; the audit log has Filter / Group + native date inputs. The primary action labels differ: "New request", "New task", "New information", "Schedule a meeting", "Raise a ticket", "+ Create project", "Add user". |
| **Detail** | Breadcrumb · PageHeader (record title, number and meta, status badges, actions) · two columns ≥ 1024 (main 2/3, side 1/3: actions, people, timeline) · one column below | Request, task, information, meeting, ticket, project settings, admin user, calendar entry | Mostly on template. The "← Back to …" link is present on the request and admin user pages only. The status badge position varies (right of the title vs a badge row under it). Task title 28 px on phones vs 20 / 22 elsewhere. |
| **Form (create / edit)** | Breadcrumb · PageHeader · sections (cards, ≤ 7 fields each) · sticky action bar (primary right, Cancel left of it) | New request (steps), New task (dialog), New information, New meeting, New ticket, New project (wizard), Admin editors | Primary buttons are full width in some forms (`btn-primary` defaults to `w-full`: calendar entry "Save changes", meeting points "Approve and share points") and inline in others. |
| **Hub / settings** | PageHeader · SectionNav (left) or Tabs (top) · section | Admin Set-up (SectionNav), Admin Insights (HubTabs), Profile (ProfileTabs), Super Admin (sidebar groups) | Two hub patterns. Keep both: SectionNav for settings, Tabs for views. |
| **Dashboard / overview** | PageHeader (title, period picker, switcher) · KPI row · widget grid | Home overviews (approvals, tasks, meetings), Admin home, Super Admin health, Insights summary | Home h2 at 17 px (arbitrary) vs 14 / 16 / 20 elsewhere |
| **Workspace (full-bleed)** | PageHeader (compact) · view tabs · a full-width grid or board | Project (list / board / timeline / calendar), Task Summary | Uses the same `main` padding. Boards scroll inside. |
| **State** | Inside the shell: icon, title, words, next step | not found, no access, switched off, empty | Four not-found pages (root, users, admin, superadmin) and three no-access pages, each with its own markup |

## 4. Navigation inside the layout

This section covers layout only. Routing and permission checks belong to NAVIGATION-AUDIT (separate).
- **Sidebar active state:** NavIndicator (moving bar) + `aria-current="page"`.
- **Groups:** groups open on click, and the open groups are remembered (localStorage per area).
- **Hub tabs:** they wrap from 768 (H-04 fixed). At 375 they scroll with an edge fade.
- **Breadcrumb versus Back:** the breadcrumb names the list (OriginLink keeps its query, D-417). "← Back to …" appears only where the list was reached from another area (request page from Admin Records). Proposal: one `BackLink` placement (right of the breadcrumb) on every detail page, or none. Today only 2 page types show it.

## 5. Responsive standard

| Breakpoint (Tailwind) | Width | Shell | Content |
|---|---|---|---|
| base | < 640 | Phone. Users area: the phone layout (`ars_layout=mobile` below 768, set by `LayoutSync`): top bar 56, MobileTabBar, More. Panels: the desktop shell with the MobileNav sheet. | One column, padding 16, cards instead of tables (proposed: every list) |
| `sm` | ≥ 640 | Panels: header padding 24 | Padding 24 (proposed; today 32 from 640) |
| `md` | ≥ 768 | Sidebar shows (today expanded; **proposed rail**). Users desktop layout. BottomNav hidden from md. | Two columns where the template has them only from `lg` |
| `lg` | ≥ 1024 | Sidebar expanded by default; pane as a side panel (440) | Two-column detail |
| `xl` | ≥ 1280 | | |
| `2xl` | ≥ 1536 | | content max-width applies (owner decision) |

**Rules:**
1. **No page-level horizontal scroll at any width from 320 up.** Measured: 0 pages at all 9 viewports in Chromium. Reflow at 320 is in [RESPONSIVE_TEST_REPORT.md](RESPONSIVE_TEST_REPORT.md).
2. **Tables below 768 become cards, or scroll inside their card with a visible cue** (`.scroll-hint`).
   - Today Requests and Information switch to phone cards.
   - **Tasks, Meetings, Tickets and Admin lists keep a squeezed table** with narrow columns and inner scroll (screenshots in RESPONSIVE_TEST_REPORT).
3. **Touch targets:** 44 px on touch devices for every control (`pointer: coarse` rule, `globals.css:470`). At the touch viewports, `tb-btn` toolbar buttons measured **28 px**, and 20 px round task checks and avatars measured as buttons. WCAG 2.5.8 allows 24 px with spacing. The 44 px rule is the app's own (spec #5).
4. **Floating elements** (Pico Bot launcher, phone "+" FABs, the decision bar) keep clear of the page's own actions. The page bottom padding must equal the floating stack's height (it is 5.5 rem + safe area today).
5. **Resizing across 768 switches the users layout** (`LayoutSync` refreshes). An open pane or dialog must survive it (probe results in the defect report).
6. **Orientation:** no lock. Tablet portrait (768) and landscape (1024) use the desktop shell.
