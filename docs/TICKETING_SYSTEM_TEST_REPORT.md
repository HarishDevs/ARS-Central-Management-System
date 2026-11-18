# Ticketing System: test report (v1.55.0, 18 Nov 2026)

All results below are from runs on 18 Nov 2026: unit tests (Vitest), integration tests on real MySQL 8, and browser tests (Playwright, Chromium, production build).

## The owner's lifecycle, end to end

`RAISE TICKET → COORDINATOR ASSIGNMENT → TASK EXECUTION → COMPLETION → REQUESTOR CONFIRMATION → CLOSURE`

| Step | Covered by | Result |
|---|---|---|
| IT builds a ticket form in the shared Form Builder, chooses its category and coordinators, publishes | e2e `v1550-tickets` #1 | Pass |
| Requester raises it; name, employee ID, department and email filled in; number `IT-HW-2026-00001` | e2e #2; integration "numbered by its category" | Pass |
| Coordinators notified (Inbox / email / WhatsApp per template) | integration (TICKET_NEW notification) | Pass |
| Same form sent twice makes one ticket | integration | Pass |
| Only a coordinator assigns; one linked task in the assignee's Tasks, ticket number in the title | integration; e2e #3 | Pass |
| Assignee starts → ticket In progress | integration; e2e #4 | Pass |
| Completing needs completion remarks; ticket → Awaiting confirmation (never Closed); 4-working-day date set | integration; e2e #4 | Pass |
| Task side can't reopen or reassign a ticket's task | integration | Pass |
| Only the requester confirms (not the assignee or a coordinator); rating 1–5 optional, out-of-range refused | integration; e2e #5 | Pass |
| Reopen needs a reason, returns to the coordinators, reuses the same task, keeps the earlier work in history | integration | Pass |
| Reminders on working days 2 and 3, once each, even if the job runs twice the same day | integration | Pass |
| Not closed on day 4 itself; closed after 4 complete working days, once (`Closed – auto closed`, reason recorded) | integration | Pass |
| A requester who confirms or reopens first is never auto-closed | integration | Pass |
| Category dashboard: totals from the records, table, filters | e2e #6 | Pass |
| Someone not involved gets 404 | e2e #7; unit (rules) | Pass |
| Working days skip weekly offs and holidays, across a year end | unit (`addWorkingDays`, `workingDaysBetween`) | Pass |

## Regression

| Suite | Result |
|---|---|
| Unit (all) | **1,131 passed** |
| Integration on MySQL (all) | **381 passed** (8 new for tickets) |
| e2e: ticketing journey | 7 / 7 passed |
| e2e regression (tasks, task types, approvals, settings, lists, navigation) | See the release notes of v1.55.0 for the final run |

v1.55.1: the ticket pages belong to the TICKET module (module-access guard test); the e2e suite gives the module to its people for the run. Unit 1,134, integration 381 passed.
