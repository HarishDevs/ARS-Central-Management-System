# Layout parity audit: project screens (v1.72.0, D-387)

Owner, 22 Nov 2026: "use the skeleton and layout design and options design of [the reference] in the project management wherever it is not matching with. and use dropdowns wherever required".

Read-and-compare audit of the **project screens** against the spec package (`D:\REA\Asana\asana-reverse-engineering\docs`): `12-modules/PROJECTS_MODULE.md` (§3.6 header, §3.7 tabs, §3.8 toolbar, §3.9 sections, §3.10 actions menu, §3.11 settings, §3.20 export, §3.22 status), `PROJECTS_VIEWS.md` (§2 List, §3 Board, §4 Timeline, §5 Gantt, §6 Calendar, §13 task pane), `PROJECTS_CUSTOMIZATION.md` (§1 Customize panel), `02-ui/SCREEN_DESIGN_CATALOG.md` (S-06..S-17), `11-design/COMPONENT_SPECS.md` (§2-§8) and the wireframe prototype. Screenshots of our screens before the change (light, 1440 × 900 and 390 × 844) were taken with a throw-away Playwright script into `test-results/layout-audit/before/` (not committed) and compared with the wireframes; the same script wrote `after/` once the changes were in.

Rules kept: structure, option sets and order follow the spec; looks stay ARS tokens (colours, type, lucide icons); no third-party names, icons, illustrations or CSS; every function, permission and test id kept where possible; phones keep working.

**One menu component.** Every "▾" and "⋯" below now uses `features/ui/MenuCore.tsx` (exported as `Menu`): a button with `aria-haspopup="menu"` and `aria-expanded`, a `role="menu"` list placed against the window (`position: fixed`, so tables and the task pane never clip it), ↓/↑ wrapping, Home/End, letter typeahead, Enter/Space, → opens a submenu and ←/Escape closes it, Escape closes and returns focus to the button, Tab closes. Radio and checkbox entries (`menuitemradio`/`menuitemcheckbox` with `aria-checked`) keep the menu open. Popovers with free content (Filter, Group, Options, Customize) stay panels. Escape in a `Drop` panel now also returns focus to its button.

Legend: **Change** = what v1.72.0 does. **Kept** = already matches. **Deferred** = not done here, with the reason.

## 1. Project header (PM §3.6, §3.10, §3.22; S-06)

| # | Spec says | We had | Change |
|---|---|---|---|
| H1 | Identity tile opens "Set color & icon" | Tile with initials, not clickable | Tile is a link "Change colour of <project>" to settings › Project details (owners); plain tile for others |
| H2 | Title, then ▾ actions, ☆ star, ○ status pill | Same order | Kept |
| H3 | Actions menu order: Edit project settings · Manage project permissions · Set color & icon · Copy project link · Duplicate · Save as template · Add to portfolio · Create table · Import › · Export or sync › · Archive · Delete project | Edit project settings · Manage members · Copy project link · Duplicate · Save as template · Archive or delete | Spec order with our items: Edit project settings · Manage project permissions · Set colour · Copy project link · Duplicate · Save as template · Add to portfolio (portfolios on) · Import › (CSV or Excel) · Export or sync › (CSV, Excel, JSON, time entries CSV, calendar feed, Print) · Archive / Unarchive · Delete project (danger). Import/Export only with "pm_extras"; owner-only items hidden from others |
| H4 | Status menu: On track · At risk · Off track · On hold · Complete · Dropped | Same six, no colour cue in the menu | Each item shows its coloured dot (icon) |
| H5 | Member stack = button "Manage project members"; Add members | Avatars only (not interactive) | Avatars are a link "Manage project members" to settings › Members |
| H6 | Share, then Customize opens a right-hand panel | Share; Customize was a link to settings › Fields; plus an extra copy-link button | Customize opens the **Customize panel** (§7); the extra copy-link button is gone (Copy project link stays in the ▾ menu) |
| H7 | Inline title rename for admins | Rename in settings | **Deferred**: the details form saves every field with a row version; an inline title box needs its own action (part 2) |

## 2. Tabs strip (PM §3.7; CMP-09)

| # | Spec says | We had | Change |
|---|---|---|---|
| T1 | Tab menu: Rename · Set as default (disabled when default) · Make a copy · Copy link · Remove | Rename · Set as default (hidden when default) · Duplicate · Copy link · Move left · Move right · Remove, as a details panel with plain buttons | ARIA menu in spec order: Rename · Set as default (shown **disabled** when it is the default) · Make a copy · Copy link · ─ · Move left · Move right (our keyboard extra) · ─ · Remove (danger) |
| T2 | Add-tab catalogue grouped **Popular** (List, Page, Gantt, Board, Calendar, Timeline) and **Other** (Workload, Dashboard, Files, Messages …), icon + name + one line | One flat list in build order | ARIA menu with the two groups in spec order, a lucide icon per view, the description under the name; Overview listed under Other |
| T3 | Selected tab = 2 px brand underline; "+" last | Same | Kept |

