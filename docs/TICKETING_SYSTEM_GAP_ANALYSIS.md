# Ticketing System: reuse-versus-build matrix and gap analysis (18 Nov 2026)

Classification used throughout:

| Code | Meaning |
|---|---|
| **1** | Available: reuse directly |
| **2** | Available with modification: extend |
| **3** | Partially available: enhance |
| **4** | Not available: build new |

The evidence is in TICKETING_SYSTEM_CURRENT_STATE.md.

## A. First deliverable: the component matrix

| Component | Expected approach | Audit result | Class | What exactly |
|---|---|---|---|---|
| Custom Approval Form Builder | Reuse and extend | **Confirmed.** The builder, renderer, validation and versions are already shared by approvals, Task types and Information types | 2 | Add **TICKET** as a third module kind (`module_types.module`, `ModuleKind`, reserved keys, admin pages). Add the missing capabilities **for every module**: placeholder, max / length / pattern validation, admin-managed option lists, duplicate whole form, archive list. No second builder. |
| Task Management | Reuse and integrate | **Confirmed.** Approval work steps already drive linked tasks (`work-mirror.ts`) | 2 | Add a `ticket_id` link on `tasks`. The coordinator's "Assign" creates one primary task (plus optional subtasks). Completing it moves the ticket to Awaiting confirmation and never closes it. Reassignment history stays in `task_events`. |
| Users & Roles | Reuse | **Confirmed** | 1 (+2) | No new auth or role system. Add a **TICKET** module to `users.module_access` (on for everyone, because anyone may raise a ticket). Coordinators and assignees come from the mappings and the task, not from new roles. Ticket administrators use admin page access, like Task types. |
| Departments | Reuse | **Confirmed** | 1 | Requestor's department and HOD come from the user record. **Location doesn't exist anywhere** (decision Q-T1). |
| Working Calendar | Reuse | **Mostly** | 3 | Reuse `isWorkingDay` / `holidayContext`. Add two shared helpers, **add N working days** and **count working days between**, which also benefit tasks and approvals. Business hours don't exist (the calendar works in whole days; decision Q-T3). |
| Reminders & Escalations | Reuse and extend | **Confirmed** | 2 | Add **TICKET** to `notification_rules.module` and the rule model, so admins configure ticket reminders and escalations on the same screen. The rule stages count clock hours, so working-day stages need the new calendar helpers. |
| Notifications | Reuse and extend | **Confirmed** | 2 | Add a **Tickets** category and the 16 ticket events to `notify()` (inbox, email, WhatsApp, push, opt-outs, delivery records). Templates go in Super Admin → Templates. |
| Dashboards | Reuse infrastructure | **Confirmed** | 1 | The Analytics charts (KPI cards, line, stacked, heatmap, bar list, click-through), periods, scopes and exports. Ticket metrics and boards are new (row "Ticket-specific Reports"). |
| Ticket Workflow | Build | Nothing to reuse except patterns | 4 | Status machine (13 statuses), allowed transitions per role, checked on the server only. Pattern: the approval and task services. |
| Ticket Coordinator Mapping | Build | Nothing similar except approver groups | 4 | Category × request type (× department, × location if Q-T1), with primary and backup coordinators. Uses existing users and departments. |
| Ticket Lifecycle | Build | — | 4 | Tickets, status history, assignments, comments (internal / requestor-visible), attachments (via `record_files`), activity timeline. |
| Requestor Confirmation | Build | — | 4 | Confirm or Reopen (reason required), optional rating and feedback. Only the requestor may act. |
| Auto Closure Engine | Build or extend scheduler | **Extend the scheduler** | 2 | One new automation step in `AUTOMATIONS`. It claims each ticket once, in a transaction with a status check, so a last-minute confirmation wins. Reminders on working days 2, 3 and 4; closes after 4 full working days. |
| Ticket-specific Reports | Build | Infrastructure exists (`reports/catalogue.ts`, CSV / XLSX / PDF) | 4 | New report definitions and metrics on the existing report and export engine. |

## B. Requirement-by-requirement

