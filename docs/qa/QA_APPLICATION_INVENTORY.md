# QA application inventory (UI/UX QA, phase 1)

**Date:** 24 Nov 2026. **Build:** v1.88.0 (`893fb4b`, origin/main), worktree `qa-ui`. **Status:** discovery only. Nothing in the app was changed.

Navigation, routing and RBAC correctness are covered by **NAVIGATION-AUDIT (separate)**. This inventory lists routes and roles only so the UI sweep can cover them.

## 1. Counts

| Item | Count | Source |
|---|---|---|
| `page.tsx` files (pages) | **161** | `find app -name page.tsx` |
| Page routes | 159 distinct, plus 2 `@pane` slot pages | the table in §9 |
| Pages swept by the audit | **154 of 161**, plus query-string variants (`?home=tasks`, `?home=meetings`, `?task=`, `?view=board`, search `?q=`). That gives 177 role × route pairs. | `audit/ui-qa/geometry.json` |
| Not swept | 7 (see §5) | |
| Layouts | 7 | `app/layout.tsx`, `app/users/layout.tsx`, `app/users/work/layout.tsx`, `app/admin/layout.tsx`, `app/admin/setup/layout.tsx`, `app/admin/insights/layout.tsx`, `app/superadmin/layout.tsx` |
| Parallel routes | 1 slot: `app/users/@pane` (`default.tsx`, `page.tsx`, `[...rest]/page.tsx`). It is the `?task=` pane (v1.83.0, D-410). | |
| Route groups | `(public)`, `(home)`, `(list)`, `(main)`, `(summary)` | |
| `loading.tsx` | 17 | Admin Insights / Records / Users / DoA; Super Admin logs; Users help / new / profile |
| `error.tsx` | 4, plus `global-error.tsx` | root, users, admin, superadmin |
| `not-found.tsx` | 4 | root, users, admin, superadmin |
| API route handlers (`route.ts`) | 67, in 21 groups: admin, ai, analytics, attachments, auth, backup-transfer, calendar, exports, files, forms, health, integrations, jobs, me, push, reports, requests, superadmin, users, webhooks, work | not swept (no UI) |

## 2. Areas, roles and people

| Area | Who (server check: `server/authorization/policy.ts:6-10`, `requireArea`) | Shell |
|---|---|---|
| Public | Anyone | Own layouts: the landing / auth split screen (`AuthLayout`) and the Privacy / Terms header |
| `/users` | `USER`, `IT_ADMIN`, `SUPER_ADMIN` | `AppShell area="users"`. It has the sidebar, top bar, + Create, and BottomNav (below 768 on the desktop layout). It also has two variants: the **phone layout** (below 768 with the `ars_layout=mobile` cookie: phone top bar, MobileTabBar) and the **Classic view** (a per-person setting, D-210). |
| `/admin` | `IT_ADMIN`, `SUPER_ADMIN` | `AppShell area="admin"` (panel: Search settings, Back to the app); MobileNav below md |
| `/superadmin` | `SUPER_ADMIN` | `AppShell area="superadmin"` (panel) |

**Roles** (`database/seeds/001_roles.sql`):
- `SUPER_ADMIN`, `IT_ADMIN`, `USER`;
- `EXPORTER` ("Can export"), which changes download permission only, not layout.

**What a USER sees also depends on:**
- the **modules** (`users.module_access`): APPROVAL, TASK, PROJECT, INFORMATION, MEETING, TICKET, AI. The default is APPROVAL and TASK (D-307).
- the **feature switches** (`server/settings/features.ts`);
- **page access** (Super Admin → Page access).

**People used:**

| Login | Role | Name |
|---|---|---|
| `E2E_REQ` | USER, requester | Ravi |
| `E2E_MGR` | USER, manager / approver, ticket coordinator | Manoj |
| `E2E_STAFF` | USER, no records | Sita |
| `E2E_ADMIN` | USER + IT_ADMIN | Elena |
| `E2E_SUPER` | USER + IT_ADMIN + SUPER_ADMIN | Sam |

