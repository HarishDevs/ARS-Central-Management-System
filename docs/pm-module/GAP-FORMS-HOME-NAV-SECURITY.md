# Gap analysis: Forms, Portfolios, Home, Navigation & Settings, Security

ARS-CMS (`D:\Omniroute\ARS Approval System`) compared with the spec package at `D:\REA\Asana\asana-reverse-engineering\docs` (12-modules/FORMS_MODULE.md, PORTFOLIOS_MODULE.md, HOME_MODULE.md, NAVIGATION_AND_SETTINGS.md and 05-security/*).

This was a read-only review. I read the code and ran no tests. Paths are relative to the repo root unless they start with a drive letter.

Legend: **EXISTS** means the capability is there (the UX may differ). **PARTIAL** means the building blocks are there but the spec behaviour is incomplete. **MISSING** means nothing equivalent exists.

---

## 0. Headline facts (verified in code)

| Question | Answer | Evidence |
|---|---|---|
| Can anyone submit a form without signing in today? | **No.** No anonymous form, intake or submission route exists. The only unauthenticated write paths are machine webhooks, which need a shared secret and are rate-limited. A public form would be a **policy change**. | `middleware.ts:18` lists `PUBLIC_PREFIXES`. The only public write APIs are `/api/auth`, `/api/jobs`, `/api/webhooks` and `/api/push/resubscribe`. `app/api/webhooks/ceoitbox/route.ts:20-26` checks the secret and the rate limit. The repo `CLAUDE.md:25` says "Only admin-created users sign in". `DEVELOPMENT-MEMORY.md` D-150 says "CAPTCHA: not added, because there are no anonymous forms (SEC-11)". `tests/security/route-inventory.test.ts` requires every public route to be justified. |
| Does a project-level "form → task in a section" exist? | **No.** Typed tasks with form fields cannot be placed in a project. Project quick-add can place a task in a section, but only as the field-less General type. | `server/modules/tasks.ts:87-100`: `CreateTaskInput` has `typeId` and `fields` but no `projectId` or `sectionId`. `server/work/service.ts:291-375`: `quickAddTask` takes `projectId`/`sectionId` but always uses `repo.generalTypeVersion()`. |
| Is there a portfolio concept? | **No.** The string "portfolio" does not appear anywhere in `app`, `features`, `server`, `lib` or `database`. D-215 lists portfolios as "Not built". | grep finds nothing. `DEVELOPMENT-MEMORY.md` D-215. |
| Multi-tenant or workspace? | **No. The app is single-tenant by design.** No table has a `tenant`, `workspace_id` or `org_id` column. The organisation is the deployment itself, structured by departments and designations, and project privacy uses `ORGANISATION` = "Everyone at ARS". | `database/migrations/202609281200_create_organisation.sql` (only `departments` and `designations`). `server/work/access.ts:21-23`. |
| Is there a shared form builder? | **Yes, but it is admin-only.** A versioned field designer is used by approval templates, task and information types, and ticket forms. | `features/admin/FormFieldsEditor.tsx`, `features/admin/form-designer/*`, `features/admin/ModuleTypeEditor.tsx`, `features/admin/CustomApprovalSetup.tsx`, `server/forms/fields.ts`, `server/forms/dynamic.ts`, `server/workflows/builder.ts`. Ticket forms: `features/tickets/TicketFormSetup.tsx`. |

---

## 1. FORMS_MODULE

| # | Feature area (spec §) | Status | Evidence | What's missing |
|---|---|---|---|---|
| F1 | Form builder canvas: add, reorder, duplicate and delete questions (§3.4–3.5) | **PARTIAL** | `features/admin/FormFieldsEditor.tsx` (drag reorder with drop marker, properties panel, undo on delete); `features/admin/form-designer/FieldProperties.tsx` | Only admins and IT can use it (it sits under `features/admin`). Project owners and editors cannot build a form for their own project. |
| F2 | Question types (§4.1): Text, Single/Multi-select, Date, Number, Attachment, Heading | **EXISTS** (superset) | `server/forms/fields.ts:18` `FIELD_TYPES`: TEXT, LONG_TEXT, NUMBER, DATE, CHOICE, RADIO, MULTI_CHOICE, CHECKBOX, ATTACHMENT, SECTION (heading), PERSON, LOOKUP, CALC, LINE_ITEMS, CURRENCY, DATETIME, URL, ITEM_LIST | Name and Email default questions are not needed while every submitter is signed in. A public form would need them. |
| F3 | Branching / conditional questions (§3.5, ≤5 levels) | **EXISTS** (different UX) | `server/forms/dynamic.ts:256` `visibleFields`; shared rule editor `features/admin/conditions/RuleEditor.tsx` | There is no per-option "Add branch" UX. Show-if rules cover the behaviour. |
| F4 | Connect a question to a project custom field (§3.5) | **MISSING** | Project fields exist: `database/migrations/202610301200_work_more.sql:22` `project_fields` (TEXT/NUMBER/SELECT/DATE), stored in `task_field_values` | Type form fields write to `tasks.form_data_json`. Nothing maps a form question to a `project_fields` column. |
| F5 | Settings tab: target section, title from answer, default assignee, description template, confirmation message, add submitter as collaborator (§3.6) | **PARTIAL** | Per-type settings and access (`parseTaskSettings` / `mayCreate` in `server/work/service.ts:320`); ticket routing to category and coordinators (`ticket_request_types`, `features/tickets/TicketFormSetup.tsx`) | No target project section, no title-from-answer, no custom confirmation message and no collaborator add. |
| F6 | Versioned publish / draft (§5.2, §11 "versioned publishing") | **EXISTS** | Workflow and type versions: D-055, `server/workflows/version-diff.ts`, `server/workflows/migration.ts`, `server/workflows/promotion.ts`, migration `202611011000…workflow_draft_revision` | — |
| F7 | Publish → Share dialog, copy link, rotate public key, embed (§3.7, §9) | **MISSING** | — | No per-form shareable key or link, no Share dialog, no key rotation and no embed. Forms are reached only from in-app pages (`/users/custom`, `/users/tasks/new`, `/users/tickets/new`). |
| F8 | Access modes: org-only, anyone with the link, deactivated (§4.3) | **PARTIAL** | Who may create each type is limited by department or person (`mayCreate`). Types can be switched off ("General task type is switched off", `server/work/service.ts:316`). A ticket form is closed until it has a category and coordinators (`TicketFormSetup.tsx:14,22`). | "Anyone with the link" is missing, and it is a policy change (§6). There is no "not accepting submissions" public page. |
| F9 | **Public fill view** for people without accounts (§3.9) | **MISSING — POLICY CONFLICT** | `middleware.ts:18`, `CLAUDE.md:25`, D-150 | There is no unauthenticated route, page or API, and no anonymous principal. |
| F10 | Validation, per-field errors, confirmation screen, idempotent submit (§3.10, §5.3) | **EXISTS** | zod validation in `server/forms/fields.ts`; `tasks.submission_key` with `UNIQUE (created_by, submission_key)` (`database/migrations/202610160900_v190.sql:73`); `features/requests/SubmissionChecks.tsx` | No "Submit another" option and no redirect URL. |
| F11 | **Submission → task at the top of a section, actor = form system user** (§3.11, §5.3) | **MISSING** | `server/modules/tasks.ts:87` has no project or section. `quickAddTask` uses the General type only. `tasks.created_by BIGINT NOT NULL` is a foreign key to `users` (`v190.sql:56`), so there is no system-actor row. D-362 (`202611201000_ticket_tasks_retired.sql`): ticket assignment no longer creates tasks. | The whole path is missing: a form bound to a project, section routing, a system or form actor, mapping answers to fields, and a back-link description. The nearest analogue is **ticket forms**, which raise a ticket routed to coordinators. |
| F12 | Submissions log, request tracking (§3.12) | **PARTIAL** | Requests, tasks and tickets each have lists, timelines and history (`features/requests/RequestTimeline.tsx`, `server/tickets/*`) | There is no per-form submissions log. |
| F13 | Forms in project **Customize** panel (§3.3) | **MISSING** | `features/work/ProjectWorkspace.tsx` has fields and sections but no Customize panel. `features/work/ProjectForms.tsx` holds project *edit* forms, not intake forms. | No Customize panel and no project-scoped forms list. |
| F14 | Home **Forms widget** with recents, star and copy link (§3.1) | **MISSING** | `app/users/(home)/page.tsx`, `features/home/MyWorkOverview.tsx` have no forms section | — |
| F15 | Create menu "Form" item (§11 improve) | **MISSING** | `features/shell/CreateMenu.tsx:43-46`: Approval request, Task, Project, Information | — |
| F16 | Anti-spam: rate limits (§10) | **PARTIAL** | `server/security/limits.ts` (DB-backed `rate_limit_hits`, per person; `ticketRaise: 5/min`) | No per-IP, per-form or per-workspace buckets. Every bucket is per signed-in person. |
| F17 | Honeypot, minimum fill time, CAPTCHA or challenge (§10, THREAT_MODEL AC-04) | **MISSING** (deliberately) | D-150: "CAPTCHA: not added, because there are no anonymous forms" | All of these would be required before any public form ships. |
| F18 | Attachment size, type allow-list and content sniffing (§10, AC-05) | **EXISTS** | `server/attachments/files.ts:3` (10 MB), `:7` `SNIFF_BYTES`, `:47` `ALLOWED_TYPES` with magic-byte sniffers | — |
| F19 | Malware or AV scan hook, file hidden until clean (§10, AC-05, OQ-SEC-19) | **MISSING** | D-150: "Malware scanning: not available on shared hosting" | No scan state on files, no quarantine and no hook. |
| F20 | Phishing and XSS handling of submitted content: plain text, non-clickable links, "external" mark (§10) | **PARTIAL** | Comments use the app's own rich-text format with links limited to http(s)/mailto (D-305, `features/work/rich-text.ts`) | There is no "external submission" mark (all content is internal today). |

---

## 2. PORTFOLIOS_MODULE

| # | Feature area | Status | Evidence | What's missing |
|---|---|---|---|---|
| P1 | Portfolio entity, list page, new-portfolio dialog (§3.1–3.3, §7) | **MISSING** | No portfolio table, route or code anywhere | `portfolio`, `portfolio_item` and `portfolio_member` tables; routes; UI. |
| P2 | Portfolio List tab with rollups: status, progress, dates, owner, custom fields (§3.5, §5.2) | **MISSING** | Building blocks exist: `projects.current_status`, `project_status_updates`, `start_on`/`due_on` (`202610301000_work_management.sql:45-75,193`) | Rollup computation and the list. |
| P3 | Timeline, Dashboard, Progress, Workload and Messages tabs (§3.17–3.21) | **MISSING** | Project Timeline exists (`features/work/Timeline.tsx`); team workload exists (`server/workload/summary.ts`, `features/work/TeamWorkloadTable.tsx`); dashboards exist (`server/dashboards`) | A portfolio-scoped version of each tab. |
| P4 | Nesting (portfolio in portfolio) and access to items (§5.3–5.4) | **MISSING** | — | — |
| P5 | Portfolio roles and members, Share dialog (§3.14, §8) | **MISSING** | The project role model could be reused (`server/work/access.ts:11` OWNER/EDITOR/COMMENTER/VIEWER, plus department grants) | — |
| P6 | Star a portfolio, Home Portfolios widget, portfolio notifications | **MISSING** | `work_favourites.object_type ENUM('PROJECT','SEARCH')` (`202610301000_work_management.sql:224`) | Needs a PORTFOLIO enum value, a widget and notification categories. |

---

## 3. HOME_MODULE

| # | Feature area | Status | Evidence | What's missing |
|---|---|---|---|---|
| H1 | Home page with greeting and summary (§3.1) | **EXISTS** | `app/users/(home)/page.tsx:63,492` `greetingFor`; focus switch Approvals / Task Management / Meetings (`:429`) | — |
| H2 | My tasks widget with Upcoming / Overdue / Completed (§3.3) | **EXISTS** | `features/home/MyWorkOverview.tsx:73` (tabs upcoming/overdue/completed/all), `:246` | — |
| H3 | Tasks I've assigned (§3.5) | **PARTIAL** | Separate page `/users/tasks/assigned` (`features/shell/users-nav.ts`); D-215 Task home | It is not a Home widget with This week / Upcoming / Overdue tabs. |
| H4 | Projects widget, recents (§3.7) | **EXISTS** | `MyWorkOverview.tsx:389` `mw-projects`; `work_recent_projects` table | — |
| H5 | Status updates widget (§3.10) | **PARTIAL** | `MyWorkOverview.tsx:442` `mw-activity`; D-215 "latest status updates" | No modal or dedicated widget. |
| H6 | Upcoming meetings (§3.2) | **EXISTS** (other form) | Meetings focus on Home (`app/users/(home)/page.tsx:107` `MeetingHome`) | — |
| H7 | Private notepad (§3.4) | **MISSING** | — | — |
| H8 | People / frequent collaborators (§3.9) | **MISSING** | — | — |
| H9 | Comments mentioning me (§3.11) | **PARTIAL** | Mentions reach the Inbox (`/users/inbox`, `features/shell/NotificationCenter.tsx`) | No Home widget. |
| H10 | AI assistant widget (§3.12) | **PARTIAL** | AI module `/users/ai/assistant`, Pico Bot | Not on Home. |
| H11 | Forms and Portfolios widgets (§3.6, §3.8) | **MISSING** | — | Depends on F and P above. |
| H12 | Customize Home: add, remove, reorder and resize widgets; layout saved per user (§3.15, §5.2) | **MISSING** | Sections are fixed. Only the focus switch is a user choice. | A widget registry and a layout table. |
| H13 | Timeframe (My week / My month) (§4.2) | **PARTIAL** | `PeriodPicker` on Home (`MyWorkOverview.tsx:216`) | — |

---

## 4. NAVIGATION_AND_SETTINGS

| # | Feature area | Status | Evidence | What's missing |
|---|---|---|---|---|
| N1 | Sidebar with sections, collapsible groups, collapse to a rail (§3.3, §3.9) | **EXISTS** | `features/shell/SideNav.tsx`, `features/shell/users-nav.ts`, `features/shell/sidebar-cookie.ts`; D-149, D-229 | — |
| N2 | Create menu (§3.6) | **EXISTS** | `features/shell/CreateMenu.tsx:43-46` | No Form, Portfolio or Goal items. |
| N3 | Ctrl/Cmd+K search panel with type chips, recents and saved searches (§3.7) | **EXISTS** | `features/shell/CommandPalette.tsx:94` (ctrl or meta + K); D-232 | — |
| N4 | **Starred** items in the sidebar (§3.3) | **PARTIAL** | `work_favourites` (projects and searches); `StarButton` in `features/work/ProjectForms.tsx:136`; starred projects sort first on `app/users/work/projects/page.tsx:17` | There is no Starred section in the sidebar (`SideNav.tsx` has none), and requests, tasks and forms cannot be starred. |
| N5 | **Team** sections in the sidebar (§3.3–3.5) | **MISSING** | No teams concept. Departments act as groups for project privacy and membership (`project_members.member_type ENUM('USER','DEPARTMENT')`). | Teams, or a decision to treat departments as teams. |
| N6 | Global rail and areas (Work / Strategy / People) (§3.2) | **PARTIAL** | Spaces: My approvals / Admin / Super Admin; Compact vs Classic views (`features/shell/Classic.tsx`) | — |
| N7 | Keyboard shortcuts and the "?" help (§3.24) | **EXISTS** | `features/shell/shortcuts.ts:14-29` | — |
| N8 | User menu and Profile (§3.8, §3.15) | **EXISTS** | `features/shell/ProfileMenu.tsx`, `ProfileTabs.tsx`; profile photo and about me (`202610311200_profile_notifications.sql`) | Pronouns and job title are admin-set. |
| N9 | Notification settings (§3.16) | **EXISTS** | `notification_preferences`, `lib/db/repositories/preferences.repository.ts`; D-231 control centre | No portfolio or goal categories. Do-not-disturb was not verified. |
| N10 | Account and security: sessions, sign out of other sessions, 2FA (§3.18) | **EXISTS** | `features/shell/SignOutEverywhereButton.tsx`, `/users/security`, Google and WhatsApp OTP | Self-deactivation and deletion are omitted by design. |
| N11 | Display preferences: theme, compact, colour-blind mode, first day of week, toast duration (§3.19) | **PARTIAL** | Theme `app/users/theme-actions.ts` (`setUserSetting`); text size `features/shell/TextScale.tsx` | No compact, colour-blind, first-day-of-week or toast-duration settings. |
| N12 | **"Show occasional celebrations"** preference | **MISSING** | Celebrations always play: `features/ui/BrandAnimation.tsx:11` ("celebrate", "task-done"), `features/ui/Toast.tsx`, `app/users/requests/[id]/page.tsx:212` | A per-user toggle. No reduced-motion user setting was found. |
| N13 | Navigation customization: icon-only, hide or reorder areas (§3.20) | **PARTIAL** | Collapse only. Admin page access hides pages (`server/authorization/page-access.ts`). | No user-level hide or reorder. |
| N14 | Invite dialog (§3.11) | **MISSING — by policy** | `CLAUDE.md:25` (admin creates users) | Keep it missing, or offer "Ask IT to add". |
| N15 | Inbox and notifications (spec cross-ref) | **EXISTS** | `/users/inbox`, `features/shell/NotificationBell.tsx`, `NotificationCenter.tsx`; D-237 | — |
| N16 | Out of office (§4 Profile) | **PARTIAL** | Delegation (`/users/delegation`, `features/requests/DelegationForms.tsx`) | Not shown on the profile or hovercard. |

---

## 5. 05-security (roles, permission matrix, threat model)

| # | Area | Status | Evidence | Gap / note |
|---|---|---|---|---|
| S1 | Org roles: Owner / Admin / Member / Guest (RPM B.1) | **PARTIAL** | `types/auth.ts:1` `SUPER_ADMIN \| IT_ADMIN \| USER \| EXPORTER`; per-user `module_access` set (`202611111300_project_module.sql`) | No Guest role. The roles are named differently but map reasonably well. |
| S2 | Project roles (RPM B.3) | **EXISTS** | `server/work/access.ts:11-27,65` (OWNER/EDITOR/COMMENTER/VIEWER, highest grant wins, department grants) | — |
| S3 | Per-field and per-project permissions (Customize restrictions) | **EXISTS** | `projects.permissions_json`, `parseProjectPermissions` (`202610301600_task_kinds_permissions.sql:12`) | Nothing for forms (no forms yet). |
| S4 | Task visibility (V(user)) and IDOR protection (AC-07) | **EXISTS** | `server/work/task-access.ts`, `server/work/hierarchy.ts` (reporting chain, D-216), `server/authorization/guards.ts`, `policy.ts` | Goes beyond the spec with hierarchy-based visibility. |
| S5 | Server-side enforcement on every route (EP-1) | **EXISTS** | `requireApiArea` plus `tests/security/route-inventory.test.ts:48-58` | — |
| S6 | CSRF and cross-site write refusal | **EXISTS** | `middleware.ts:84-92` (`sec-fetch-site` cross-site refusal) | A public embeddable form would need a deliberate exemption, plus `frame-ancestors`. |
| S7 | **Multi-tenant / workspace isolation** (T-I tenant rules, AU "resolve tenant") | **MISSING — single-tenant by design** | No `tenant` or `workspace_id` in any migration | Flag: every spec "per-tenant" control (quotas, rate buckets, "force internal-only forms" switch) maps to a Super Admin setting (`server/settings/definitions.ts`). |
| S8 | Guests and external principals (RPM A.1, AC-01) | **MISSING — by policy** | `CLAUDE.md:25` | — |
| S9 | **Public principal** ("create-task only into one section; no read", RPM B.4) | **MISSING** | — | Needs a new principal type plus the policy decision. |
| S10 | Rate limits (T-D-01, T-D-04) | **PARTIAL** | `server/security/limits.ts` (per person; webhook 600/min) | No per-IP or per-form buckets, which anonymous traffic would need. |
| S11 | Challenge (CAPTCHA) and honeypot (AC-04) | **MISSING** | D-150 | Required by AC-04 before any public form. |
| S12 | File checks (T-D-03) | **EXISTS** | `server/attachments/files.ts` (10 MB, allow-list, sniffing) | The spec allows 100 MB. ARS is stricter, which is fine. |
| S13 | AV scan, `pending → clean` state (AC-05, OQ-SEC-19) | **MISSING** | D-150 (shared hosting) | Needs an external scanner API or a "no attachments on public forms" rule. |
| S14 | Audit log | **EXISTS** | `202609281203_create_audit_logs.sql`, `audit.repository.ts` | — |
| S15 | Personal access tokens, scopes, per-token limits (AU-A-22/26) | **MISSING** (out of scope here) | — | Noted only. |
| S16 | Privacy for submitters: hashed IP and user agent, retention, consent text (FORMS §10) | **MISSING** | — | Any public form would also need privacy and terms updates (repo `CLAUDE.md:34-35`, general-pages rule). |

---

## 6. Policy conflicts needing the owner's decision

1. **Public (unauthenticated) forms.** This conflicts with repo `CLAUDE.md:25` ("Only admin-created users sign in") and with the reasoning recorded in D-150 (no CAPTCHA because there are no anonymous forms). The spec itself defers it: THREAT_MODEL OQ-SEC-20, SECURITY_MODEL:147,222 ("off until an admin enables"), FORMS §11 MVP = org-only. If approved, the following are mandatory first: a public-route entry with a reason in the route-inventory test, a CSRF exemption for one path, per-IP and per-form limits, a honeypot plus a challenge, a malware-scan decision, submitter privacy text, and privacy and terms updates.
2. **Who builds forms.** Today forms are admin-built, versioned type definitions. The spec lets project editors build forms. Decide between self-serve project forms and IT-built forms bound to a project.
3. **System actor and the "one assignee" rule.** `tasks.created_by` is `NOT NULL` with a foreign key to `users`, and D-215 says every task keeps one accountable assignee. Form-created tasks need a system user row and a default-assignee rule (for example the project owner or the section owner).
4. **Malware scanning on shared hosting** (D-150). Choose one: an external scan API, no attachment questions on public forms, or files hidden until IT reviews them.
5. **Reuse ticket forms or build a new Forms module.** Ticket forms already provide internal intake (category plus coordinators). D-362 removed tasks from tickets. The "blend into existing" rule suggests extending the existing type and form system with a "project + section target" rather than adding a parallel module.
6. **Single-tenant.** Confirm that workspace and tenant concepts are out of scope. Spec controls marked "per tenant" then become Super Admin settings.
7. **Teams vs departments** (sidebar team sections, portfolio sharing). Confirm that departments stand in for teams.
8. **Portfolios.** These are new scope with no existing table. Confirm priority and whether portfolios group projects only, or projects plus approval workflows.
9. **Guests and invites.** These stay out under the admin-creates-users rule. Confirm.
10. **Celebrations toggle** (minor). Add it to the user's display preferences, and update the general pages (help, guide) per the general-pages rule.

---

## 7. Counts

| Area | EXISTS | PARTIAL | MISSING | Total |
|---|---|---|---|---|
| Forms (F1–F20) | 5 | 6 | 9 | 20 |
| Portfolios (P1–P6) | 0 | 0 | 6 | 6 |
| Home (H1–H13) | 4 | 5 | 4 | 13 |
| Navigation & settings (N1–N16) | 8 | 5 | 3 | 16 |
| Security (S1–S16) | 7 | 2 | 7 | 16 |
| **Total** | **24** | **18** | **29** | **71** |