| Brief section | Requirement | Class | Notes |
|---|---|---|---|
| 2 Navigation | Ticketing sidebar module, three categories, admin pages | 2 | Same sidebar and nav lists as the other modules (`users-nav.ts`, `pages.ts`, `MODULES`). The "Coming soon" lock works automatically. |
| 3 Forms | Forms per category and request type | 2 | One **ticket type** (module type) per request type, grouped under a category. Each ticket keeps the form version it was raised with (immutable, like tasks). |
| 3 | Required / help / defaults / conditions AND-OR / attachments / versions / draft-publish / archive | 1 | Already in the engine. |
| 3 | Placeholder, field-level validation (max, length, pattern) | 3 | Added to the shared engine, so approvals, tasks and information get them too. |
| 3 | Dynamic dropdown options | 3 | New admin-managed option lists (a third LOOKUP source). |
| 3 | Duplicate a whole form | 4 | New "Duplicate type", shared by all modules. |
| 3 | Multiple attachments | 2 | Up to 5 per field (all modules). `record_files` gains `TICKET`. |
| 4 | Three independent categories, each with dashboard, list, request types | 4 | Categories are configuration data (initially IT Software, IT Hardware, Admin), not hard-coded pages. |
| 5.1 | Ticket number per category, configurable | 3 | Reuse `nextRequestNumber`; make the prefix per category configurable and allow a 5-digit counter (today it is 6 digits). |
| 5.1 | Requestor, department, location, time captured automatically | 1 / Q-T1 | Location: see Q-T1. |
| 5.2 | Coordinator review: assign, priority, internal remarks, ask for information, reject, reassign, escalate | 4 | New ticket actions. |
| 5.3 | Task created on assignment, permanent link, history | 2 | Task module plus a `ticket_id` link. |
| 5.4 | Work done in Tasks; completion asks for resolution notes; ticket → Awaiting confirmation | 2 | A ticket branch in `actOnTask` (as approvals have); task completion never closes the ticket. |
| 5.5 | Confirm / Reopen, rating | 4 | |
| 5.6 | Auto-close after 4 working days with reminders on days 2, 3 and 4 | 2 | Scheduler step plus calendar helpers; exactly-once claims. |
| 6 | 13 statuses; role-based transitions enforced on the server | 4 | |
| 7 | Requestor / Coordinator / Assignee / Ticket Admin / Super Admin | 2 | Derived from the record and mappings plus admin page access. No new auth system. |
| 8 | Three dashboards, personal dashboards, filters, click-through | 2 | Analytics infrastructure, plus ticket metrics. |
| 9 | 16 notification events, templates, delivery status | 2 | |
| 10 | SLA: first response, resolution, escalation; requestor waiting time kept apart | 4 | Timestamps per stage, and working-time maths from the calendar helpers. |
| 11 | Ticket page with timeline, internal vs requestor-visible comments | 4 | Reuses the comment and timeline components. |
| 12 | Tables only for ticket-specific entities | 4 | See TICKETING_SYSTEM_IMPLEMENTATION.md. |
| 14 | Server checks, files, audit, rate limits | 1 / 2 | Existing guards, file route, `audit_logs`, rate limiter. |
| 15 | Reports | 4 (on 1) | Report catalogue plus exports. |
| Import Data | Historical tickets | Optional | Later, through the existing import tool, if wanted. |

## C. Decisions needed from the owner before Phase 2

| # | Question | Why it matters | Suggested default |
|---|---|---|---|
| **Q-T1** | **Location:** there is no location or site anywhere in ARS CMS. Add a Locations list (admin) and a location on each user, or ask for it on the ticket form? | Location-wise dashboards, coordinator routing by site | A Locations master; a location on the user (pre-filled on the ticket, editable) |
| **Q-T2** | **Coordinator routing granularity:** category only, category + request type, or + department / location? | Mapping screen and routing rules | Category + request type, primary + backup coordinators |
| **Q-T3** | **Working time:** the calendar works in whole working days. Is "4 working days" counted in whole days (closing at the end of the 4th working day), or do you need business hours (e.g. 9:30–18:00)? | Auto-close and SLA maths | Whole working days, India time (no business hours) |
| **Q-T4** | **Who may raise tickets:** everyone (TICKET module on for all), or per person like other modules? | Module access default | On for everyone; release like other modules |
| **Q-T5** | **Hardware assets:** "asset-wise frequency" needs an asset id. There is no asset register. Capture an asset tag as a form field, or build an asset list? | Hardware dashboard | An asset tag field on hardware forms (no register now) |
| **Q-T6** | **Reopen:** reuse the same task (reopened) or create a new task? | Task history | Reopen the same task; a new task only if the coordinator reassigns |
| **Q-T7** | **Rating:** 1–5 stars with an optional comment? | Feedback reports | Yes |

## D. Risks

- **Overlapping runner calls.** The auto-close step must claim each ticket once, with a unique key and a status check in the same transaction. Tests must cover the job running twice and a confirmation arriving at the last second.
- **Form changes after submission.** Handled: tickets keep the version id, as tasks do.
- **Sync across module lists.** A new module touches about 8 lists (D-307). They are covered by existing tests, which are extended.
- **WhatsApp:** ticket messages aren't sent on WhatsApp until a template is approved and set up (existing behaviour).