All modules were granted for the audit.

## 3. Modules and their navigation

**Users sidebar sections** (`features/shell/users-nav.ts`):
- My Approvals (8 links);
- Tasks (7) and Projects (3), shown as one "Tasks & projects" group (D-223 / D-307);
- Information (3), Meetings (3), Tickets (4), AI Assistant (1);
- then the Starred and department projects (`WorkSidebar`).

**Admin sections** (`server/panels/admin-nav.ts`, D-411 / D-412):
- Overview;
- People & organisation (3);
- Records (5);
- Set-up (a hub with a section list, `SettingsLayout`);
- Insights (a hub with tabs, `HubTabs`).

**Super Admin sections** (`server/panels/superadmin-nav.ts`):
- Health (1), Connections (6), Security & access (5), Data (4), Monitoring (5);
- 4 linked sub-pages: WhatsApp templates, AI data sources, bulk request deletion, demo data.

## 4. Shell parts

| Part | File | Notes |
|---|---|---|
| Frame | `features/shell/AppShell.tsx:251-423` | One frame for the three areas |
| Desktop top bar | `AppShell.tsx:319` | 64 px, `px-4 sm:px-6`, search centred (D-232), bell, account |
| Phone top bar | `AppShell.tsx:292` | 56 px + safe area; users area below 768 only |
| Sidebar | `SidebarFrame.tsx:83-139`, `SideNav.tsx`, `NavIndicator.tsx`, `CreateMenu.tsx`, `WorkSidebar` | 220 px / rail 80 px; cookie `ars_sidebar`; `hidden md:flex` |
| Mobile menus | `MobileNav.tsx` (below md, all areas), `BottomNav.tsx` (users desktop layout below md), `MobileTabBar.tsx` (users phone layout) | |
| Content | `<main id="main">` `AppShell.tsx:393-405` | `mx-auto max-w-7xl px-4 pt-6 sm:px-8 sm:pt-10`; `pb-28` users / `pb-10` panels; phone: `px-4 pt-4 pb-[5.5rem+safe]` |
| Banners | `AppShell.tsx:354-392` | Maintenance, offline, slow network, update notice, view-only, try-as, demo |
| Page header | `features/shell/PageHeader.tsx` (94 pages) plus 10 custom h1s | see GLOBAL_COMPONENT_INVENTORY D1 |
| Breadcrumbs | `features/ui/Display.tsx:142` (23 files), `BackLink`, `OriginLink` | |
| Second-level navigation | `HubTabs` (Admin Insights), `SettingsLayout` (Admin Set-up), `ConsoleLayout`, `ProfileTabs`, `OwnershipTabs`, `ViewTabs` | |
| Overlay layers | `Toast.tsx`, `Dialog.tsx`, `overlay-stack.ts`, `top-layer.ts`, `TaskPaneHost` / `@pane`, `RecordPane`, `CommandPalette`, `NotificationBell`, `BottomSheet`, `PicBot`, `OnboardingTour` | |
| Classic view | `Classic.tsx`, `ClassicScreens.tsx`, 53 `[data-view="classic"]` rules in `globals.css` | per-person setting `ui.workspace_view` |

## 5. Pages not swept, and why

| Route | Why |
|---|---|
| `/try` | A one-time "Try as" link (Super Admin), view-only. It needs a minted token. |
| `/users/menu/[module]` | The Classic view's module menus only (D-210). The Classic view was not swept: the owner's decision is pending (GLOBAL_DESIGN_SYSTEM Q-UI-3). |
| `/users/reports`, `/users/reports/[key]` | Old addresses. They redirect to `/admin/insights/reports…` (`app/users/reports/[key]/page.tsx:16`). |
| `/users/requests/[id]/amend` | Needs a request that was sent back. None was in the audit's records. |
| `app/users/@pane/*` | The slot has no address of its own. It is covered through `/users/work/my-tasks?task=<id>`. |

