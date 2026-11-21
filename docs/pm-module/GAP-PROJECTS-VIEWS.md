# Gap analysis: Asana-style Projects spec vs ARS-CMS (Tasks & Projects module)

Read-only review, 21 Nov 2026. Nothing was edited, run or started.

- **Spec**: `D:\REA\Asana\asana-reverse-engineering\docs` (12-modules/PROJECTS_MODULE, PROJECTS_VIEWS, PROJECTS_CUSTOMIZATION; 08-product/MVP_SCOPE, MASTER_FEATURE_MATRIX; 06-workflows/BUSINESS_RULES)
- **ARS-CMS**: `D:\Omniroute\ARS Approval System`. Paths below are relative to that folder.
- **Decision log**: D-215 (module built), D-216 (hierarchy), D-218 (recurrence, fields, templates, bulk), D-219 (skeleton, task pane), D-220 (task grid, saved tabs, share, wizard), D-222 (periodic/ad hoc, project permissions), D-307/D-308 (Projects as a separate, unreleased module), D-313 (periodic only for oneself), D-316 (due date mandatory), D-352/D-354/D-361 (folding, sorting, resizable columns).

Legend: **EXISTS** means the spec's core behaviour is built. Minor gaps are still noted. **PARTIAL** means some is built and a material part is missing. **MISSING** means nothing equivalent was found.

## 1. Summary

| Status | Count |
|---|---|
| EXISTS | 16 |
| PARTIAL | 9 |
| MISSING | 11 |
| **Total feature areas** | **36** |

## 2. Feature areas

### 2.1 Project creation, header, status, settings

| # | Area (spec §) | Feature ID | ARS-CMS | Evidence | What's missing |
|---|---|---|---|---|---|
| 1 | Blank project creation (PM §3.3) | PRJ-01 | EXISTS | `features/work/NewProjectWizard.tsx:13-33,80-152` (Start, then Details: name, department, privacy, default view with preview, colour, description; then Sections, default "To do / In progress / Done"); `app/users/work/projects/new/page.tsx`; `server/work/service.ts:121 createProject` | No "Share with" step at creation. No AI setup. You pick one default view instead of the spec's multi-select view picker (PM §3.4). |
| 2 | Templates: gallery, save as, use (PM §3.2, §3.16) | PRJ-21 | PARTIAL | Save as template dialog `features/work/ProjectHeader.tsx:66,123-128`. Template stored as JSON on a project row `is_template`/`template_json` (`database/migrations/202610301200_work_more.sql:17`). Built by `server/work/service-more.ts:~150-260` (day offsets, holidays). Template page `app/users/work/projects/[id]/page.tsx:63-104` | No template gallery (categories, curated or "coworkers" sets, preview). No editing a template. No organisation-wide template library: only the source project's members can use it. |
| 3 | Duplicate project (PM §3.15) | PRJ-22 | EXISTS | `projects/[id]/settings/page.tsx:105-111` "Copy it as a new project" (optionally with members), via the template shape (`service-more.ts`) | The copy is synchronous with no component checkboxes: the spec's dialog picks tasks, assignees, dates, fields, followers and so on. |
| 4 | Import (CSV/any file), export or sync, print, AI create (PM §3.5, §3.19-20) | PRJ-26 | MISSING | No project import or export. Only global Admin → Records exports exist (`app/api/admin/records/[kind]/route.ts`) | CSV/JSON export of a project, CSV import with column mapping, print. |
| 5 | Project header (PM §3.6) | PRJ-02 | EXISTS | `features/work/ProjectHeader.tsx:17-118`: colour tile, actions menu (settings, members, duplicate, save as template, archive or delete), star, Set status pill, member avatars, Share, Customize (links to `settings#fields`), copy link | No icon picker (the tile shows initials on a colour). No inline title rename (rename is in settings). No Add to portfolio, Create table, Import or Export menu items. |
| 6 | Project status pill and status updates (PM §3.22) | PRJ-20, COL-06 | EXISTS | Six kinds ON_TRACK … DROPPED (`202610301000_work_management.sql` `projects.current_status`, `project_status_updates.snapshot_json`). `server/work/service.ts:834-852 postStatus` (COMPLETE sets `completed_at`). Overview composer and list at `projects/[id]/page.tsx:325-375` with a frozen snapshot (open/completed/overdue) | Composer has title and body only. No highlights or sections blocks, no rich snapshot widgets, no status reminders, no likes or comments on the update in the UI. A `work_likes.target_type` of `STATUS` exists in the schema. |
| 7 | Project settings dialog: Details, Dependencies, Scheduling, Notifications (PM §3.11) | — | PARTIAL | `app/users/work/projects/[id]/settings/page.tsx:58-131` has Members, Details, Permissions, Fields, Reuse, Lifecycle and History. Holidays are global plus per-department (Admin → Task settings, `server/work/holiday-store.ts`), not per project | **Dependencies** tab (maintain/consume buffer/none), **Scheduling** tab (per-project work days or hours; parent-date flagging) and **Notifications** tab (Slack/Teams) are missing. Per-member notification toggles are in the Share dialog (D-220). |
| 8 | Project permissions and share (PM §3.12-3.13) | PRJ-18, PRJ-19 | EXISTS | Roles OWNER/EDITOR/COMMENTER/VIEWER with highest-wins ranking (`server/work/access.ts:5,25-27`). Privacy PRIVATE/DEPARTMENT/ORGANISATION. Field-level and sharing permissions in `projects.permissions_json` (`202610301600_task_kinds_permissions.sql`; `service.ts:956-979`). `features/work/ShareDialogs.tsx`, `PermissionsPanel.tsx` | Teams are replaced by departments. No guests (IDN-14). No read-only share links (PRJ-25). No access requests (PRJ-29). |
| 9 | Archive, delete, restore (PM §3.21, §5.4) | PRJ-23, PRJ-24 | EXISTS | `service.ts:217-238 setProjectLifecycle` (owners only; restore by an owner or the deleter). 30-day deleted list `lib/db/repositories/work.repository.ts:919`. Page `app/users/work/deleted/page.tsx` | No purge job after 30 days: rows stay soft-deleted forever. See BR-DEL-002. |