## 3. View toolbar (PM §3.8; PV §2-§3; CMP-10)

| # | Spec says | We had | Change |
|---|---|---|---|
| V1 | `[＋ Add task │▾]` split button; ▾ = Task · Milestone · Section | List: caret with only "Add section"; Board: a plain "Add task" button that focused the quick-add box | Both: split button; ▾ menu **Task · Milestone · Section** (Approval left out, D-001). Milestone opens the Create task dialog as "Create milestone" (the new task is marked a milestone) |
| V2 | Filter popover: Clear · Quick filters · Add filter; count badge | List: matches. Board: details panel with checkboxes | Board uses the same popover shape (Quick filters as pressed chips, field filters, Clear) |
| V3 | Sort **menu**: Start date · Due date · Assignee · Created by · Created on · Last modified on · Completed on · Likes · Alphabetical · custom fields · Project; "Sorts: 1" + Clear sort | List: radio list in our order (Due first); Board: two native selects (sort, order) in the toolbar | List and Board: ARIA menu of `menuitemradio` in spec order (None first), custom fields after the built-in fields, then Ascending/Descending and **Clear sort**; the button reads "Sort: <name>" |
| V4 | Group popover: `[Sections ▾] [Custom order ▾]`, Add subgroup, Clear | List: a long radio list; Board: a "Columns" select in the toolbar | Popover with a **Group by** dropdown (Sections, built-in fields, custom fields), Expand/Collapse all groups and **Clear**; Board: the same popover, "Columns by" dropdown (Sections or a field). Order dropdown and subgroups **deferred** (the grid has no group order or second level) |
| V5 | Options panel: rows View name · Show/hide columns (n hidden) › · Filters › · Sorts › · Groups › · Subtasks › | One long panel of checkboxes and buttons | Options panel with rows in spec order, each opening its own page with ← Back: **Show/hide columns (n hidden)**, Filters (count) and Sorts and Groups (open their toolbar menus), **Subtasks**, **Rows** (density), then Save as a new tab. Board: Options with Sorts/Groups/Filters rows |
| V6 | Search this view (icon that opens a box) | List: matches; Board: always-open box | Board: the same search icon |
| V7 | Order: Add task left; Filter Sort Group Options Search right | Board: Filter, Columns, Sort, Order, Group, Search | Spec order on both |

## 4. List (PV §2; PM §3.9; COMPONENT_SPECS §3)

| # | Spec says | We had | Change |
|---|---|---|---|
| L1 | Section row: ▾ caret · name · **＋** (add task to this section) · **⋯** | Caret · name box · count · a trash button · (⋯ view menu on phase-A tabs) | Caret · name · count · **＋ Add task to <section>** · **⋯** (one menu) |
| L2 | Section ⋯ order: Add automation to section · Rename section · Add section · Duplicate section · Expand or collapse subtasks · Expand or collapse groups · Hide all empty groups · Delete section (danger) | Hide empty groups (checkbox), Expand/Collapse all subtasks, Expand/Collapse all groups; delete was a separate trash button with an inline form; rename by clicking the name | ARIA menu in spec order: Add automation to section (automations on) · Rename section · Add section · Expand all subtasks · Collapse all subtasks · Expand all groups · Collapse all groups · Hide empty groups (checkbox) · ─ · Delete section (danger, disabled for the last section; opens the existing "move its tasks to" confirm). **Duplicate section deferred** (no server action yet) |
| L3 | Column header menu per column | Field columns: details panel with buttons | ARIA menu (Sort ascending · Sort descending · Filter by this field · Group by this field · Hide column · Edit field) |
| L4 | `Add task` row at the end of each section; `＋ Add section` at the end | Same | Kept |

## 5. Board (PV §3; COMPONENT_SPECS §4; S-08)

| # | Spec says | We had | Change |
|---|---|---|---|
| B1 | Toolbar same as List | Native selects | See §3 |
| B2 | Column header: name (bold) + count + **actions menu** | Name box + count + trash button | Name + count + **⋯** with Add automation to section · Rename section · Add section · ─ · Delete section |
| B3 | Card: title with check; field chips; footer avatar · due date · comment count right-aligned | Title; field chips; footer avatar + name · due · priority pill · badges | Priority pill joins the chips row; footer: avatar + name · due date · comment count (right) · badges |
| B4 | Ghost "＋ Add task" in columns; ghost "＋ Add section" after the last column | Same | Kept |

## 6. Timeline, Gantt and Calendar toolbars (PV §4-§6; S-09, S-11, S-12)

