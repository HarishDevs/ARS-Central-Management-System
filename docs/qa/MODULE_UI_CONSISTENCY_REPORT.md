# Module UI consistency report (UI/UX QA, phase 1)

**Date:** 24 Nov 2026. **Build:** v1.88.0. **Method:**
- the measured sweep (Chromium, light) at **1440×900**, the same viewport for every module, with the other viewports where they differ;
- screenshot review (`audit/ui-qa/shots/chromium/<vp>/`);
- static scans.

Defect IDs refer to [UI_UX_DEFECT_REPORT.md](UI_UX_DEFECT_REPORT.md).

## Status after v1.89.0 stage 3b (D-422, batch 2: shared components)

| Area (§3 ID) | Now | Left for batch 3 (module pages) |
|---|---|---|
| List toolbar (CON-01) | One `ListPage` order (PageHeader → tabs → `ListToolbar` → list). Projects moved onto it (no own search box); Meetings' tabs and Tickets' status pills lead the toolbar row; Requests, Tasks (list), Information, Admin users, the Super Admin logs already used ListToolbar. | Portfolios (own search box), Admin Records (PowerSearch + toolbar), the audit log's native From / To dates, Insights / dashboards pages, wrapping every list page in `ListPage`. |
| Section heading size (CON-02) | `text-section` 18 on page sections (Home overviews, Meetings home, Admin editors, Profile, Calendar, dialogs, phone sheets, journey). | Card titles stay 14 (by design). |
| Page title (CON-03, CON-04) | New project and AI Assistant on the page-title token; phone titles 22 / 700 everywhere; phone Home titled. | Detail pages' badge / back placement (CON-11, CON-12), Home overview header (CON-15). |
| Input / button heights (CON-05, CON-06) | Every page on the tokens (no `h-*` beside a control; lint). | — |
| Primary action wording (CON-07) | unchanged | "New …" wording, the icon instead of "+" (batch 3). |
| Box radius (CON-09) | unchanged | batch 3. |
| Record numbers (CON-10) | unchanged | `RecordNo` cell (batch 3 / 5). |
| Full-width buttons (CON-13) | Buttons size to their words; `btn-block` for sign-in. | — |
| Phone lists (CON-14) | Cards below 768 for DataTable, RecordTable, Tasks, Meetings, Tickets and the Super Admin logs. | The remaining admin / superadmin tables (Insights dashboards, set-up type lists, budgets, backup, retention, Google, WhatsApp templates, jobs, page access): add `data-label` and `.table-cards` per table. |
| Avatars (CON-17) | One `Avatar`. | — |
| Overlays (CON-18) | Shared dialog title / × / padding; radius tokens. | The raw `<dialog>`s → `Dialog` (motion / close path), Popover variants. |


## 1. Verdict

**The shell is one product:**
- header 64 / 24;
- sidebar 220;
- content padding 32;
- top 40;
- the same left edge and max-width on **every** page of Users, Admin and Super Admin at each desktop viewport (SCREEN_LAYOUT_STANDARD §2).

These values differ from the owner's reference dimensions (conflicts C1-C16 in GLOBAL_DESIGN_SYSTEM). They do not differ between modules.

**Inside the pages, the modules do not yet look like one product.** The differences are in:
- the list toolbars;
- the primary-action wording;
- section headings;
- form-control heights;
- the phone list pattern;
- date formats;
- the not-found and empty pages;
- the AI module's page structure;
- the overlay surfaces.

## 2. Matrix at 1440×900 (measured)

**Cells:**
- the value × the number of elements, summed over the module's pages;
- **h1** = the page title size / weight;
- **h2** = section heading sizes;
- **Input / select** = `field-input` heights;
- **BC** = pages with a breadcrumb.