### 2.2 Tabs, toolbar, sections, views

| # | Area (spec §) | Feature ID | ARS-CMS | Evidence | What's missing |
|---|---|---|---|---|---|
| 10 | Tab strip and saved views (PM §3.7) | PRJ-15 | PARTIAL | Fixed tabs Overview, List, Board, Timeline, Calendar (`projects/[id]/page.tsx:32-38,165-190`). Saved **List** tabs in `work_views` (`202610301400_work_views.sql`; repository `work.repository.ts:1102-1125`, cap 30 at :1111). Options panel: Save as new tab, Delete tab (D-220) | No Add-tab catalog. Saved tabs are List only, not Board or Calendar. No tab menu (rename inline, set as default per tab, make a copy, reorder). Cap is 30, not 50. Tabs can't be removed or hidden per project. |
| 11 | View toolbar: filter, sort, group, options, search (PM §3.8) | PRJ-04 | EXISTS | `server/work/grid.ts:24 SORTS`, `:43 GROUPS`, `:46 FILTER_FIELDS`; toolbar in `features/work/TaskGrid.tsx`; Board/legacy toolbar `ProjectWorkspace.tsx:255-353` | No filter, sort or group by **custom field**. No subgroups. No "Just my tasks" quick filter (assignee filter exists). No period navigation or zoom (no time views that need it). |
| 12 | Sections and section menu (PM §3.9) | PRJ-17 | EXISTS | `service.ts:241-288` (add, rename, reorder; delete moves tasks to a chosen section and keeps at least one). `ProjectWorkspace.tsx:705-845` (header, add section, paste many lines) | No Duplicate section, no "Add automation to section", no "Hide all empty groups". |
| 13 | Overview tab (PV §1) | PRJ-10 | EXISTS (basic) | `projects/[id]/page.tsx:283-375`: description (rich text), owner, start and due dates, milestones, status updates, members | No project roles or labels, brief (PRJ-28), goals, key resources or links, or connected portfolios. |
| 14 | List view (PV §2) | PRJ-03 | EXISTS | Shared grid `features/work/TaskGrid.tsx` (numbered rows, tick, subtask and comment counts, inline due, assignee and priority editors in `GridCellEditors.tsx`, project field columns, show/hide columns, resizable columns `useColumnWidths.ts`, bulk bar `MoreParts.tsx BulkBar`). Drag or Alt+↑/↓ only when unsorted (`ProjectWorkspace.tsx:160`) | Subtasks don't expand inline in the grid (counts only). No "Add field" from a column header (fields are added in settings). |
| 15 | Board view (PV §3) | PRJ-05 | EXISTS | `ProjectWorkspace.tsx:360-412` (section columns, drag cards between and within columns, add section, column accents `kanban.ts`) | Columns are sections only (no board grouped by a field). No column collapse. No card field display options or card cover. No per-column add-task-at-top / WIP. |
| 16 | Calendar view (PV §6) | PRJ-06 | EXISTS | `features/work/TaskCalendar.tsx:1-148` (month grid by due date, drag to re-date, + on a day adds a task, "No date (N)" list, holidays) | Month only: no week view. No multi-day spans for start→due. No filters or saved Calendar tabs. |
| 17 | Timeline view (PV §4) | PRJ-07 | PARTIAL | `features/work/Timeline.tsx:1-91` is read-only: bars from start to due grouped by section, milestone diamonds, today line, lock icon for blocked tasks | No drag, move or resize. No zoom or units, no period navigation. No dependency connectors. No unscheduled-task tray. No colour-by-field. Capped at 366 days. |
| 18 | Gantt view (PV §5) | PRJ-08 | MISSING | No Gantt tab; `projects.default_view` ENUM has no GANTT (`202610301000_work_management.sql:53`) | Whole view: grid plus chart, zoom, today line, connectors, baseline, critical path, chain dependencies. |
| 19 | Dashboard and chart builder (PV §7) | PRJ-09 | MISSING | Only header counts (`projectCounts`) and status snapshots. Org-wide Analytics exists elsewhere but has no project dashboard | Per-project dashboard, the 9 chart styles, the chart builder (data source, axes, metrics, filters), roll-ups, text widgets. |
| 20 | Workload (PV §8) | PRJ-14 | MISSING | Only Home's "My team" counts table `features/work/TeamWorkloadTable.tsx` (open/overdue/done per person) and approval workload (F-91) | Per-project workload grid by person over time, capacity, effort metric. PLAN-CHECKLIST PB-78 marks workload "not planned unless asked". |
| 21 | Files tab (PV §9) | PRJ-12 | MISSING | Task attachments exist (`TaskDetail.tsx:324-327`, comment files) but nothing aggregates them per project | Project Files tab: tiles or list, filter, sort, group. |
| 22 | Messages tab (PV §10) | PRJ-11, COL-05 | MISSING | Only task comments and project status updates | Project conversations (messages to project members, threads, likes). |
| 23 | Page tab (PV §11) | PRJ-13 | MISSING | — | Rich-text project page with auto-save and version history. |