## 6. Tokens, CSS and static scan

| Item | Finding |
|---|---|
| Tokens | `styles/globals.css:11-131` (light), `:134-190` (`data-theme="dark"`), `:191-260` (the same dark block repeated for the system setting); Tailwind names in `tailwind.config.ts:24-85` |
| Motion tokens (v1.87, D-417) | `globals.css:57-79`; `features/shell/motion-rules.ts:50-71`; Tailwind `transitionDuration` / `transitionTimingFunction` (`tailwind.config.ts:83-84`) |
| Z-index tokens | `--z-header` 30, `--z-sticky` 35, `--z-drawer` 40, `--z-popover` 50, `--z-dialog` 60, `--z-toast` 70, `--z-palette` 80, `--z-splash` 90 |
| CSS files | One: `styles/globals.css` (2,058 lines). No CSS modules. |
| Override groups | 53 `[data-view="classic"]` rules (Classic view); 51 `[data-layout="mobile"]` rules (phone layout); the journey's `jr-*` rules (about 350 lines) |
| `!important` | 16 in `globals.css`: reduced motion 7, resize cursor 2, journey 4, pill colours 2, phone journey width 1. Tailwind `!` modifiers in 5 places: `admin/insights/dashboards/raisers/page.tsx:102`, `ActionPanel.tsx:319`, `ItemListEditor.tsx:44`, `LineItemsEditor.tsx:51`, `RecordTable.tsx:28`. |
| Arbitrary px classes | **203** `-[Npx]` values in **55** files. Most common: `text-[11px]` 11, `text-[12px]` 10, `min-h-[56px]` 9, `text-[15px]` 8, `text-[10px]` 7, `min-h-[52px]` 6, `text-[14px]` 6, `h-[22px]` 6. Also `text-[calc(17px*var(--text-scale,1))]` on the Home overviews. |
| Raw colours | 165 hex values in `.tsx` (brand and journey art, the Google button). Raw palette classes: `text-white` 27, `bg-white` 9, `border-white` 5. |
| Inline styles | 129 `style={{` (mostly computed widths, project colours, positions) |
| Page wrappers | No page sets its own `max-w-*` at the top level. Negative margins: `-mx-4` 4 times (phone full-bleed lists). The `scroll-mt-*` hits are anchors, not wrappers. Pages inherit the `main` geometry, which is why the shell measures as consistent. |

## 7. Existing tests (for reference)

| Suite | Count |
|---|---|
| Vitest unit / integration files | 317 (`tests/**`) |
| Playwright e2e specs | 107 in `tests/e2e` (before this audit), plus `tests/qa-e2e` (3), `tests/qa-loaders` and `tests/perf` |
| Layout and UI specs already present | e2e: `v1720-layout-parity`, `v1730-layout-parity`, `v1730-crawl` (status, console, axe serious, overflow, covered controls; light 1366, dark 768 / 375), `v1722-visual` (axe light / dark), `v1800-cls`, `v1800-motion`, `v1860-header-consistency`, `v1870-motion-perf`, `v1870-navigation-continuity`, `v143-mobile`, `v137-ux-laws`, `v136-ui-states`, `zz-site-audit`, `tests/qa-e2e/responsive-sweep.spec.ts`. Unit: `tests/ui/visual-tokens.test.ts`, `navigation-continuity.test.ts`, `ux-laws.test.ts`. |
| Visual regression baselines | **None** (`toHaveScreenshot` is not used anywhere) |

## 8. Console errors and failed requests per page

From the sweep (Chromium: every route of every role at 9 viewports, 1,723 visits including the collapsed-sidebar pass). The only ignored console messages are React DevTools, favicon and aborted requests.
- Console errors: **0**.
- Uncaught page errors: **2**, React #418 hydration mismatch, intermittent, on a different page in each run (UIQA-ERR-01).
- Failed same-origin requests (4xx / 5xx / network): **0**.
- Page statuses of 400 or more: **0**.