| Module (pages) | h1 | h2 sizes | btn-primary | btn-compact | tb-btn | Input `field-input` | Select `field-input` | Card radius | BC | PageHeader |
|---|---|---|---|---|---|---|---|---|---|---|
| Home overviews (7) | 20 / 600 | **17** ×46, 14 ×6 | — | 36 | — | — | **36** | 12 | 0 / 7 | 3 / 7 (own header `OverviewParts`) |
| Approvals (15) | 20 / 600 | 14 ×24, **19** ×2 (journey), 18 ×1 | 46 | 36, 44, 46 | 28 | 44 | — | 12 | 2 / 15 | 15 / 15 |
| Tasks / Work (15) | 20 / 600 | 14 ×39, **17** ×7 | — | 36, 46 | 28 | 44, **36** | **32**, 36 | 12 | 1 / 15 | 10 / 15 |
| Projects / PM (11) | 20 / 600, **32 / 600** (New project) | 14 | 46 | 36, 46 | 28 | **32** ×7, 44, 36 | 44, 32, 36, **40** | 12, 16 | 5 / 11 | 6 / 11 |
| Forms (2) | 20 / 600 | 14 | — | 36 | 28 | **32**, 44 | — | 12 | 1 / 2 | 1 / 2 |
| Information (6) | 20 / 600 | 14 | — | 36 | 28 | — | — | 12 | 1 / 6 | 6 / 6 |
| Meetings (7) | 20 / 600 | **17** ×15, 14 | 46 | 36 | 28 | 44 | 44, 36 | 12 | 2 / 7 | 5 / 7 |
| Tickets (8) | 20 / 600 | 14 | — | 36 | 28 | **36**, 44 | 36 | 12 | 3 / 8 | 8 / 8 |
| AI (7 → 1 page) | **14 / 400 sr-only** | none | — | 36 | — | — | — | — | 0 | **0** |
| Calendar (2) | 20 / 600 | 14, **20** | 46 (full width) | 36 | — | 44 | — | 12 | 1 / 2 | 2 / 2 |
| Analytics (3) | 20 / 600 | 14 | — | 36 | 28 | — | 36 | 12 | 0 | 3 / 3 |
| User / general (13) | 20 / 600 | 14, **17**, **20** | — | 36, 44 | 28 | **28**, 36, 44 | 36 | 12 | 0 / 13 | 9 / 13 |
| Admin (46) | 20 / 600 | 14 ×64, **20** ×6 (type editors), **16** ×4 (home) | 46 | 36, 44 | 28 | 44, **36** ×9, 32 | 44, **36** ×11 | 12 | 5 / 46 | 45 / 46 |
| Super Admin (27) | 20 / 600 | 14, 16 | 46 | 36, 46, **32**, **40**, 44 | 28 | 44 | **36** ×61, 44 ×43 | 12 | 2 / 27 | 27 / 27 |
| Public (8) | **44 / 700** (landing), **32 / 700** (auth), 20 / 600 (Privacy, Terms) | 22, 52 | 46 | — | — | 44 | — | — | 0 | 0 |

**What the matrix shows:**
- **h1 is consistent at 20 / 600** in every app module except AI and New project. AI's only h1 is sr-only; there is no visible page title (UIQA-CON-04). New project shows 32 (UIQA-CON-03). On **phones**, four sizes are in use: 20 / 600, **22 / 800** (`.mob-screen-title`: Information, Approvals inbox, Tasks, Notifications), **28 / 600** (task detail) and none (Home, the tasks and meetings overviews). See UIQA-RESP-04.
- **Section headings (h2) use 14 / 16 / 17 / 18 / 19 / 20 px.** 17 is an arbitrary `text-[calc(17px*…)]` on Home and Meetings (`ApprovalOverview.tsx:209,244`, `MyWorkOverview.tsx:238,263`, `HomeNotepad.tsx:52`). 20 is the Admin type editors, Calendar and Profile. UIQA-CON-02.
- **The same `field-input` class renders at 28, 32, 36, 40 and 44 px** depending on the module, because pages add their own `h-*`. Tasks, Projects, Forms, Tickets, Admin Set-up, Super Admin selects and Notifications settings do this. UIQA-CON-05.
- **btn-compact shows 32, 36, 40, 44 and 46 at desktop width** in Super Admin, Approvals, Tasks and Projects (pages adding `h-*` or `min-h`). UIQA-CON-06.
- **Card radius is 12 everywhere** (with one 16). Bordered boxes at 16 px are the request detail side panels, the task pane, board columns and the custom request steps (UIQA-CON-09, P4).

