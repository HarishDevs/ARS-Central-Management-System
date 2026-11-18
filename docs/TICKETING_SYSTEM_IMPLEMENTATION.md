# Ticketing System: implementation plan (draft for approval, 18 Nov 2026)

Status: **Phase 1 (audit) delivered.** Phases 2–7 start after the owner answers the decisions in TICKETING_SYSTEM_GAP_ANALYSIS.md §C.

## Architecture in one picture

```text
                ┌───────────────── Shared engines (reused, extended once for every module) ─────────────────┐
                │ Form Builder + versions (module_types: TASK · INFO · TICKET) · record_files · notify()     │
                │ Reminders & escalations rules (APPROVAL · TASK · TICKET) · job runner · working calendar  │
                │ users / departments / module access · Analytics charts · report & export engine · audit  │
                └──────────────────────────────────────────────────────────────────────────────────────────┘
                                   ▲                         ▲                         ▲
Employee ── raise ──► TICKET (new) ── coordinator assigns ──► TASK (existing, linked by ticket_id)
   ▲                   │  status machine, SLA stamps,             │ assignee works, completes with
   │                   │  comments (internal/visible), timeline   │ resolution notes
   └─ confirm / reopen ◄── AWAITING CONFIRMATION ◄────────────────┘
                       └─ auto-close job (4 working days, reminders on days 2/3/4)
```

## The Form Builder becomes the shared form engine for every module (owner's instruction)

It is already shared by approvals, Task types and Information types. The work is:
1. **Add TICKET as a module kind:**
   - migration: `module_types.module` ENUM, `record_files.entity_type`;
   - code: `ModuleKind`, labels, reserved keys, admin paths and page keys.
2. **Add the missing capabilities to the engine itself,** so every module gets them:
   - placeholder;
   - max / min length / pattern validation;
   - admin-managed option lists as a LOOKUP source;
   - "Duplicate type".
3. **Keep approval behaviour unchanged.** The regression suites for approvals, tasks and information run on every change.

## Proposed new data (Phase 2 will finalise)

| Table | Purpose |
|---|---|
| `ticket_categories` | IT Software, IT Hardware, Admin (data, not code): code, name, number prefix, active |
| `ticket_request_types` | Links a ticket type (module_types row, module = TICKET) to a category; order, active |
| `ticket_coordinators` | Category (+ request type / department / location per Q-T2), user, primary or backup |
| `tickets` | Number, category, request type, `type_version_id` (immutable form), `form_data_json`, requestor, department, location, priority, status, coordinator, assignee, SLA timestamps (first response, assigned, work started, resolved, confirmation requested, closed), auto-close due, reopen count |
| `ticket_events` | Append-only timeline: who, action, old → new, remark, internal or visible |
| `ticket_comments` | Comments with an internal / requestor-visible flag |
| `ticket_feedback` | Rating and comment at confirmation |
| `ticket_reminders` | One row per (ticket, working-day stage): exactly-once reminders and closure |
| `tasks.ticket_id` (new column) | The permanent ticket ↔ task link (subtasks inherit it) |

## Phases

| Phase | Content | Done when |
|---|---|---|
| 2 Design | Final schema, transitions table, permission matrix, notification matrix, job design, screens | Owner approves |
| 3 Core | Module, categories, request types (shared builder), raise ticket, numbers, coordinator routing, assign → task, ticket page, timeline | Tickets raised and assigned end to end |
| 4 Workflow | Task completion → Awaiting confirmation, confirm / reopen, auto-close, reminders, escalations | Tests for the job running twice and last-second confirmation pass |
| 5 Configuration | Coordinator mapping, SLA, numbering, notification templates, engine extras (placeholder, validation, option lists, duplicate) | Admin can set everything without code |
| 6 Dashboards and reports | Three category dashboards, personal dashboards, reports, exports | KPIs match the records; click-through works |
| 7 Readiness | Full regression, security review, guides, deployment and rollback | All suites green |

Each phase ships as its own release, behind the TICKET module switch (nobody sees it until it is switched on), following the staged-release rule (D-307).