| # | Spec says | We had | Change |
|---|---|---|---|
| S1 | Timeline/Gantt: Add task ▾ · Previous period · Today · Next period · **unit listbox** · Zoom out · Zoom in · Filter · (Sort, Group, Options) | ‹ Today › · "Scale" native select · − ＋ · help text | Add task split (Task · Milestone) · ‹ Today › ("Previous period"/"Next period") · **unit dropdown** (menuitemradio Days · Weeks · Months · Quarters) · − ＋ · **Filter** dropdown (Incomplete tasks · Completed tasks · All tasks, and Just my tasks). Sort/Group/Options on Timeline **deferred** (rows follow sections by design) |
| S2 | Calendar: Add task ▾ · ‹ Today › · month label · **unit menu** (Weeks · Months) · Filter · Options · Search | ‹ title › Today · No start date · Weeks/Months segmented links | Add task · ‹ Today › · month or week label · **unit dropdown** (Weeks · Months; links) · No start date. Calendar Filter/Options/Search **deferred** |

## 7. Customize panel and project settings (PC §1, §8.2; PM §3.11)

| # | Spec says | We had | Change |
|---|---|---|---|
| C1 | Header **Customize** opens a ≈ 360 px right panel: "This project", **＋ Add** menu, rows Automations (n) › · Fields (n) › · Forms (n) ›, close returns focus | A link to settings › Fields | New **Customize panel** (non-modal dialog, Escape/✕ return focus to the button): ＋ Add menu (Field · Form · Automation), rows Automations · Fields · Forms with counts (shown when > 0) going to their settings sections, and "Project settings". Task types, Emails, Apps, Bundles, Status templates are not ARS features (not listed) |
| C2 | Project settings in tabs: Project details · Dependencies · Scheduling · Notifications | One long two-column page of cards | One column in spec order (Project details · Dependencies · Scheduling · Members · Permissions · Fields · Forms · Automations · Duplicate and templates · Import and export · Calendar feed · Archive or delete · History) with a **section navigation**: a sticky side list on wide screens and a "Jump to" **dropdown** on phones. Notifications: per-member settings live in Share (D-220); Slack/Teams not used |

## 8. Task pane (PV §13; S-17; COMPONENT_SPECS §6)

| # | Spec says | We had | Change |
|---|---|---|---|
| P1 | Bar: Mark complete · collaborators · Share · like · copy link · full screen · ⋯ · close | Same | Kept |
| P2 | ⋯ order: Add to another project · Add subtask · Add tags · Attach files · Create follow-up task · Merge duplicate · Convert to · Duplicate task · Print · Make public · Delete task | Copy task link · Open full page · Run automations · Delete (a details panel with an inline confirm) | ARIA menu in spec order with our actions: Add to another project · Add subtask · Add tags · Attach files · ─ · Copy task link · Open full page · Print · (Run automation ›) · ─ · Delete task (danger, confirm dialog). Follow-up/merge/convert/duplicate task **deferred** (not ARS features yet) |
| P3 | Activity: Comments / All activity, **"Oldest ▾" sort options** | A toggle button Oldest/Newest | A dropdown "Oldest first ▾" with Oldest first · Newest first (menuitemradio) |
| P4 | Field rows: Assignee · Due date · Dependencies · Projects (section dropdown per project, fields) · Description · Subtasks | Same blocks (v1.62.0) | Kept |

## 9. Loading skeletons (COMPONENT_SPECS §8; PV §2.5)

| # | Spec says | We had | Change |
|---|---|---|---|
| K1 | Skeletons shaped like the final content (grid rows, board cards); shimmer, static under reduced motion | Only the top progress bar while a project loaded | `ProjectSkeleton` (header row, tabs strip, toolbar, column header, section headings and rows) and `ProjectSettingsSkeleton` (section list and cards) in `features/ui/Skeleton.tsx`, laid over `<main>` by `NavigationProgress` on the way to a project or its settings. **Not** route `loading.tsx` files and **not** an in-page Suspense boundary: both hit KNOWN_ISSUES V6-D06 (a later `notFound()` becomes 200; the page misses its refresh after an action; reproduced here with Suspense: the List missed the second quick-added task). `.skeleton` stops under `prefers-reduced-motion` |

## 10. Counts

| Screen | Changes | Kept | Deferred |
|---|---|---|---|
| Project header | 5 | 1 | 1 |
| Tabs strip | 2 | 1 | 0 |
| View toolbar | 7 | 0 | 2 (group order, subgroups) |
| List | 3 | 1 | 1 (duplicate section) |
| Board | 3 | 1 | 0 |
| Timeline / Gantt / Calendar | 2 | 0 | 2 (Timeline sort/group/options; Calendar filter/options/search) |
| Customize and settings | 2 | 0 | 0 |
| Task pane | 2 | 2 | 1 (follow-up, merge, convert, duplicate task) |
| Skeletons | 1 | 0 | 0 |
| **Total** | **27** | **6** | **7** |

## 11. Left for part 2

My Tasks (its own toolbar shares the List toolbar, so it picks up §3 already, but its header and sections), Home, portfolios, the forms builder, dashboards, the automations builder, the global Create menu and the sidebar; inline title rename (H7).