## 3. Findings by area of consistency

| ID | Area | Inconsistency (evidence) | Modules | Severity |
|---|---|---|---|---|
| UIQA-CON-01 | **List toolbar** | Seven different list headers. **Requests:** status cards + Filter / Sort / Group / Options / Search + Columns. **Tasks:** count tabs + Filter / Sort / Group / Options. **Information:** tabs + Filter / Sort / Group / Options / Search. **Meetings:** tabs + pill filters + Filter / Group / Search (no Sort). **Tickets:** tabs + pills + Group + Search (no Filter, no Sort). **Projects:** tabs + a "Find a project…" input (no toolbar). **Admin Records:** PowerSearch "No filters / + Add filter" + Sort / Group. **Audit log:** Filter / Group + native From / To date inputs. Screenshots: `shots/chromium/1440x900/user__users_{requests,tasks,information,meetings,tickets,work_projects}.jpg`, `admin__admin_records_requests.jpg`, `super__superadmin_monitoring_audit.jpg`. | All lists | P2 |
| UIQA-CON-02 | Section heading size | h2 at 14 / 16 / 17 / 18 / 19 / 20 (§2) | Home, Meetings, Approvals, Admin, Calendar, Profile | P3 |
| UIQA-CON-03 | Page title | New project h1 32 px (`NewProjectWizard`); the rest 20 | Projects | P3 |
| UIQA-CON-04 | Page structure (AI) | `/users/ai/*` all land on `/users/ai/assistant`. The h1 is sr-only ("AI Assistant"). There is no PageHeader, no breadcrumb and no visible title. The page is a chat surface. | AI | P2 |
| UIQA-CON-05 | Input heights | `field-input` at 28 / 32 / 36 / 40 / 44 by page (§2) | Tasks, Projects, Forms, Tickets, Admin, Super Admin, Profile | P2 |
| UIQA-CON-06 | Button heights | `btn-compact` at 32 / 36 / 40 / 44 / 46 on desktop. Primary and secondary are full height (46) beside compact (36) buttons in the same headers. Toolbar buttons are 28. | All | P2 |
| UIQA-CON-07 | Primary action wording | "New request", "New task", "New information", "Schedule a meeting", "Raise a ticket", "+ Create project" (the only one with "+" in the text), "Add user" | All lists | P3 |
| UIQA-CON-08 | Date formats | Meetings list: "Tue, 24 Nov, 2026, 11:48 pm to 12:48 am" (weekday, a comma after the month). Requests, Tasks and Information: "23 Nov 2026, 11:48 pm". Tasks: relative ("Yesterday", "21 Nov" with no year) in the summary. Native date inputs show "24-11-2026" (calendar entry, the audit log, Search filters) in the browser's locale format. Calendar times are 24 h ("13:00") against 12 h elsewhere. | Meetings, Tasks, Calendar, Super Admin | P3 |
| UIQA-CON-09 | Box radius | Bordered boxes at 0 / 8 / 12 / 16. 16 is used by the request side panels, task pane, board columns and request steps (`rounded-xl`, 34 uses). | Approvals, Tasks, Projects | P4 |
| UIQA-CON-10 | Record numbers | Ticket and meeting numbers are monospace links (`UIQA-…`, `MTG-…`). Request numbers (`CUS-2026-000002`) are plain text. Task numbers are muted plain. | Tickets, Meetings vs Approvals, Tasks | P4 |
| UIQA-CON-11 | Back link | "← Back to My pending requests" (request) and "← All users" (admin user) appear in the page header. No other detail page has one (task, information, meeting, ticket, calendar entry). | Detail pages | P3 |
| UIQA-CON-12 | Status badge placement | Request: a badge right of the title row. Task: a row of 4 badges right of the actions (Open, Normal, Overdue, Ad hoc). Information: badges at the far right. Meeting: "Scheduled" + "Points: Draft" at the far right. Ticket: "Normal" + "New". The status colours share `status-tones.ts`. | Detail pages | P4 |
| UIQA-CON-13 | Full-width buttons | `btn-primary` defaults to `w-full` (`globals.css:349`). The calendar entry's "Save changes" and the meeting's "Approve and share points" span the form; other forms have inline buttons. | Calendar, Meetings vs the rest | P3 |
| UIQA-CON-14 | Phone list pattern | Approvals and Information use phone cards. Tasks, Meetings, Tickets, Projects, Admin and Super Admin show the desktop table squeezed into the width (inner scroll, 2-3 visible columns). Screenshots: `shots/chromium/390x844/user__users_{tasks,meetings,tickets}.jpg`, `admin__admin_users.jpg`. | Tasks, Meetings, Tickets, Admin | P2 |
| UIQA-CON-15 | Page header on Home | The overviews use `OverviewParts` (`mb` 20, a switcher, a period picker), not PageHeader (`mb` 24). This is by design (D-416 / H-01). It is listed so the PageHeader slots cover it. | Home | P4 |
| UIQA-CON-16 | Not-found pages | The four `not-found.tsx` files and the no-access pages each have their own markup (results in UI_UX_DEFECT_REPORT §states). | All areas | P3 |
| UIQA-CON-17 | Avatars | Two Avatar components plus 4 hand-made 24 px initials circles at 10 px text (`RequestListScreen.tsx:219`, `PeoplePicker.tsx:113`, `GridCellEditors.tsx:68`, `ProjectWorkspace.tsx:949`) | Approvals, Projects, pickers | P4 |
| UIQA-CON-18 | Overlays | Dialog, palette, bell, account menu, + Create, pane and picker: radius, shadow and motion differ (probe results in UI_UX_DEFECT_REPORT §overlays) | All | P3 |