### 2.3 Tasks inside projects

| # | Area (spec §) | Feature ID | ARS-CMS | Evidence | What's missing |
|---|---|---|---|---|---|
| 24 | Task pane and full page (PV §13) | TASK-26 | EXISTS | Modal pane `features/work/TaskPane.tsx:11-40` (Esc, Open full page). Full page `app/users/tasks/[id]/page.tsx` with `TaskDetail.tsx` (Mark complete, Share, copy link) and `TaskWorkPanel.tsx` (projects with section, subtasks, "waits for" dependencies, tags, followers). Comments and All activity tabs `TaskActivity.tsx:8,130`. Likes on tasks and comments `CommentThread.tsx:118` | The pane is a centred modal, not a 440 px side pane. No emoji reactions (likes only). "More actions" lacks merge duplicates, convert to, follow-up task, duplicate task with component choice (TASK-17/22/23), print and make public. |
| 25 | Completion behaviour and celebrations (PV §14) | TASK-05 | PARTIAL | Round tick on every row with an Undo toast `features/work/client.tsx:76-93`. `service.ts:472-483 toggleComplete` (a type may require a completion note or file). Recurring spawn and dependents notified on completion (`server/work/on-complete.ts:34-85`) | No completion animation spec timings and **no celebrations** (no celebration setting or creature/flyover). The only confetti is in the approval journey, `features/journey/ARSApprovalJourney.tsx`. No Ctrl+Enter complete verified. |
| 26 | Dates (PV §15) | TASK-04 | EXISTS | `tasks.due_at` DATETIME plus `starts_on` DATE (`202610160900_v190.sql:59-60`). Start ≤ due `service.ts:549-551`. Milestones can't have a start `service.ts:520,541`. Holiday prompts `service.ts:543-547` | **Due date is mandatory** (D-316; `service.ts:512`, quick add defaults to today 23:59). No start *time*. No natural-language typed dates. |
| 27 | Recurrence (PV §15) | TASK-19 | PARTIAL | `server/work/more-rules.ts:7-100` DAILY/WEEKLY (weekdays)/MONTHLY (anchor day)/YEARLY/AFTER_DONE. Next instance made on completion `on-complete.ts:70-85` (rule moves to the new task, holidays skipped). Admin on/off switch | Only for tasks you assign to yourself (`service-more.ts:62`, D-313). No "monthly on the 2nd Tuesday". No custom or RRULE. No parent+subtask duplication warning (BR-REC-003). |
| 28 | Dependencies: blocked by / blocking (PV §16.2) | TASK-09 (FS) | PARTIAL | Table `task_dependencies(blocker_task_id, blocked_task_id)` with no type column (`202610301000_work_management.sql`). `service.ts:790-817 setDependency` (by task number; refuses its own family; cap 30 combined `work.repository.ts:619-621`; loop check `rules.ts:30-46`). Assignee told when the last blocker completes `on-complete.ts:45-53` | Added by typing a task **number**, not a typeahead across projects. No Blocked by / Blocking columns in List. Not drawn on Timeline. |
| 29 | Dependency types FS/SS/FF/SF | TASK-09 | MISSING | No type or lag column; everything is finish-to-start ("waits for") | Type enum, edit-dependency dialog, `lag_days`. |
| 30 | Auto-shift of dependent dates (PV §16.4-16.5) | TASK-10 | MISSING | No shift code. Only holiday or out-of-office date moves (`service.ts:882-940`) | Maintain/consume/none modes, BFS shift in work days, preview/confirm dialog, conflict flagging, successor notice on predecessor date change. |
| 31 | Multi-homing (≤ 20 projects) | TASK-07 | EXISTS | `task_projects` PK (task_id, project_id) with one section; `MAX_PROJECTS_PER_TASK = 20` `rules.ts:16`, enforced `service.ts:450-456` | Work-step tasks (approval mirrors) can't join projects (D-271 QA-SEC-05). |
| 32 | Subtasks (≤ 5 levels) | TASK-08 | EXISTS | `MAX_DEPTH = 5` `rules.ts:15`; `subtaskProblem` `rules.ts:22-27`; quick add `service.ts:337`; re-parent `service.ts:566-594`; Add subtask opens Create task (D-364) | Subtasks don't inherit first-level custom fields (BR-SUB-003). |

