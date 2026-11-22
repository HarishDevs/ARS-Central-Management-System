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

# Part 2: the other PM screens (v1.73.0, D-396)

Same rules as part 1 (structure, option sets and order from the spec; ARS looks; no third-party names, icons or copy). Spec sources: `12-modules/HOME_MODULE.md` (§3.1, §3.15, §4), `NAVIGATION_AND_SETTINGS.md` (§3.3-§3.6), `PORTFOLIOS_MODULE.md` (§3.1, §3.4, §3.5, §3.9-§3.13), `FORMS_MODULE.md` (§3.4-§3.5, §3.9), `PROJECTS_CUSTOMIZATION.md` (§2.2-§2.5), `PROJECTS_VIEWS.md` (§4, §6, §7, §8, §13.3), `02-ui/SCREEN_DESIGN_CATALOG.md` (S-02, S-04, S-10, S-14, S-18, S-19, O-01, O-10) and `11-design/COMPONENT_SPECS.md`. Every dropdown below is the part-1 menu (`features/ui/MenuCore.tsx`), with two additions: a radio or checkbox item can close the menu once chosen (`close: true`, for pickers), and a menu inside a transformed window (the centred Create task window) is placed from that window (a transformed ancestor is the containing block of `position: fixed`). Layers follow the v1.72.2 scale (`--z-popover`).

## 12. My Tasks (S-04; PV §2)

| # | Spec says | We had | Change |
|---|---|---|---|
| M1 | Header: avatar + `My tasks ▾` (actions) | Avatar, title, a "Morning summary email" checkbox and a "Table with filters" link in the toolbar row | Title with a **▾ actions menu**: Add task · Morning summary email (checkbox) · ─ · Table with filters · Calendar feed (when offered) · Print. The checkbox and link left the toolbar |
| M2 | Board cards and rows: name, check, project chips, field chip, due date, comment count | No comment count | Comment count (icon + number) on cards and rows |
| M3 | Rows have a details/actions affordance | None (only the name link) | **⋯ menu** per task: Open task details · Copy task link · Go to <project> |
| M4 | Tabs (user tabs, List, Board, Calendar, +) and the List toolbar | Same since v1.63.0 / v1.72.0 | Kept |
| M5 | The person's own sections | Fixed date sections (owner, v1.54.4: Task Summary) | Kept (owner's decision) |

## 13. Home (S-02; HOME §3.1, §3.15)