## 4. Same viewport, same role, different module: shell-level comparison

**Checked at every desktop viewport, measured equal across all modules:**
- header height and padding;
- sidebar width (expanded and rail);
- main padding (x, top);
- max-width;
- content left / right;
- the gap from the header to the first block.

**Differences that are by design:**
- the overviews' header;
- the `?task=` side pane narrowing the list;
- the users phone layout against the panels' phone shell.

The panels' phone shell differs from the users phone layout:

| | Users phone layout | Panels on phones |
|---|---|---|
| Header | 56 / 12 | 64 / 16 |
| Top padding | 16 | 24 |
| Menu | tab bar | MobileNav sheet |
| h1 | 22 / 800 or 20 / 600 | 20 / 600 |

That makes two phone shells (UIQA-RESP-03).

## 5. Recommendations (feed the fix batches)

1. A **ListPage** pattern: PageHeader (title, count meta, one "New …" action) + `Tabs` + `ListToolbar` (Filter, Sort, Group, Options, Search, Columns; chips) + `DataTable` + `Pagination`. Migrate Meetings, Tickets, Projects and Admin Records to it. PowerSearch stays as the Filter panel's advanced mode.
2. **Heights from tokens only.** Remove the per-page `h-8` / `h-9` / `h-10` on `field-input` and `btn-compact` (grep list in the defect report), and set the tokens once.
3. `text-section` (18) for every page section h2; card titles 14 / 600.
4. **Dates:** one `formatDate` / `formatDateTime` family (already in `lib`): "24 Nov 2026" and "24 Nov 2026, 11:48 pm". Ranges: "24 Nov 2026, 11:48 pm – 12:48 am". Relative dates only for "today / yesterday / in N days" with the absolute date on hover. Replace native date inputs with DateRangePicker.
5. Phone lists: a `cards` rendering of `DataTable` below 768 for every list.
6. AI: a visible PageHeader ("AI Assistant") above the chat, like the other modules. The chat stays full height below it.
