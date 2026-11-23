# Admin and Super Admin redesign: brief and status

Owner approval, 23 Nov 2026: "go with your recommendations for Admin and Super Admin only; afterwards we can redesign the Users screen; build everything in one go."
Releases: **v1.84.0** (shared parts + Super Admin, D-411) and **v1.85.0** (Admin including Records, D-412).
Design reference (structure and behaviour only, no code, no dependency): Astryx `docs/families/layout-regions.md`, `overlay-dismissal.md`, `action-groups.md`, `docs/design/system-states.md`, `template-composition.md`; page templates `settings-sidebar`, `incident-console`, `table-filter`, `table-inbox`, `detail-page` (MIT).

## Problems fixed
**Admin (before):** 31 entries in 9 groups; figures split over six places (Analytics, Reports, Insights, Dashboards, Workload, AI Analytics); six separate "set-up" groups; Needs attention a separate page; "Task settings" at `/admin/task-holidays`; Import data duplicated with Super Admin.
**Super Admin (before):** 19 mostly flat entries; "Providers & security" one long page with 11 unrelated groups and the test panels at the side; backup settings duplicated with the Backup centre and retention values with Retention & holds; AI over five entries and Salesforce separate; bulk delete ("Requests") and Demo data among everyday pages; mixed capitalisation ("Salesforce Settings", "AI Activity History").

## Target layout
### Super Admin (five groups, v1.84.0)
| Group | Pages (new address) |
|---|---|
| Health | Health console `/superadmin`: a status card per provider, job, backup and delivery (OK / Warning / Failed / Not set up, icon + word, last check, Test or Open) and a Needs action list; details below (provider keys, origin lock, file storage, backups) |
| Connections | Email `/superadmin/connections/email`; WhatsApp `…/whatsapp` (+ templates `…/whatsapp/templates`); Phone & desktop notifications `…/push`; Google sign-in & calendar `…/google`; Salesforce `…/salesforce`; AI providers `…/ai` (+ AI data sources `…/ai/data-sources`). Each page: status card, settings, Test together |
| Security & access | Sign-in security `/superadmin/security/sign-in`; General `…/general`; Page access `…/pages`; Feature switches `…/features`; Sign-in history `…/sign-in-history`. Break-glass has no screen (server-side account only), so no page |
| Data | Backup, restore & migrate `/superadmin/data/backup` (takes over the S3 off-site and Google Drive backup settings and the Drive Test); Retention & legal holds `…/retention` (takes over the retention values); Import data `…/import` (the only one); Danger zone `…/danger-zone` (Delete requests `…/danger-zone/requests` with a typed DELETE for bulk delete, Demo data `…/danger-zone/demo` with its typed LOAD DEMO) |
| Monitoring | Audit log `/superadmin/monitoring/audit`; Message deliveries `…/deliveries`; Job runner & automation `…/jobs`; AI activity history `…/ai-history`; AI reports `…/ai-reports` |

### Admin, for the IT team (five groups, v1.85.0)
| Group | Pages (new address) |
|---|---|
| Overview | `/admin`: today's figures, Needs attention built in (`/admin/attention` redirects to `/admin#attention`), one search across records |
| Records | `/admin/records/requests`, `…/tasks`, `…/information`, **`…/tickets`, `…/meetings`** (owner decision; the existing queries and permission checks, no new data access). One shared table with the power-search chip bar (field / operator / value chips in the address; a bottom sheet on phones). A row opens the record pane (side / ⤢ dialog / full page) |
| Insights | `/admin/insights` hub with tabs: Summary, Dashboards `…/dashboards`, Analytics `…/analytics`, Reports `…/reports`, Workload `…/workload` (with reassign), AI analytics `…/ai`. Each tab keeps its own feature switch and page-access key |
| Set-up | `/admin/setup` with a section list: Approvals (custom approval, approver groups, DoA, budgets); Tasks (task types, task settings/holidays `…/task-settings`); Information types; Ticketing (forms, categories); Meetings; Automation (reminders & escalations, notifications); AI rules |
| People & organisation | Users & roles `/admin/users`, Departments `/admin/organisation`, Working calendar `/admin/calendar` (addresses and screens unchanged; the Users screen redesign comes later) |

## Shared parts (features/ui)
- **Panel sidebar:** `SideNav` folding groups in both panels, the active entry lit, open groups kept per person and panel (`ars.nav.groups.<area>.<userId>`), Search settings at the top and Back to the app at the bottom (also in the phone menu).
- **Settings layout** (`SettingsLayout`): section list on the left, the section on the right, Search settings above the list; on a phone the list is the hub and each section has a way back. One Save per section with the unsaved guard (`SettingsGroupForm`/`UnsavedGuard`).
- **Search settings** (`SettingsSearch` + `server/panels/settings-index.ts`): across both panels, built on the server for the person: Super Admin pages and settings only for the Super Admin; Admin pages less any page hidden for them and anything switched off. Names and keys only, never values.
- **Console layout** (`ConsoleLayout`): list, details, log. Used by the Health console and the Job runner. Deliveries, Audit and the Backup centre keep their own layouts (their filter dashboards and the centre's client flow don't fit without losing features).
- **Status card** (`StatusCard`, `HealthBadge`): icon + word, never colour alone; last check; Test or Open.
- **Danger zone box** (`DangerZone`, `useTypedConfirm`): red edge and icon, what it does, typed confirmation (checked again on the server).
- **Details list** (`DetailsList`): replaces hand-made `<dl>`s on the pages touched.
- **Shared table, power search and record pane** (v1.85.0): see Records.

## Must keep (how)
- Every page and action keeps its own `requireArea` (tests/security/page-guards); the Super Admin area stays itadmin@ only.
- Page access: keys unchanged; their `paths` follow the new addresses (server/authorization/pages.ts). `admin.import` removed (Import is Super Admin only; page access never applies to the Super Admin). No migration needed.
- Old addresses: one map `lib/routing/panel-redirects.ts`, used by the middleware (308, query kept, before the session check). `tests/routing/panel-redirects.test.ts` checks every old page address resolves to a page that exists.
- Secrets: never shown or logged; settings encryption, history and "Key replaced" unchanged.
- **Import merge rule:** the Admin and Super Admin imports were the same screen (`ImportScreen`) with the same five kinds (users, departments, designations, approver groups, holidays), so nothing needed merging: the Admin copy was removed and the actions and download API now need the Super Admin area. The Import buttons on Admin pages show for the Super Admin only.
- Job runner, cron URLs and the backup centre's behaviour unchanged.

## Status
- [x] v1.84.0 shared parts + Super Admin (23 Nov 2026)
- [x] v1.85.0 Admin including Records (23 Nov 2026). Records panes show the register row (a details list) with Open full page for every kind; each kind's own pane body and a tickets/meetings CSV are deferred (PLAN AD-9)