Edge (2 more intermittent #418) and WebKit (#418 on `/users/profile/devices`, UIQA-ERR-02) are in RESPONSIVE_TEST_REPORT.md §5. Firefox is BLOCKED.

## 9. Route inventory (all 161 pages)

"Swept as" names the roles that opened the page in the audit. Redirects are those observed at 1440×900 (a page that redirects for this role).

| # | Route | Kind | Module | Swept as | Redirects to (observed) |
|---|---|---|---|---|---|
| 1 | `/` | static | Public | public |  |
| 2 | `/forgot-password` | static | Public | public |  |
| 3 | `/login` | static | Public | public |  |
| 4 | `/privacy` | static | Public | public |  |
| 5 | `/security/not-me` | static | Public | public |  |
| 6 | `/set-password` | static | Public | public |  |
| 7 | `/signed-out` | static | Public | public |  |
| 8 | `/terms` | static | Public | public |  |
| 9 | `/admin` | static | Admin | IT_ADMIN, SUPER_ADMIN |  |
| 10 | `/admin/calendar` | static | Admin | IT_ADMIN |  |
| 11 | `/admin/insights` | static | Admin | IT_ADMIN |  |
| 12 | `/admin/insights/ai` | static | Admin | IT_ADMIN |  |
| 13 | `/admin/insights/analytics` | static | Admin | IT_ADMIN |  |
| 14 | `/admin/insights/analytics/list` | static | Admin | IT_ADMIN | `/admin/insights/analytics` |
| 15 | `/admin/insights/analytics/metrics` | static | Admin | IT_ADMIN |  |
| 16 | `/admin/insights/dashboards` | static | Admin | IT_ADMIN | `/admin/insights/dashboards/utilisation` |
| 17 | `/admin/insights/dashboards/approvers` | static | Admin | IT_ADMIN |  |
| 18 | `/admin/insights/dashboards/departments` | static | Admin | IT_ADMIN |  |
| 19 | `/admin/insights/dashboards/raisers` | static | Admin | IT_ADMIN |  |
| 20 | `/admin/insights/dashboards/utilisation` | static | Admin | IT_ADMIN |  |
| 21 | `/admin/insights/reports` | static | Admin | IT_ADMIN |  |
| 22 | `/admin/insights/reports/[key]` | dynamic | Admin | IT_ADMIN |  |
| 23 | `/admin/insights/workload` | static | Admin | IT_ADMIN |  |
| 24 | `/admin/insights/workload/reassign` | static | Admin | IT_ADMIN |  |
| 25 | `/admin/no-access` | static | Admin | IT_ADMIN |  |
| 26 | `/admin/organisation` | static | Admin | IT_ADMIN |  |
| 27 | `/admin/records` | static | Admin | IT_ADMIN | `/admin/records/requests` |
| 28 | `/admin/records/information` | static | Admin | IT_ADMIN |  |
| 29 | `/admin/records/meetings` | static | Admin | IT_ADMIN |  |
| 30 | `/admin/records/requests` | static | Admin | IT_ADMIN |  |
| 31 | `/admin/records/tasks` | static | Admin | IT_ADMIN |  |
| 32 | `/admin/records/tickets` | static | Admin | IT_ADMIN |  |
| 33 | `/admin/setup` | static | Admin | IT_ADMIN |  |
| 34 | `/admin/setup/ai-rules` | static | Admin | IT_ADMIN |  |
| 35 | `/admin/setup/budgets` | static | Admin | IT_ADMIN |  |
| 36 | `/admin/setup/custom-approval` | static | Admin | IT_ADMIN |  |
| 37 | `/admin/setup/doa` | static | Admin | IT_ADMIN |  |
| 38 | `/admin/setup/groups` | static | Admin | IT_ADMIN |  |
| 39 | `/admin/setup/information-types` | static | Admin | IT_ADMIN |  |
| 40 | `/admin/setup/information-types/[id]` | dynamic | Admin | IT_ADMIN |  |
| 41 | `/admin/setup/meetings` | static | Admin | IT_ADMIN |  |
| 42 | `/admin/setup/notifications` | static | Admin | IT_ADMIN |  |
| 43 | `/admin/setup/reminders` | static | Admin | IT_ADMIN |  |
| 44 | `/admin/setup/reminders/[id]` | dynamic | Admin | IT_ADMIN |  |
| 45 | `/admin/setup/task-settings` | static | Admin | IT_ADMIN |  |
| 46 | `/admin/setup/task-types` | static | Admin | IT_ADMIN |  |
| 47 | `/admin/setup/task-types/[id]` | dynamic | Admin | IT_ADMIN |  |
| 48 | `/admin/setup/ticket-categories` | static | Admin | IT_ADMIN |  |
| 49 | `/admin/setup/ticket-forms` | static | Admin | IT_ADMIN |  |
| 50 | `/admin/setup/ticket-forms/[id]` | dynamic | Admin | IT_ADMIN |  |
| 51 | `/admin/users` | static | Admin | IT_ADMIN |  |
| 52 | `/admin/users/[id]` | dynamic | Admin | IT_ADMIN |  |
| 53 | `/admin/users/new` | static | Admin | IT_ADMIN |  |
| 54 | `/superadmin` | static | Super Admin | SUPER_ADMIN |  |
| 55 | `/superadmin/connections/ai` | static | Super Admin | SUPER_ADMIN |  |
| 56 | `/superadmin/connections/ai/data-sources` | static | Super Admin | SUPER_ADMIN |  |
| 57 | `/superadmin/connections/email` | static | Super Admin | SUPER_ADMIN |  |
| 58 | `/superadmin/connections/google` | static | Super Admin | SUPER_ADMIN |  |
| 59 | `/superadmin/connections/push` | static | Super Admin | SUPER_ADMIN |  |
| 60 | `/superadmin/connections/salesforce` | static | Super Admin | SUPER_ADMIN |  |
| 61 | `/superadmin/connections/whatsapp` | static | Super Admin | SUPER_ADMIN |  |
| 62 | `/superadmin/connections/whatsapp/templates` | static | Super Admin | SUPER_ADMIN |  |
| 63 | `/superadmin/connections/whatsapp/templates/[code]` | dynamic | Super Admin | SUPER_ADMIN |  |
| 64 | `/superadmin/data/backup` | static | Super Admin | SUPER_ADMIN |  |
| 65 | `/superadmin/data/danger-zone` | static | Super Admin | SUPER_ADMIN |  |
| 66 | `/superadmin/data/danger-zone/demo` | static | Super Admin | SUPER_ADMIN |  |
| 67 | `/superadmin/data/danger-zone/requests` | static | Super Admin | SUPER_ADMIN |  |
| 68 | `/superadmin/data/import` | static | Super Admin | SUPER_ADMIN |  |
| 69 | `/superadmin/data/retention` | static | Super Admin | SUPER_ADMIN |  |
| 70 | `/superadmin/monitoring/ai-history` | static | Super Admin | SUPER_ADMIN |  |
| 71 | `/superadmin/monitoring/ai-reports` | static | Super Admin | SUPER_ADMIN |  |
| 72 | `/superadmin/monitoring/audit` | static | Super Admin | SUPER_ADMIN |  |
| 73 | `/superadmin/monitoring/deliveries` | static | Super Admin | SUPER_ADMIN |  |
| 74 | `/superadmin/monitoring/jobs` | static | Super Admin | SUPER_ADMIN |  |
| 75 | `/superadmin/security/features` | static | Super Admin | SUPER_ADMIN |  |
| 76 | `/superadmin/security/general` | static | Super Admin | SUPER_ADMIN |  |
| 77 | `/superadmin/security/pages` | static | Super Admin | SUPER_ADMIN |  |
| 78 | `/superadmin/security/pages/[key]` | dynamic | Super Admin | SUPER_ADMIN |  |
| 79 | `/superadmin/security/sign-in` | static | Super Admin | SUPER_ADMIN |  |
| 80 | `/superadmin/security/sign-in-history` | static | Super Admin | SUPER_ADMIN |  |
| 81 | `/try` | static | Public | **not swept** |  |
| 82 | `/users` | static | Home | IT_ADMIN, USER (approver), USER (no records), SUPER_ADMIN, USER |  |
| 83 | `/users` | parallel slot (@pane) | Home | **not swept** |  |
| 84 | `/users/[...rest]` | parallel slot (@pane) | User (profile / general) | **not swept** |  |
| 85 | `/users/ai` | static | AI | USER | `/users/ai/assistant` |
| 86 | `/users/ai/assistant` | static | AI | USER |  |
| 87 | `/users/ai/data-sources` | static | AI | USER | `/users/ai/assistant` |
| 88 | `/users/ai/history` | static | AI | USER | `/users/ai/assistant` |
| 89 | `/users/ai/insights` | static | AI | USER | `/users/ai/assistant` |
| 90 | `/users/ai/intelligence` | static | AI | USER | `/users/ai/assistant` |
| 91 | `/users/ai/reports` | static | AI | USER | `/users/ai/assistant` |
| 92 | `/users/analytics` | static | Analytics | USER |  |
| 93 | `/users/analytics/list` | static | Analytics | USER | `/users/analytics` |
| 94 | `/users/analytics/metrics` | static | Analytics | USER |  |
| 95 | `/users/approvals` | static | Approvals | USER | `/users/requests` |
| 96 | `/users/approved` | static | Approvals | USER |  |
| 97 | `/users/approved-by-me` | static | Approvals | USER (approver), USER |  |
| 98 | `/users/calendar` | static | Calendar | USER |  |
| 99 | `/users/calendar/items/[id]` | dynamic | Calendar | USER |  |
| 100 | `/users/collaborating` | static | Tasks/Work | USER |  |
| 101 | `/users/custom` | static | Approvals | USER |  |
| 102 | `/users/delegation` | static | Approvals | USER |  |
| 103 | `/users/forms/[token]` | dynamic | Forms | USER |  |
| 104 | `/users/help` | static | User (profile / general) | USER |  |
| 105 | `/users/inbox` | static | Approvals | USER |  |
| 106 | `/users/information` | static | Information | USER (no records), USER |  |
| 107 | `/users/information/[id]` | dynamic | Information | USER (approver), USER |  |
| 108 | `/users/information/new` | static | Information | USER |  |
| 109 | `/users/information/sent` | static | Information | USER (approver), USER |  |
| 110 | `/users/meetings` | static | Meetings | USER (no records), USER |  |
| 111 | `/users/meetings/[id]` | dynamic | Meetings | USER (approver), USER | `/users` |
| 112 | `/users/meetings/dashboard` | static | Meetings | USER (approver), USER | `/users` |
| 113 | `/users/meetings/follow-ups` | static | Meetings | USER |  |
| 114 | `/users/meetings/new` | static | Meetings | USER |  |
| 115 | `/users/menu/[module]` | dynamic | Classic menus | **not swept** |  |
| 116 | `/users/more` | static | User (profile / general) | USER | `/users` |
| 117 | `/users/new` | static | Approvals | USER |  |
| 118 | `/users/no-access` | static | User (profile / general) | USER |  |
| 119 | `/users/notifications` | static | User (profile / general) | USER (no records), USER | `/users/inbox` |
| 120 | `/users/notifications/settings` | static | User (profile / general) | USER |  |
| 121 | `/users/people/[id]` | dynamic | User (profile / general) | USER |  |
| 122 | `/users/profile` | static | User (profile / general) | USER |  |
| 123 | `/users/profile/calendar` | static | User (profile / general) | USER |  |
| 124 | `/users/profile/devices` | static | User (profile / general) | USER |  |
| 125 | `/users/queue` | static | Approvals | USER (approver), USER |  |
| 126 | `/users/queue/sent-back` | static | Approvals | USER |  |
| 127 | `/users/reports` | static | Analytics | **not swept** |  |
| 128 | `/users/reports/[key]` | dynamic | Analytics | **not swept** |  |
| 129 | `/users/requests` | static | Approvals | USER (no records), USER |  |
| 130 | `/users/requests/[id]` | dynamic | Approvals | USER (approver), USER |  |
| 131 | `/users/requests/[id]/amend` | dynamic | Approvals | **not swept** |  |
| 132 | `/users/search` | static | User (profile / general) | USER |  |
| 133 | `/users/security` | static | User (profile / general) | USER |  |
| 134 | `/users/switched-off` | static | User (profile / general) | USER |  |
| 135 | `/users/tasks` | static | Tasks/Work | USER (no records), USER |  |
| 136 | `/users/tasks/[id]` | dynamic | Tasks/Work | USER | `/users/work/my-tasks` |
| 137 | `/users/tasks/assigned` | static | Tasks/Work | USER |  |
| 138 | `/users/tasks/new` | static | Tasks/Work | USER | `/users/work/my-tasks` |
| 139 | `/users/tasks/team` | static | Tasks/Work | USER |  |
| 140 | `/users/tickets` | static | Tickets | USER (no records), USER |  |
| 141 | `/users/tickets/[id]` | dynamic | Tickets | USER (approver), USER |  |
| 142 | `/users/tickets/board` | static | Tickets | USER (approver) |  |
| 143 | `/users/tickets/dashboards` | static | Tickets | USER (approver) |  |
| 144 | `/users/tickets/dashboards/[id]` | dynamic | Tickets | USER (approver) |  |
| 145 | `/users/tickets/new` | static | Tickets | USER |  |
| 146 | `/users/work` | static | Tasks/Work | USER | `/users` |
| 147 | `/users/work/deleted` | static | Tasks/Work | USER |  |
| 148 | `/users/work/inbox` | static | Tasks/Work | USER | `/users/inbox` |
| 149 | `/users/work/my-tasks` | static | Tasks/Work | USER (no records), USER |  |
| 150 | `/users/work/periodic` | static | Tasks/Work | USER |  |
| 151 | `/users/work/portfolios` | static | Projects/PM | USER |  |
| 152 | `/users/work/portfolios/[id]` | dynamic | Projects/PM | USER |  |
| 153 | `/users/work/portfolios/new` | static | Projects/PM | USER |  |
| 154 | `/users/work/projects` | static | Projects/PM | USER (no records), USER |  |
| 155 | `/users/work/projects/[id]` | dynamic | Projects/PM | USER |  |
| 156 | `/users/work/projects/[id]/automations/[ruleId]` | dynamic | Projects/PM | USER |  |
| 157 | `/users/work/projects/[id]/forms/[formId]` | dynamic | Forms | USER |  |
| 158 | `/users/work/projects/[id]/settings` | dynamic | Projects/PM | USER |  |
| 159 | `/users/work/projects/new` | static | Projects/PM | USER |  |
| 160 | `/users/work/search` | static | Tasks/Work | USER |  |
| 161 | `/users/work/templates` | static | Projects/PM | USER |  |

**Pages per module:** Public 9, Admin 45, Super Admin 27, Home 2, User (profile / general) 13, AI 7, Analytics 5, Approvals 12, Calendar 2, Tasks/Work 12, Forms 2, Information 4, Meetings 5, Classic menus 1, Tickets 6, Projects/PM 9.