| # | Spec says | We had | Change |
|---|---|---|---|
| HM1 | Header row: `+ Add widgets` | Add widget only inside Customise, as a panel | **Add widgets** is always in the header: a dropdown of the widgets not on Home (name + one line), added at the end |
| HM2 | Widget chrome: "Actions" (⋯) top right: move, resize, remove | Move/resize/remove only in Customise | Each widget has an **Actions ⋯** menu: Move up · Move down · ─ · Half width · Full width (radio) · ─ · Remove widget |
| HM3 | Date line and greeting | Same (v1.63.0) | Kept |
| HM4 | Timeframe `My week ▾` | Period dropdown (Today, This week, This month, Last 30 days, Custom) | Kept (ARS's period set; already a dropdown) |
| HM5 | Customize mode: drag, keyboard move | Same (v1.63.0) | Kept |

## 14. Portfolios page and a portfolio (S-18, S-19; PORTFOLIOS §3.1, §3.4, §3.5, §3.9-§3.13)

| # | Spec says | We had | Change |
|---|---|---|---|
| PI1 | Cards (a "New portfolio" tile first), `View as list` | A list only | **Cards** by default (New portfolio tile, identity tile, name, star, items, status); **View as list / View as cards** (kept in the address, `?layout=list`) |
| PI2 | Card "Show options" menu | None | **⋯ options**: Open portfolio · Copy portfolio link · Add to / Remove from starred · Join portfolio (when they can join) |
| PI3 | Recent and starred / Browse all | My portfolios · All I can see · Archived · Deleted | Kept (ours covers both, plus archived and deleted) |
| PP1 | Actions: View portfolio details · Copy portfolio link · Duplicate · Set color · Add to portfolio · Export or sync ›; editor note; admin: Archive, Delete | Edit details or Set colour · Copy link · Archive · Leave · Delete | Spec order with our items: Edit portfolio details · Copy portfolio link · Set colour (current colour shown) · Export or sync › Print · ─ · Archive / Restore · Leave · Delete portfolio; editors see "Some actions are for the portfolio's owners only." |
| PP2 | Status menu with each status's mark | Plain items | Coloured dot per status; the current one says so |
| PP3 | Avatars = "Manage portfolio members" | Avatars only | The avatars are a button that opens Share |
| PP4 | Share, Customize | Plus an extra copy-link button | Extra button removed (Copy portfolio link stays in the actions) |
| PP5 | `[+ Add work ▾]`: More actions = Create new project / Create new portfolio | Add work only | ▾ beside Add work: Create new project · Create new portfolio |
| PP6 | Toolbar Filter · Sort · Group · Search as menus; quick filters; sort order Status, Owner, Start date, Due date, Alphabetical …; group Owner, Status … | Three labelled native selects, a direction button and a search box | **Filter** menu (Quick filters as radio items + Clear; "Filters: 1" when on) · **Sort** menu (None (order added) · Status · Owner · Due date · Alphabetical · Task progress · Priority, then Ascending/Descending and Clear sort) · **Group** menu (Owner · Status · Priority · Projects and portfolios + Clear) · **Search this view** icon |
| PP7 | Each column: "Show options for <column> column" | None | Column ▾: Sort ascending · Sort descending · Group by this column (Status, Owner, Priority); `aria-sort` on the sorted column |
| PP8 | Rows: name, status, progress, due, priority, owner | A trash button per row | **⋯ per row**: Open · Copy link · ─ · Remove from this portfolio (owners and editors) |
| — | Inline portfolio rename; Options panel (show/hide columns); `#` column | — | **Deferred** (rename: the details dialog does it; columns: portfolio's own fields only) |

## 15. Intake form builder and fill view (FORMS §3.4, §3.9)

| # | Spec says | We had | Change |
|---|---|---|---|
| F1 | Header bar: access notice + Change · star · View form · Share form · Copy link · More actions (Duplicate form) | Tabs only; View form and Unpublish in the footer | **Header bar**: "Who may submit: <audience>. Change" (opens Settings) · View form (published) · Share form (opens Share) · Copy link (published) · **More actions ⋯**: Duplicate form · Unpublish (published) · ─ · Delete form (asks first) |
| F2 | Footer: Discard or Delete form · Publish / Save | Status, problems, Save draft, Publish, View form, Unpublish | View form and Unpublish moved to the header bar |
| F3 | Fill view: "Email address" | "Email" | "Email address" (builder and fill view) |
| F4 | Tabs Questions / Settings; question cards; fill view layout | Same (v1.66.0) | Kept (the star is not offered: no starred forms in ARS) |

## 16. Project Dashboard and Workload (PV §7, §8; S-10, S-14)

| # | Spec says | We had | Change |
|---|---|---|---|
| D1 | Widget: View chart · Edit chart · More actions (duplicate, resize half/full, remove; reorder) | Move earlier/later · Make half/full width · Remove | **More actions**: View chart · Edit chart · Show as table (charts) · ─ · Duplicate · Size › (Half or Quarter width · Full width, radio) · Move earlier / later · ─ · Remove widget |
| D2 | Duplicate a widget | Not offered | **Duplicate** makes "<title> (copy)" at the end (counts towards the 20) |
| D3 | Add widget menu: Chart · Text; chart builder: title, Data source, Chart setup (style order Bar … Lollipop), Filters, annotations, Cancel · Save chart | Same (v1.67.0) | Kept |
| W1 | Toolbar: Add task · ‹ Today › · unit · Filter · Group · metric · Options | Earlier · Today · Later · two labelled selects · Set capacity | **Add task ▾** · ‹ Today › (Previous/Next period) · **unit dropdown** (Days (14) · Weeks (8)) · **measure dropdown** (Task count · estimates · number fields) · Set capacity |
| — | Workload Filter, Sort, Group, Options | — | **Deferred** (rows are the project's people by design) |

## 17. Automation builder (PC §2.3-§2.5)

| # | Spec says | We had | Change |
|---|---|---|---|
| A1 | "Choose trigger": a source menu (in the app · manual · scheduled · webhook) and the grouped catalogue | A native select with option groups | **Trigger dropdown**: "Something happens to a task ›" (Task moved · Task field is changed · Due date is… · Added to task · Forms, as headings with their triggers) · ─ · Run by hand · On a schedule · Web request received; picking closes it |
| A2 | "What happens next?": the action catalogue | "Add step" added a Move-to-section step, then a select changed it | **Add step ▾** lists the actions (Move task · Change status · Change task field · Create new · Add to task); the new step has the chosen action |
| A3 | A step's action | A native select | **Do this ▾** dropdown (the same groups, radio items) |
| A4 | Header: name · Draft · Cancel · Publish · Settings; Paths | Same shape (v1.68.0) | Kept |

## 18. Global Create menu and the sidebar (NAV §3.3-§3.6; O-01, O-10)

| # | Spec says | We had | Change |
|---|---|---|---|
| G1 | Create: Task · Project · … · Portfolio · … · Invite | Own menu code (↑/↓ only) | The shared dropdown (Home/End, letter jump, Escape back to + Create, Tab closes, placed against the window); order Approval request · Task · Project · Portfolio · ─ · Information |
| G2 | Section options ⋯: "Sort projects and portfolios" Alphabetical · Recent · Top (radio) | A details panel with three buttons (Manual, A–Z, Recently opened) | **⋯ options** menu: "Sort projects" A–Z · Recently opened · Manual (radio, stays open) |
| G3 | Team section "+": New project · New portfolio | None | **+** on the department section: New project · New portfolio (when portfolios are on) |
| G4 | Starred; manual order | Same (v1.62.0) | Kept |

## 19. Create task window (S-17 quick add; PV §13.3)

| # | Spec says | We had | Change |
|---|---|---|---|
| TC1 | Toolbar "+" menu | A list with menu roles but no keyboard moves | The shared dropdown (Add to a project · Set a due date · Repeat (periodic) · Attach a file · Add collaborators) |
| TC2 | Create split | One Create task button | **Create task ▾**: Create task (Ctrl+Enter) · **Create and add another** (the window stays, emptied, for the next one) |
| TC3 | Priority options | "High" listed twice | Listed once |

## 20. Part-1 deferrals

| # | Item | Change |
|---|---|---|
| H7 | Inline project title rename | **Done**: owners click the title (a button inside the heading); a text box; Enter or leaving saves, Escape puts it back. Server: `renameProjectAction` → `renameProject` (owners only, 2-150 characters, spaces tidied, history + audit, unchanged name = no write) |
| S1 | Timeline Sort / Group / Options | **Done**: Sort (Start date · Due date · Alphabetical), Group (Sections · None), Options (Expand all sections · Collapse all sections · Go to today); Gantt too |
| S2 | Calendar Filter / Options / Search | **Filter and Search done** (Incomplete · Completed · All tasks, Just my tasks; Search this view). Options **deferred** (the spec doesn't show its contents) |
| P2 | Task follow-up, merge, convert, duplicate | **Create follow-up task** and **Duplicate task** done (after Attach files): they open the Create task window filled from the task ("Follow-up: <name>" with a link back; or "<name> (copy)" with its description, priority and project); the person checks it and creates it. Merge and convert **deferred** (not ARS features) |
| L2 | Duplicate section | **Deferred**: a copy needs its tasks copied (with subtasks, fields and dependencies); not built here |
| V4 | Group order and subgroups | **Deferred**: the grid has one grouping level and no group order |

## 21. Counts (part 2)

| Screen | Changes | Kept | Deferred |
|---|---|---|---|
| My Tasks | 3 | 2 | 0 |
| Home | 2 | 3 | 0 |
| Portfolios page and portfolio | 10 | 1 | 3 (inline rename, Options panel, # column) |
| Form builder and fill view | 3 | 1 | 0 |
| Dashboard | 2 | 1 | 0 |
| Workload | 1 (toolbar: 4 controls) | 0 | 1 (Filter/Sort/Group/Options) |
| Automation builder | 3 | 1 | 0 |
| Create menu and sidebar | 3 | 1 | 0 |
| Create task window | 3 | 0 | 0 |
| Part-1 deferrals | 5 (rename, Timeline ×1 set, Calendar ×1 set, follow-up, duplicate) | 0 | 4 (Calendar Options, merge/convert, duplicate section, group order/subgroups) |
| **Total** | **35** | **10** | **9** |

## 22. Task side pane and dates (v1.75.0, D-399)

Owner's screenshots: the date picker ("use this kind so that from date to date can be captured") and the task side pane ("use this kind of layout for side bar"); spec `12-modules/DATE_RANGES.md`.

| # | Spec / screenshot | We had | Change |
|---|---|---|---|
| P1 | Bar: Mark complete left; avatars + "+", Share, divider, like, copy link, expand, ⋯, close (→\|) | Mark complete; people count; compact Share; like; copy; full page; ⋯; × | Avatars with +, Share with text, a divider, →\| close; bar sticky |
| P2 | Banner: lock + "private to members of this project" + Make public | Eye + who sees it, no Make public (D-368) | Lock + the sentence for a task in one private project; Make public for the project owner or IT (confirmed) |
| P3 | Large bold title, inline editable | 22 px semibold, read only | 22 px bold, editable where the name may change |
| P4 | Field rows: Assignee, Due date, Dependencies | Facts in the Details card; start date in Planning and people | Label/value rows in the pane and the Details card; the date row opens the picker (start – due, ×) |
| P5 | Projects: count, +, collapsible project with section and field rows, Show N more | Projects card with selects and fields inline | Count badge, + (focuses Add to a project), ▾ groups, field rows with type icons, five then Show N more |
| P6 | Comment box pinned at the bottom (+, emoji, @, AI, send) | Composer inside the Comments tab | Pinned rounded box: editor (emoji, @ in its toolbar), + attach, round send; Pico Bot not offered (it only drafts descriptions) |
| D1 | Date picker anatomy §2 | Native date inputs | Shared picker: Start/Due boxes, Monday-first grid, band, weekend tint, clock, repeat, Clear |
| D2 | Display formats §3 | "1 Dec" or ISO in inputs | `formatDayRange` (day-first): Today/Tomorrow/weekday, "30 Nov – 4 Dec", "7 – 11 Dec", years when needed |
| D3 | Filters is between / is not between §6 | Due quick values only | Due date and Start date windows in the list filters |
