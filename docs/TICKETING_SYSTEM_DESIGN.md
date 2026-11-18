# Ticketing System: Phase 2 design (for owner approval, 18 Nov 2026)

Based on the Phase 1 audit (TICKETING_SYSTEM_CURRENT_STATE.md, GAP_ANALYSIS.md) and the owner's answers of 18 Nov 2026 (D-327):

| Question | Owner's answer | Effect on the design |
|---|---|---|
| Location | Drop it | No location field, no location dashboards or routing |
| Coordinator routing | Drop it | **Interpreted as:** no routing rules. Each category has its own coordinator list; all are notified and any of them can act. *Correct this if you meant something else.* |
| 4 working days | Whole working days | India time, Working Calendar (weekly offs + company holidays) |
| Who can raise | Anyone with CMS access | A feature switch `tickets`: Off → IT admins only (pilot) → On for everyone. No per-person module |
| Hardware assets | Drop it | No asset field or asset dashboards |
| Reopen | Reopen the same task | The linked task goes back to Open, same task number and history |
| Rating | 1 to 5 | Required on Confirm; an optional comment |

## 1. Building on what exists (no duplicates)

| Need | Reused as is | Extended once, for every module |
|---|---|---|
| Ticket forms | Form Builder, renderer (`DynamicFields`), checks (`parseFormSubmission`), versions | `module_types.module` gets **TICKET**. Engine extras for all modules: placeholder, max / length / pattern validation, admin option lists, Duplicate type |
| Work | Tasks (status, comments, files, subtasks, events) | `tasks.ticket_id` link; a ticket branch in `actOnTask` (like approval work steps) |
| Files | `record_files` + `/api/files/[id]` (access checks) | `entity_type` gets **TICKET**; an access branch for tickets |
| Who | users, departments, roles, admin page access | Page keys `admin.tickets` (configuration), `admin.ticket_reports` |
| When | Working Calendar | Shared helpers `addWorkingDays(date, n, calendar)` and `workingDaysBetween(a, b, calendar)` (tested; usable by tasks and approvals later) |
| Messages | `notify()`, outbox, inbox, opt-outs, delivery records | A **Tickets** category, 16 events, templates |
| Reminders | Reminders & escalations rules | `notification_rules.module` gets **TICKET** (admins add their own ticket reminders) |
| Background | Job runner (`AUTOMATIONS`) | One step: `ticketConfirmations` |
| Charts and reports | Analytics charts, report catalogue, CSV / XLSX / PDF | Ticket metrics and report definitions |
| Audit | `audit_logs`, the events-table pattern | `ticket_events` |

## 2. Data (one additive migration; rollback drops only the new tables and values)

```text
ticket_categories      id, code (IT_SW | IT_HW | ADMIN | …), name, number_prefix ('IT-SW'), number_digits (5),
                       active, position, created_by/at
ticket_request_types   id, category_id → ticket_categories, type_id → module_types (module = 'TICKET'),
                       active, position          UNIQUE(type_id)
ticket_coordinators    category_id, user_id → users, added_by/at        PK(category_id, user_id)
ticket_priorities      config in settings: LOW / NORMAL / HIGH / URGENT with response & resolution targets
                       in working days (default 1/3, 1/2, 0.5→same day/1, same day/same day)  [setting, no table]
tickets                id, ticket_no UNIQUE, category_id, request_type_id, type_version_id → module_type_versions,
                       title, form_data_json, requester_id, requester_department_id (snapshot), priority,
                       status, assignee_id, coordinator_id (who acted last), task_id → tasks (primary),
                       submitted_at, first_response_at, assigned_at, work_started_at, resolved_at,
                       confirmation_requested_at, confirm_due_on (DATE, India), closed_at, close_kind
                       (CONFIRMED | AUTO | REJECTED | CANCELLED), reopen_count, resolution_text,
                       submission_key UNIQUE(requester_id, submission_key), created/updated_at
ticket_events          id, ticket_id, actor_id, action, from_status, to_status, detail_json, internal (bool),
                       created_at      (append-only; never updated)
ticket_comments        id, ticket_id, author_id, body (rich text), internal (bool), created_at, deleted_at
ticket_feedback        ticket_id PK, rating TINYINT 1–5, comment, given_by, given_at
ticket_confirm_steps   ticket_id, cycle (reopen_count), stage (REMIND_2 | REMIND_3 | REMIND_4 | CLOSE),
                       done_at      PK(ticket_id, cycle, stage)   ← exactly-once reminders and closure
tasks.ticket_id        new nullable FK + index (subtasks inherit it)
module_types.module, record_files.entity_type, notification_rules.module, notifications.category:
                       ENUM values + 'TICKET' / 'TICKETS'
```