### 2.4 Customization

| # | Area (spec §) | Feature ID | ARS-CMS | Evidence | What's missing |
|---|---|---|---|---|---|
| 33 | Custom fields (PC §8) | AUTO-01/02/03, TASK-11 | PARTIAL | `project_fields` (kind ENUM TEXT/NUMBER/SELECT/DATE, name VARCHAR(60), options JSON) plus `task_field_values.value VARCHAR(500)` (`202610301200_work_more.sql:22-50`). `FIELD_KINDS` `more-rules.ts:104`. Limits 20 fields and 30 options `more-rules.ts:107-108`. `service-more.ts:89-131` add, remove, set (checked by kind; Project permissions can lock a field) | **4 of 11 types** (table below). Project-local only: no org field library. Fields can't be edited (rename, options, colours). No number format or decimals. No field-change notifications. No 30-day field restore. No sort, filter or group by field. Limits 20/30 vs spec 150/500. |
| 34 | Automations / rules (PC §2) | AUTO-04, AUTO-05 | MISSING | No rule tables or builder in `server/work` or `features/work`. Only system jobs (digest, reminders, recurrence) | Trigger, condition and action builder, section rules, run log, failure notice, 50-per-project limit. PLAN-CHECKLIST PB-78 says "rules builder: not planned unless asked". |
| 35 | Task types and task templates (PC §6) | TASK-06, TASK-25 | PARTIAL | Form-based task **types** (Admin → Task types; `module_types`/`module_type_versions`, `tasks.type_version_id`; General type `service.ts:315-320`, D-215). Milestone flag `tasks.is_milestone`. Periodic / ad hoc kind (D-219/D-222). Approval link `features/work/ApprovalLink.tsx` | **No custom statuses per type**: `tasks.status` is a fixed ENUM OPEN/IN_PROGRESS/BLOCKED/COMPLETED/CANCELLED. No per-project task-type set or default type. No Approval task type with approve, reject or request changes (approvals live in the separate engine). No task templates. |
| 36 | Status templates (PC §7) | — | MISSING | — | Reusable status-update layouts. Bundles are out of scope per MVP_SCOPE. |

