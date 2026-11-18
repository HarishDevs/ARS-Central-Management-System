# Ticketing System: current state of ARS CMS (audit, 18 Nov 2026)

This audit reads what ARS CMS already has before any ticketing code is written. Every statement points to the code that shows it (paths are from the repository root; `:n` is a line number). Nothing was changed during the audit.

## 1. Form engine ("Custom Approval Form Builder"): already generic

**The headline finding.** The builder is not tied to approvals. It already serves three consumers through one engine: custom approvals, **Task types** and **Information types**.

| Part | Where | Notes |
|---|---|---|
| Field model | `server/forms/fields.ts:15,42-77` | 17 types: Short text, Long text, Number, Date, Dropdown (CHOICE), Person, Department/Designation (LOOKUP), Calculation (CALC), Line items, Section, Attachments, Currency, Date and time, Multi-select, Checkbox, Radio, Web link. Field properties: key, label, type, required, options, option colours, help, min, showIf, requiredIf, formula, decimals, defaultValue, neededBy, maxFiles (1–5), confidential, listed, searchable, editable. At most 40 fields. |
| Conditions (AND/OR) | `server/conditions/rule.ts:19-44`, `server/forms/dynamic.ts:256` | A single rule, or groups matching ALL / ANY. Operators: EQ, GT, IN, CONTAINS, IS_EMPTY, … Used for "show if" and "required if". |
| Calculations | `server/forms/dynamic.ts:40,193,235` | Safe formula parser (no eval), line-item money in paise, dependency order, loop detection. |
| Server validation | `parseFormSubmission`, `fields.ts:183-330` | Types, lengths, min, options, active people, live lookups, recalculation, hidden fields cleared, required / required-if. Used by approvals (`server/approvals/service.ts:344,724`), tasks (`server/modules/tasks.ts:146,334`) and information (`server/modules/information.ts:82,249`). |
| Builder UI | `features/admin/FormFieldsEditor.tsx:98`, `features/admin/form-designer/*`, `FieldProperties.tsx:34` | Field library, canvas, properties (General / Validation / Conditions / Advanced), reorder (drag or Alt+↑/↓), duplicate field, delete with confirm, undo/redo. Mounted at `/admin/custom-approval`, `/admin/task-types/[id]` and `/admin/information-types/[id]` (`ModuleTypeScreens.tsx`, `ModuleTypeEditor.tsx`). |
| Filling a form | `features/requests/DynamicFields.tsx:28` | Generic despite its folder; already used by Information, the type editor preview and Custom approval. |
| Showing answers | `FieldValues` in `features/modules/RecordParts.tsx:9` (generic); `RequestDetails.tsx` (approval-only) | |
| Storage and versions (modules) | `module_types(module ENUM('TASK','INFO'))` + `module_type_versions(DRAFT/PUBLISHED/ARCHIVED, form_json, settings_json)` (`database/migrations/202610160900_v190.sql:8-44`); `lib/db/repositories/module-types.repository.ts` | One published version per type (generated unique column). Publishing archives the old version. Every record keeps its **immutable version** (`tasks.type_version_id`, `info_items.type_version_id`, NOT NULL foreign keys) and its answers (`form_data_json`). |
| Storage (approvals) | `workflow_versions.form_json`; custom approvals: `custom_approval_settings` | Each request keeps `workflow_version_id`. |
| Per-module rules | `server/modules/settings.ts:8,141-171` | `ModuleKind = "TASK" \| "INFO"`; reserved keys per module; 30-field limit; no line items outside approvals; per-module settings in `settings_json`; who may create (`mayCreate`: everyone / departments / people). |
| Admin rights and audit | `server/admin/actor.ts:11`, `server/modules/config.ts:54-167` | Page-key rights; every draft, publish, retire and reactivate is audited in a transaction. |

**Not available yet:**
- placeholder text;
- max, regex and length validation;
- dropdown options from an admin-managed list (LOOKUP only knows Department and Designation);
- duplicating a whole form or type;
- category → request-type grouping;
- `record_files` (the file store for module records) only accepts `TASK` and `INFO`.

## 2. Tasks: reusable, with a proven pattern for "another record drives a task"

- **Task data:**
  - `tasks` (`v190.sql:48`): statuses OPEN, IN_PROGRESS, BLOCKED, COMPLETED, CANCELLED.
  - Subtasks (`parent_task_id`, up to 5 levels), followers, dependencies, comments (`task_comments`), files (`record_files`), events (`task_events`).
  - Reassignments are recorded as events.
- **Creating a task from code:** `insertTask` + `appendTaskEvent` (`lib/db/repositories/tasks.repository.ts:162,194`), or `quickAddTask` (`server/work/service.ts:308`) / `createTask` (`server/modules/tasks.ts:101`). Numbers come from `nextRequestNumber(prefix)` (`approvals.repository.ts:274`), giving `PREFIX-YEAR-000001`.
- **Precedent:** approval work steps create and keep in step a linked task (`server/approvals/work-mirror.ts:32`, D-269/D-273). A task linked this way completes the approval step when it is ticked (`actOnTask`, `server/modules/tasks.ts:243-267`), and it refuses actions that would break the link. Meetings link tasks too (`tasks.meeting_id`).
- **Gap:**
  - the only typed link is `related_request_id` (to approvals); tickets need a `ticket_id` link;
  - there is no general "on task completed" hook registry, so a ticket branch is added the same way approvals did it;
  - `afterTaskCompleted` (`server/work/on-complete.ts:32`) is the shared place to add it.