**Numbering:** `nextRequestNumber(prefix, digits)` (a new `digits` parameter with default 6, so approvals and tasks are unchanged) gives `IT-SW-2026-00001`, editable per category.

## 3. Statuses and who may move them (enforced on the server; every move in one transaction with the current status re-checked)

| From → To | Who | Notes |
|---|---|---|
| (new) → NEW | Requester | Number, department snapshot, form version, SLA clock starts. Coordinators notified |
| NEW → UNDER REVIEW | Coordinator (opening it) | Records the first response |
| NEW / UNDER REVIEW → WAITING FOR INFORMATION | Coordinator | Question to the requester (visible comment) |
| WAITING FOR INFORMATION → UNDER REVIEW | Requester (answers) | |
| NEW / UNDER REVIEW / REOPENED → ASSIGNED | Coordinator | Creates the linked task (first time) or reassigns it; priority and due date set |
| ASSIGNED ↔ IN PROGRESS ↔ ON HOLD | Assignee (through the task: Start / Block / Unblock) | The ticket follows the task |
| IN PROGRESS → AWAITING REQUESTOR CONFIRMATION | Assignee completes the task **with resolution notes** | Not closed. `confirm_due_on` = 4 working days later |
| AWAITING → CLOSED | **Requester only** (Confirm + rating 1–5) | close_kind CONFIRMED |
| AWAITING → REOPENED | **Requester only** (reason required) | Same task reopened (back to Open); resolution kept in history; coordinators notified |
| AWAITING → CLOSED (AUTO) | Job, after 4 full working days | close_kind AUTO |
| NEW / UNDER REVIEW / WAITING → REJECTED | Coordinator (reason) | |
| NEW / UNDER REVIEW / WAITING → CANCELLED | Requester (before assignment) | |
| any open → (reassign / priority / escalate) | Coordinator | No status change; recorded |

- **RESOLVED** is kept as a recorded moment (`resolved_at`), not a resting status. Completing the task moves straight on to AWAITING REQUESTOR CONFIRMATION.
- **Hard rules:**
  - the assignee can't confirm, even on their own ticket;
  - nobody but the requester confirms or reopens;
  - the task's own Cancel and Reassign are refused on the task side; coordinators do them on the ticket.

## 4. Permissions

| Action | Requester | Coordinator (of the category) | Assignee | Ticket admin (page access) | Super Admin |
|---|---|---|---|---|---|
| Raise (feature On) | ✓ any user | ✓ | ✓ | ✓ | ✓ |
| See the ticket | own | category's | assigned | all | all |
| Internal comments | — | ✓ | ✓ | ✓ | ✓ |
| Assign / reassign / priority / reject / ask info / escalate | — | ✓ | — | ✓ | ✓ |
| Work, resolution | — | — | ✓ (task) | — | — |
| Confirm / reopen / rate | ✓ only | — | — | — | — |
| Categories, request types (forms), coordinators, priorities, numbering | — | — | — | ✓ | ✓ |
| Reports | own | category's | own | ✓ | ✓ |

## 5. Auto-closure job (`ticketConfirmations`, every runner call)

For each ticket in AWAITING whose next stage is due (India working days from `confirmation_requested_at`):
1. `INSERT IGNORE ticket_confirm_steps (ticket, cycle, stage)`. Only the run that inserts the row continues, so a second run does nothing.
2. Working days 2 and 3: a reminder to the requester. Working day 4: the final reminder.
3. CLOSE (after 4 full working days): `UPDATE tickets SET status='CLOSED', close_kind='AUTO' WHERE id=? AND status='AWAITING_CONFIRMATION' AND reopen_count=?`. Zero rows means the requester answered first, so nothing happens. Then an event and notifications.