(The Customize panel itself (PC §1) is a link to `settings#fields`, `ProjectHeader.tsx:114`. Forms, Emails and Apps sub-panels are missing and outside the requested list.)

### 2.5 Custom field types (spec PC §8.5: 11 types)

| Type | ARS-CMS | Note |
|---|---|---|
| Single-select | EXISTS | `SELECT` "Choice"; ≥ 2 options, ≤ 30, 60 chars each (`more-rules.ts:107-112`); no option colours, no reorder after creation |
| Multi-select | MISSING | — |
| Date | EXISTS | `DATE` |
| People | MISSING | — |
| Reference | MISSING | — |
| Lookup | MISSING | — |
| Text | EXISTS | ≤ 500 chars (`more-rules.ts:121`) |
| Number | PARTIAL | Parsed leniently (₹, spaces; D-234) but no format (percent, currency, custom label) or decimal places |
| Formula | MISSING | — |
| ID | MISSING | Tasks already carry a system `task_no` (`tasks.task_no`), but there is no per-field prefix ID |
| Timer / time tracking | MISSING | — |

## 3. Business rules (BUSINESS_RULES.md, 78 rules)

Legend: **Enforced**, **Partly**, **Not**, **N/A** (not applicable to ARS's single-organisation model or out of this module), **Differs** (enforced, but to a deliberately different ARS rule).

### 3.1 Tasks, assignment, dates

| Rule | Status | Evidence / note |
|---|---|---|
| BR-TASK-001 Complete | Enforced | `service.ts:472-483`; a type may require a completion note or file |
| BR-TASK-002 Reopen | Enforced | `toggleComplete` reopens; Undo toast `client.tsx:93` |
| BR-TASK-003 Unnamed tasks discarded | Enforced (refused, not discarded) | `service.ts:312` "Write the task's name"; `:534` "A task needs a name" |
| BR-TASK-004 Workspace fixed | N/A | Single organisation |
| BR-TASK-005 Merge duplicates | Not | — |
| BR-TASK-006 Task types | Partly | Form types and milestone; no custom statuses or approval type (see #35) |
| BR-ASGN-001 Zero or one assignee | **Differs** | Exactly one: `tasks.assignee_id NOT NULL` (`202610160900_v190.sql:57`); D-215 "every task keeps one assignee". Ad hoc to many makes one copy each (D-222) |
| BR-ASGN-002 Assignment notifies and lands in My Tasks | Enforced | `rules.ts:63-80` RECENT bucket (3 days); task messages |
| BR-ASGN-003 Who may change assignee | Differs | D-222: an ad hoc task's creator (and IT); periodic: creator, assigner, project editors |
| BR-DATE-001 Due date or date-time | Enforced, but **mandatory** | `dueFromDay` with 23:59 default; `service.ts:512` refuses removal (D-316) |
| BR-DATE-002 Start dates are paid | N/A | No tiers |
| BR-DATE-003 Milestones have no start date | Enforced | `service.ts:520,541`; templates `service-more.ts:251` |
| BR-DATE-004 Start ≤ due | Enforced | `service.ts:549-551` (India day comparison) |

### 3.2 Sections and projects

| Rule | Status | Evidence / note |
|---|---|---|
| BR-SECT-001 One section per task per project | Enforced | `task_projects` PK (task_id, project_id) with a single `section_id` |
| BR-SECT-002 Manual ordering | Enforced | `rules.ts:6-12 positionBetween`; `service.ts:402 moveInProject` |
| BR-SECT-003 No drag when sorted | Enforced (broader) | `ProjectWorkspace.tsx:160,353`; D-220 "dragging only with sections, no sort and no filter" |
| BR-SECT-004 Section deletion | Enforced (variant) | `service.ts:266-284`: tasks move to a chosen section; the last section can't go |
| BR-SECT-005 "Recently assigned" undeletable | Enforced | `my_task_sections.system_key` (RECENT/TODAY/UPCOMING/LATER, plus OVERDUE D-225); fixed sections D-313 |
| BR-SECT-006 View preference persistence | Partly | Saved tabs (`work_views`); grid config per tab; no auto-saved per-user project view prefs |
| BR-PRJ-001 Privacy levels | Enforced (departments for teams) | `projects.privacy` PRIVATE/DEPARTMENT/ORGANISATION |
| BR-PRJ-002 Highest permission wins | Enforced | `access.ts:5,25-27` |
| BR-PRJ-003 Default role on join; creator admin | Enforced | `projects.default_access_role`; creator OWNER; join `service.ts:193` |
| BR-PRJ-004 Admin-only actions | Enforced | `service.ts:228` owners archive/delete; settings/permissions owner-only |
| BR-PRJ-005 Access requests | Not | — |
| BR-PRJ-006 Guests | N/A / Not | No guest accounts |

### 3.3 Subtasks, multi-homing, dependencies, recurrence

| Rule | Status | Evidence / note |
|---|---|---|
| BR-SUB-001 Max depth 5 | Enforced | `rules.ts:15,25`; `service.ts:337` |
| BR-SUB-002 Subtasks inherit no projects, tags or assignee | Enforced (by construction) | Quick add takes its own `projectId` and `assigneeId` (default the creator), `service.ts:322-341` |
| BR-SUB-003 First-level subtasks inherit fields | Not | — |
| BR-SUB-004 Re-parenting constraints | Enforced | `rules.ts:22-27 subtaskProblem` (self, loop, depth) |
| BR-SUB-005 Assigned commenters may add subtasks | Partly | The parent's assignee may add subtasks, `service.ts:336` |
| BR-SUB-006 Parent and subtask completion independent | Enforced | No completion cascade in `on-complete.ts` |
| BR-MH-001 ≤ 20 projects per task | Enforced | `rules.ts:16`; `service.ts:450-456` |
| BR-MH-002 Highest permission across projects | Enforced | `access.ts:82 bestProjectRole` |
| BR-MH-003 Multi-homing widens visibility and fields | Enforced | One visibility rule over all the task's projects (D-215 §7); fields keyed by each project |
| BR-DEP-001 Types and defaults (FS default) | **Not** | FS only, no type column |
| BR-DEP-002 Dependent-assignee notification | Partly | On the last blocker's completion only (`on-complete.ts:45-53`); no notice on a predecessor date change |
| BR-DEP-003 Auto-shifting | Not | — |
| BR-DEP-004 Cycles and limits | Enforced | Loop DFS `rules.ts:30-46`; ≤ 30 combined `work.repository.ts:619-621`; family refused `service.ts:807` |
| BR-REC-001 Completion creates next instance | Enforced | `on-complete.ts:70-85` (same transaction; rule moves forward) |
| BR-REC-002 Periodic counts from completion | Enforced | `AFTER_DONE` `more-rules.ts:89-90` |
| BR-REC-003 Parent+subtask exponential warning | Partly | Cloned subtasks get `recurrence: null` (`on-complete.ts:127`), so no explosion, but there is no warning and subtasks can still be given their own rule |

### 3.4 Custom fields, comments, notifications

| Rule | Status | Evidence / note |
|---|---|---|
| BR-CF-001 Limits 150 / 60 / 500 | Partly (stricter) | 20 fields per project, 30 options (`more-rules.ts:107-108`). Name 60 and value 500 match. No per-task 60 cap (not needed at 20) |
| BR-CF-002 Removed option semantics | Not | Options can't be edited after creation |
| BR-CF-003 Removing a field keeps values | Enforced | Soft delete `work.repository.ts:976-978`; `task_field_values` untouched |
| BR-CF-004 Field deletion 30-day recovery | Not | No restore path |
| BR-CF-005 Read-only/restricted values | Partly | Project permissions lock a field to admins or editors (`service-more.ts:124-125`, D-222); no formula or ID read-only types |
| BR-CF-006 Field-change notifications | Not | Only a `FIELD_SET` task event |
| BR-CMT-001 One-level replies | Enforced | `service.ts:~707` "Reply to the first comment of the thread" |
| BR-CMT-002 Author edits/deletes | Enforced | `changeComment` `service.ts:741` (IT removal audited, D-215) |
| BR-CMT-003 Deleted comment placeholder | Enforced | `task_comments.deleted_at`; `CommentThread` renders deleted |
| BR-CMT-004 Visibility, posting, pinning | Enforced | `is_pinned`; roots sorted pinned-first `CommentThread.tsx:35` |
| BR-NTF-001 No self-notify | Enforced | e.g. `service.ts:556` notifies only when the assignee ≠ actor |
| BR-NTF-002 Triggers and recipients | Partly | Assignment, due change, unblocked, mentions, comments; no field or status-subscription matrix |
| BR-NTF-003 Email suppression by archiving | Not verified | Inbox archive exists (`notifications.archived_at`) |
| BR-NTF-004 Email batching | Partly | Daily morning summary (D-218); no batching window |
| BR-NTF-005 Inbox archive horizons | Not verified | — |
| BR-NTF-006 Deleted-project emails can't be disabled | Not verified | — |
| BR-NTF-007 @mention semantics | Enforced (variant) | People who can't see the task become followers unless unticked (D-215 §4) |
| BR-NTF-008 Daily summary | Enforced | `work_digest_sends`; WORK_TASK_DIGEST (D-218) |

### 3.5 Deletion, automations, forms, approvals, sync

| Rule | Status | Evidence / note |
|---|---|---|
| BR-DEL-001 Task delete, undo, 30-day recovery | Partly | Soft delete with subtasks `service.ts:614-646`; restore within 30 days `work.repository.ts:912`. **No ~15 s undo toast on delete. No purge job.** Delete also flips open tasks to CANCELLED |
| BR-DEL-002 Project deletion and recovery | Partly | `service.ts:217-238`; 30-day list `work.repository.ts:919`; **no purge** |
| BR-DEL-003 Complete vs archive vs delete | Enforced | Distinct: status COMPLETE (`completed_at`), `archived_at`, `deleted_at` |
| BR-AUTO-001…009 | Not | No automation feature |
| BR-FORM-001…003 | Not | Task-type forms exist, but there are no public or intake forms that create tasks in a project |
| BR-APPR-001 Approval outcomes | N/A / Differs | Approvals are the separate approval engine (D-001), not a task type |
| BR-SYNC-001 Real-time propagation | Partly | 30 s polling while visible (`ProjectWorkspace.tsx:847-848`; D-215 "no sockets on cPanel") |
| BR-SYNC-002 Concurrent edits | Partly | `row_version` optimistic locking on tasks and projects (D-246 DB-001) |
| BR-SYNC-003 Integration delivery | N/A | No webhooks or API for work items |

## 4. Conflicts with ARS-CMS decisions (DEVELOPMENT-MEMORY.md)

| Spec expectation | ARS decision | Impact |
|---|---|---|
| Zero or one assignee (BR-ASGN-001, TASK-03) | Exactly one assignee, defaulting to the creator (D-215 §1; `assignee_id NOT NULL`) | Keep ARS's rule. Note "Differs" in any acceptance test. |
| Dates optional (TASK-04) | Due date mandatory; quick add defaults to today 23:59 (D-316) | Timeline, Gantt and Calendar "unscheduled" trays will always be empty. Auto-shift design must respect "can move, can't remove". |
| Recurrence on any task (TASK-19) | Only tasks assigned to oneself repeat; reassigning clears the rule (D-313) | A spec-faithful recurrence editor would break D-313. |
| Approval as a task type (TASK-06, TASK-27, BR-APPR-001) | One configurable approval engine (D-001). Approval work-step tasks can't join projects (D-271 QA-SEC-05) | An "Approval" task type should link to the engine, not duplicate it. |
| Teams and team privacy (IDN-11, PRJ-18) | Departments plus the multi-level reporting hierarchy (D-215, D-216). Managers see their team's tasks and projects | Visibility is wider than Asana's (the hierarchy sees everything below). Permission-leak tests (DoD-3) must be written against ARS's rule. |
| Real-time WebSocket sync (COL-07) | 30 s polling; cPanel hosting has no sockets (D-215) | Can't be met as specified on current hosting. |
| Field limits 150 / 500, tabs 50 | 20 fields, 30 options, 30 saved tabs (`more-rules.ts:107-108`, `work.repository.ts:1111`) | The limits are tighter on purpose; raise them only if asked. |
| Tasks soft-deleted 30 days then purged (DoD-9) | Delete = cancel + `deleted_at`; restorable 30 days; no purge found | A purge job would be new, and must respect the Admin Records and retention rules (`server/ops/security-retention.ts`). |
| Projects available to MVP users | `PROJECT` module exists but **nobody has it until IT switches it on** (D-307, migration `202611111300_project_module.sql`) | Every Projects gap above is behind an unreleased module switch. |

Other observations:
- PLAN-CHECKLIST `PB-78` lists "saved view tabs" as "not planned unless asked", but saved tabs were built in D-220 (`work_views`). The checklist line is stale.
- ARS adds things the spec lacks: holiday-aware dates with department holidays, periodic/ad hoc task kinds, given-to-many copies, Project permissions per field, and the multi-level hierarchy view.

## 5. Ten most significant gaps (by MVP/P2/P3 value and size)

1. **Gantt view** (PRJ-08): fully missing, including zoom, connectors, baseline and critical path.
2. **Dependency types and auto-shift** (TASK-09/10): FS only, no lag, no shift modes, no project Dependencies or Scheduling settings, no predecessor-date notices.
3. **Automations / rules builder** (AUTO-04/05): nothing exists; PB-78 deferred it.
4. **Custom fields depth** (AUTO-01/02/03): 4 of 11 types; no edit or option management, no library, no field sort, filter or group, no field notifications or restore.
5. **Project Dashboard and charts** (PRJ-09).
6. **Interactive Timeline** (PRJ-07): read-only today; no drag, resize, zoom or dependency lines.
7. **Workload** (PRJ-14), per project.
8. **Files, Messages and Page tabs** (PRJ-11/12/13).
9. **Tab management** (PRJ-15): add-tab catalog, rename, reorder, set default, copy; saved tabs for Board and Calendar.
10. **Task types with custom statuses, plus status templates** (TASK-06, PC §6-7). The fixed status ENUM blocks per-type workflows.

Runners-up: project import/export (PRJ-26); template gallery; celebrations; 30-day purge job; delete-undo toast; emoji reactions.