## 3. Scheduler: reusable

- cPanel cron → `POST /api/jobs/run` (secret header) → `runAutomations()` → heartbeat (`app/api/jobs/run/route.ts:23`).
- New jobs are one entry in `AUTOMATIONS` plus a function in `STEPS` (`server/ops/automation.ts:46,323`; precedent `workTasks` at `:281,348`). Each run is logged in `job_runs`, and health shows Late / Failing.
- **Overlapping runs aren't blocked**, so every step must claim its work once:
  - unique keys (`task_item_reminders`, `notification_rule_sends`);
  - `FOR UPDATE SKIP LOCKED`.
  
  The auto-close job must follow this pattern.

## 4. Working calendar: reusable, needs two small functions

- `server/workflows/calendar.ts`: `isWorkingDay` (`:22`), `addWorkingHours` (`:29`). Days are whole days in India time; non-working days are skipped.
- `server/work/holidays.ts`: `nearestWorkingDay`, `checkHoliday`. `server/work/holiday-store.ts`: `holidayContext` (company holidays, department holidays, and the person's out-of-office days).
- Weekly offs are one company setting (`calendar.working_days`); holidays can be per department.
- **Missing:**
  - "add N working days" and "count working days between two dates";
  - business hours (the calendar works in whole days);
  - any time zone other than India time.

## 5. Reminders & Escalations: reusable, needs a TICKET kind

- Admin → Reminders & escalations manages `notification_rules`:
  - conditions on standard and form fields;
  - stages anchored to Started / Raised / Due, with offset, repeat, maximum and recipients;
  - sent once per stage through `notification_rule_sends` (`server/notifications/rule-model.ts:12`, `rule-runner.ts`).
- **Limits:** `module ENUM('APPROVAL','TASK')` (`202610281200_notification_rules.sql:9`), and times count clock hours, not working days.
- The built-in approval response-time reminders (`server/jobs/sla.ts`) and task due reminders (`server/modules/jobs.ts:20`) are each specific to their own module.

## 6. Notifications: reusable directly

- `notify()` (`server/notifications/notify.ts:272`): inbox row, email, WhatsApp and push; opt-outs; do-not-disturb; outbox inside the business transaction; delivery records (`notification_deliveries`); retries.
- **Adding ticket events touches:**
  - `server/notifications/categories.ts`: a new category and its link pattern;
  - a migration for the `notifications.category` ENUM;
  - `preferences.ts` (event groups);
  - push urgency;
  - WhatsApp templates. WhatsApp is skipped until a template exists.
- Admin → Notifications is for broadcasts. Message templates are edited in Super Admin → Templates.

## 7. Users, roles, departments, module access: reusable

- **Roles:** SUPER_ADMIN, IT_ADMIN, USER, EXPORTER (`types/auth.ts:1`).
- **Modules:** per-person `users.module_access` SET, currently APPROVAL, TASK, PROJECT, INFORMATION, AI, MEETING (`202611111300_project_module.sql:11`).
- **Locked modules:** a module not switched on shows as "Coming soon" (D-307).
- **Pages:** each page declares its module (`server/authorization/pages.ts`). People involved in a record can open it without the module (`partyOpen`).
- **Departments:** HOD on `departments.hod_user_id`. Users carry department, designation and reporting manager.
- **Gap:** **no location / site / branch field exists anywhere.** The Hardware and Admin dashboards ask for location-wise views.

## 8. Dashboards, reports, attachments, audit: reusable

- **Charts:** `features/analytics/Charts.tsx`: KPI cards, line charts, bar lists, stacked bars, heatmaps, all with click-through links. These are the same charts as the Message deliveries dashboard (v1.54.16).
- **Metrics and scope:** `server/analytics/metrics.ts`, `scope.ts`, `periods.ts`.
- **Reports and exports:** `server/reports/catalogue.ts` + `export.ts` (CSV, XLSX, PDF; background exports).
- **Files:** `record_files` + `server/modules/files.ts` + `/api/files/[id]` (sign-in, rate limit, access check per entity, 404 when refused, audited). Needs a `TICKET` entity type and an access branch.
- **Audit:** `audit_logs` (append-only by database trigger) and per-record event tables (the `task_events` pattern).
- **Caveat:** the triggers that make the event tables append-only are optional on hosted MySQL, so append-only is guaranteed by the code there.

## 9. Conclusion

ARS CMS already has every shared capability the brief lists. **Ticketing should be a third "module kind" beside Task types and Information types**, so the Form Builder, versions, validation, renderer, files, tasks, scheduler, calendar, notifications, rules, roles and charts are all reused, not copied. What is genuinely new is the ticket itself: its lifecycle, coordinators, confirmation, auto-closure, SLA measures, dashboards and reports. See TICKETING_SYSTEM_GAP_ANALYSIS.md.