The requester's Confirm / Reopen uses the same conditional update, so whichever comes first wins and the other is refused politely.

## 6. SLA measures (working time from the calendar; waiting excluded)

- **First response:** submitted → first coordinator action.
- **Assignment:** submitted → assigned.
- **Execution:** work started → resolved, minus On hold.
- **Requestor waiting:** awaiting → closed or reopened; kept **separate** and never counted as execution.
- **Resolution:** submitted → resolved, minus Waiting for information and requester waiting.
- **Closure:** submitted → closed.
- **Targets** per priority (settings). Overdue = beyond the resolution target and still open. Escalation reminders use the Reminders & escalations rules (TICKET module).

## 7. Notifications (Tickets category; inbox + email + push, WhatsApp when a template exists)

| Event | To |
|---|---|
| Submitted | Requester (receipt), coordinators |
| Assigned / reassigned | Assignee (action needed), requester |
| Information requested / received | Requester / coordinators |
| Work started / on hold | Requester |
| Work completed → confirmation requested | Requester (action needed), coordinators |
| Confirmation reminders (days 2, 3, 4) | Requester |
| Confirmed and closed (with rating) | Coordinators, assignee |
| Reopened | Coordinators, assignee |
| Auto-closed | Requester, coordinators, assignee |
| Escalated | Coordinators (+ rule recipients) |
| Rejected / cancelled | Requester / coordinators |

## 8. Screens

- **Sidebar "Tickets":**
  - Ticketing Overview;
  - one group per active category: Dashboard, All tickets (coordinators and admins), My requests, Assigned to me, Pending confirmation;
  - "Raise a ticket" in the + Create menu.
- **Ticket page:**
  - header (number, status, priority, category, request type);
  - form answers (`FieldValues`), attachments;
  - actions for the viewer's role;
  - linked task;
  - comments with an Internal toggle (coordinators and assignees);
  - timeline;
  - for awaiting tickets, the auto-close date and Confirm / Reopen.
- **Admin → Tickets:**
  - Categories (prefix, digits, active, order);
  - Request types (the shared Form Builder, module TICKET, per category);
  - Coordinators per category;
  - Priorities and targets;
  - Reports.
- **Dashboards** (per category and personal):
  - KPI cards: total, new, under review, assigned, in progress, on hold, awaiting, closed, auto-closed, reopened, overdue, average first response, average resolution, SLA %;
  - monthly trend, status, priority, department, request type, assignee workload, coordinator performance, resolution trend, reopened;
  - filters: period / month / financial year, department, request type, priority, status, coordinator, assignee, requester;
  - every number opens the matching list.

## 9. Server actions (no public API)

- `raiseTicket`, `ticketAction` (one entry point, an action enum, a role check per action, the transition table above), `ticketComment`, `confirmTicket`, `reopenTicket`.
- Admin: `saveCategory`, `saveCoordinators`, `saveTicketSettings`. Request types use the existing module-type actions with kind TICKET.
- All re-check the session and the role on the server, validate input with zod, rate-limit raising (e.g. 20 an hour per person), and audit.

## 10. Rollout and rollback

- **Rollout:** one additive migration (new tables, new ENUM values, `tasks.ticket_id`). The feature switch stays **Off** until the owner chooses IT admins (pilot) or On.
- **Rollback:**
  - switch Off. Data stays; existing modules are unaffected;
  - a full rollback drops the new tables and column.
  
  ENUM values can stay, because they're unused by other modules.

## 11. Tests (beyond the existing regression suites)

- **Unit:** transitions and roles; working-day helpers (weekly offs, holidays, crossing year end); numbering digits; SLA maths with holds and waits.
- **Integration (MySQL):**
  - raise → assign (task created once) → complete (awaiting, not closed) → confirm;
  - reopen (same task) → complete → auto-close after 4 working days with holidays;
  - the job run twice (one reminder per stage, one closure);
  - a confirmation racing auto-close;
  - assignee can't confirm; a stranger can't see; forms keep their version.
- **e2e:** requester, coordinator and assignee journeys; dashboards; admin form and coordinator setup.

**Approval needed:** the coordinator interpretation (§ table at the top), priority targets (§2 defaults), and this design overall. Phase 3 starts after approval.
