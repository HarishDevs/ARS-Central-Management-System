# ARS Approval Platform — Engineering Excellence & Quality Governance Addendum

Adopted by the owner on 25 Nov 2026. Extends `CLAUDE.md` (working rules) and works together with `docs/ops/BUILD-EXECUTION-POLICY.md` (fast delivery). Where this addendum and a fixed decision in DEVELOPMENT-MEMORY conflict, the fixed decision stands until the owner answers a Q-xxx.

## PURPOSE

These rules extend the existing ARS Approval Platform working rules. The objective is to establish production-grade engineering discipline, data integrity, security, testing, performance, maintainability and evidence-based completion. They are mandatory for all new development, modifications, bug fixes, refactoring, integrations and deployment-related activities.

**Core principle: Do not merely implement a requested change. Prove that the change works correctly, does not break existing functionality, respects the architecture and is safe to deploy.**

Do not weaken, override or silently supersede existing fixed decisions. If a conflict exists, document it as an open question (Q-xxx) and seek clarification before making a consequential change.

---

# 1. ARCHITECTURAL GOVERNANCE

## 1.1 Approval Engine Architecture

The approval engine must remain a fully configurable node-based workflow engine. Never introduce fixed approval-level assumptions such as Level 1, Level 2, Level 3 or Level 4.

The engine must support: sequential approvals; parallel approvals; any-one approval; any-N-of-M approval; all-of-M approval; conditional routing; multiple conditional branches; dynamic approver resolution; group-based, designation-based, department-based, HOD-based, reporting-manager-based and delegate-based approvals; hybrid workflows combining all supported patterns; optional and mandatory approval nodes; rejection, cancellation, return and resubmission paths; escalation and timeout policies; dynamic workflow composition.

The architecture must not impose an artificial maximum number of approval nodes or levels.

## 1.2 Separate Workflow Definition and Execution

Maintain clear separation between:

1. Workflow Definition — configuration of the workflow.
2. Workflow Version — immutable snapshot of an approved configuration.
3. Workflow Instance — execution of a particular workflow for a request.
4. Approval Node Instance — execution state of an individual node.
5. Approval Assignment — assignment of approval responsibility.
6. Approval Event — historical record of actions and transitions.

Existing approval instances must retain the workflow version under which they were initiated. Editing a workflow must not unexpectedly change ongoing or historical approval instances.

## 1.3 Architecture Preservation

Before introducing new architecture: inspect the existing codebase; identify existing reusable services and components; follow established naming conventions; avoid unnecessary dependencies; avoid duplicate implementations; avoid introducing parallel systems for existing functionality; preserve existing API contracts unless a documented migration is approved; keep business logic outside presentation components; use reusable services and clear module boundaries.

Never undertake large-scale refactoring merely because a different implementation appears preferable.

---

# 2. DATABASE GOVERNANCE AND DATA INTEGRITY

All MySQL 8 database modifications must follow strict migration governance.

## 2.1 Migration Rules

- Every schema modification must have a version-controlled migration.
- Never make undocumented production schema changes.
- Never drop or overwrite existing data without explicit authorisation.
- Never use destructive schema synchronisation in production.
- Migrations must detect whether they have already been applied.
- Prefer backward-compatible migrations.
- Maintain appropriate indexes, foreign keys and constraints.
- Validate nullability and default values.
- Verify transaction boundaries.
- Provide rollback or forward-recovery procedures.
- Test migrations against representative existing data.
- Record migration versions and execution results.
- (Existing ARS rule) Every trigger block needs `-- @optional`; never advise GoDaddy Database Manager → Import for partial SQL.

## 2.2 Data Protection

Before any potentially destructive operation: (1) identify affected tables; (2) identify affected records; (3) estimate the impact; (4) confirm backup availability; (5) prepare a recovery strategy; (6) obtain explicit authorisation when data loss or irreversible modification is possible.

Never silently delete, truncate, overwrite or bulk-update production records. Never use fake data to overwrite actual business records.

## 2.3 Data Integrity

Validate: referential integrity; unique constraints; duplicate prevention; foreign-key consistency; orphaned records; transaction consistency; concurrent modification behaviour; historical record preservation; soft deletion and inactive-user behaviour.

Approval history, audit events and executed workflow records must not be casually modified or deleted.

---

# 3. APPROVAL ENGINE BUSINESS INVARIANTS

| Scenario | Required behaviour |
|---|---|
| Self-approval | Always prohibited |
| Duplicate approval | Must not execute twice |
| Parallel approval | Follow configured completion policy |
| Any-one approval | Complete after first valid approval |
| Any-N-of-M | Complete after N valid approvals |
| All-of-M | Complete only after all required approvals |
| Conditional routing | Deterministic condition evaluation |
| Rejection | Follow configured rejection policy |
| Delegation | Validate delegation eligibility and scope |
| Approver deactivation | Follow defined reassignment/escalation policy |
| Workflow modification | Existing instances retain original version |
| Concurrent approvals | Prevent race conditions |
| Cancelled requests | Prevent further approval actions |
| Resubmission | Preserve relevant historical events |
| Missing approver | Handle through explicit exception policy |
| Expired assignment | Apply configured timeout policy |

## 3.1 Transactional Approval Processing

Approval actions must: execute within appropriate database transactions; prevent duplicate processing; validate the current approval state before transition; validate the actor's permissions on the server; prevent stale approval submissions; handle concurrent approval attempts safely; use idempotency protection where appropriate; record the resulting state transition; maintain a consistent event history. Use appropriate concurrency controls such as row locking, optimistic locking or equivalent mechanisms.

## 3.2 Approval Event History

Record: request ID; workflow instance ID; workflow version; node ID; actor ID; actor role; action; previous state; new state; timestamp; comments where applicable; delegation information where applicable; relevant transition metadata.

Historical approval events must be append-only. Do not rewrite historical events to represent a newer workflow configuration.

---

# 4. SECURITY AND AUTHORISATION GOVERNANCE

Security must be enforced at the server level.

## 4.1 Authorisation

Every protected API, server action and sensitive operation must validate: authentication; user status; role permissions; resource-level access; ownership or applicable business context; requested action permissions; relevant administrative restrictions.

Hiding buttons or navigation items is not security. Direct API access must be tested independently of the UI.

## 4.2 Security Testing

Test for: broken access control; IDOR; privilege escalation; cross-role access; session fixation; session expiration and revocation failures; CSRF where applicable; XSS; SQL injection; command injection; open redirects; authentication bypass; rate-limit bypass; sensitive information exposure; insecure direct file access; improper error disclosure.

## 4.3 Authentication and Session Security

Validate: Google authentication; User ID and password authentication; WhatsApp OTP verification; OTP expiration; OTP replay prevention; OTP brute-force protection; session expiration; session revocation; secure cookie settings; authentication failure logging; new-login alerts.

Do not introduce step-up OTP or alternative authentication mechanisms without approval; existing authentication decisions must be preserved.

## 4.4 Secret Management

Never commit credentials. Never expose provider API keys in client-side code. Never print secrets in logs. Never expose encryption keys. Never access the reference project's real environment files. Keep provider credentials in encrypted settings and server secrets in GoDaddy environment variables. Validate encryption and decryption operations. Ensure encrypted settings cannot be retrieved through unauthorised APIs.

---

# 5. MANDATORY TESTING GOVERNANCE

Testing is mandatory for every feature and modification. A successful build alone does not establish correctness. (Test selection follows BUILD-EXECUTION-POLICY: affected tests during work, full regression once before release.)

## 5.1 Unit Testing (Vitest)
Business logic; approval conditions; workflow transitions; permission calculations; validation rules; date calculations; formula calculations; data transformations; utility functions; error handling.

## 5.2 Integration Testing
Database operations; API endpoints; authentication services; approval execution; notification services; provider integrations; encryption/decryption; cron jobs; background processes; transaction rollback behaviour.

## 5.3 End-to-End Testing (Playwright)
Test independently as User, Admin and Super Admin. Validate: login; logout; navigation; request creation; workflow configuration; approval assignment; approval execution; rejection; resubmission; delegation; notifications; search and filtering; reports; administrative operations; permission restrictions.

## 5.4 Regression Testing
After every relevant change: (1) run tests for the modified functionality; (2) run tests for dependent functionality; (3) run existing regression tests; (4) check affected user journeys; (5) verify that unrelated modules still work; (6) check for unexpected API changes; (7) check browser console errors; (8) check network request failures.

A new feature passing its own test does not mean the application is regression-free. Never remove or weaken an existing test simply to make a new implementation pass. If a test is genuinely obsolete, document the reason and replace it with equivalent or stronger coverage.

## 5.5 Visual and Responsive Testing
Validate desktop, tablet and mobile layouts; sidebar behaviour; header consistency; dropdown positioning; modal dimensions; drawer behaviour; table responsiveness; form alignment; typography; spacing; button consistency; scroll behaviour; empty, loading, error and success states.

Check that the application does not introduce: horizontal overflow; unexpected layout shifts; missing buttons; overlapping elements; clipped content; inconsistent component dimensions; broken navigation; inconsistent responsive behaviour. Use screenshots and visual comparisons where practical (`VISUAL=1` baselines, UIQA sweep).

---

# 6. GLOBAL UI/UX GOVERNANCE

## 6.1 Design System
Use shared colour, typography, spacing, border-radius and shadow tokens and shared button, input, dropdown, modal, table, navigation, loading and notification components (`docs/qa/GLOBAL_DESIGN_SYSTEM.md`, `docs/qa/GLOBAL_COMPONENT_INVENTORY.md`). Reuse existing ARS design tokens from the approved assets directory. Do not independently invent styling for individual modules.

## 6.2 Animation and Interaction
Maintain consistent transition durations, easing functions, hover, focus and active states, loading animations, and modal, dropdown, sidebar and page transitions (`docs/qa/GLOBAL_MOTION_DESIGN_SYSTEM.md`). Avoid unnecessary animation and respect reduced-motion preferences.

## 6.3 Accessibility
Check keyboard navigation; focus visibility; semantic HTML; form labels; accessible error messages; appropriate ARIA attributes; colour contrast; screen-reader compatibility; reduced-motion support.

---

# 7. CHANGE IMPACT ASSESSMENT

Before modifying a feature, identify all affected areas. Every task must have a documented impact assessment (in its PLAN-CHECKLIST item or work-log entry).

| Change category | Required checks |
|---|---|
| UI-only change | Responsive, visual and interaction tests |
| Business logic | Unit, integration and regression tests |
| Approval workflow | FLOWS.md, workflow tests and documentation impact |
| Database change | Migration, integrity and recovery tests |
| Authentication | Security, session and access-control tests |
| Permission change | All affected roles and direct API access |
| New data collection | Privacy policy, retention and provider review |
| New user functionality | User Guide, Help, Tour and First-use Checklist |
| Notification change | Email, WhatsApp and notification documentation |
| Integration change | API contracts, credentials and failure handling |
| Deployment change | Deployment documentation, environment and health checks |

## 7.1 Mandatory General-Surface Review

Preserve the existing zero-tolerance documentation rule. For every feature addition or modification, assess: (1) privacy policy; (2) terms and conditions; (3) User Guide; (4) in-app Help; (5) product tour; (6) first-use checklist; (7) landing page; (8) user menu; (9) release notes; (10) Admin documentation; (11) Super Admin documentation; (12) deployment documentation; (13) API Reference; (14) Data Model; (15) Automation Inventory.

Update every surface affected by the change. If a surface genuinely requires no modification, explicitly document why. Do not make unnecessary documentation changes merely to demonstrate activity. Whenever privacy or terms change, update their effective dates. Verify modified documentation pages in the local browser where applicable.

---

# 8. PERFORMANCE AND SCALABILITY GOVERNANCE

## 8.1 Frontend Performance
Check unnecessary re-renders; large client bundles; excessive JavaScript execution; unnecessary API calls; duplicate network requests; large unoptimised images; layout shifts; excessive client-side state; inefficient list rendering; unnecessary page reloads. Use server-side and client-side rendering appropriately.

## 8.2 Backend Performance
Check N+1 queries; missing indexes; inefficient joins; unnecessary round trips; unbounded queries; excessive payloads; long-running synchronous operations; background job processing; connection management; memory usage. Use pagination for large datasets. Avoid fetching all records into memory when database-level filtering is possible.

## 8.3 Performance Verification
Measure where applicable: page load time; API response time; query duration; workflow execution duration; notification delivery latency; background job duration; memory; CPU. Establish baselines before optimising. Do not claim performance improvement without measurable evidence.

---

# 9. ERROR HANDLING AND OBSERVABILITY

## 9.1 Error Handling
Never silently swallow exceptions. Return meaningful and safe error messages; no internal stack traces to end users. Distinguish validation errors from system failures. Handle database connection failures, provider API failures, network timeouts, expired sessions, partial notification failures and background job failures. Provide safe retry mechanisms where appropriate.

## 9.2 Logging
Structured logs where practical, capturing timestamp, module, operation, actor, request/correlation ID, error category and relevant context. Never log passwords, OTPs, API secrets, encryption keys, session tokens or unnecessary sensitive personal information.

## 9.3 Monitoring
Validate application health; database connectivity; authentication availability; provider connectivity; cron execution; background job status; notification failures; error rates; resource consumption. Maintain the append-only audit log independently of operational logs.

---

# 10. GIT AND VERSION CONTROL GOVERNANCE

Repository: HarishDevs/ARS-Approval-System (GitHub now names it HarishDevs/ARS-Central-Management-System; the old name redirects). Branch: main.

## 10.1 Before Development
Inspect the current branch, git status and recent commits; identify uncommitted user changes; confirm the requested scope; never overwrite unrelated work.

## 10.2 Before Committing
Review git diff; inspect all modified files; check for accidental files, secrets, environment files, temporary debugging code and unintended dependencies; run applicable tests; verify the build.

## 10.3 Commit Rules
Focused commits with meaningful messages. Never force-push without explicit authorisation. Never commit secrets. Never silently revert user changes. Never include unrelated modifications. Never claim a push succeeded without confirmation.

Record the commit hash and push status in DEVELOPMENT-MEMORY.md (a commit can't contain its own hash: record it in the next commit's work log, or in a follow-up docs commit after the push is confirmed). If pushing is unsuccessful, document the reason and leave the work recoverable.

---

# 11. DEPLOYMENT AND ENVIRONMENT SAFETY

Keep local development, testing and production separate. Never assume local configuration matches production.

Before deployment: (1) validate the production build; (2) validate required environment variables without revealing values; (3) validate database connectivity; (4) validate migration readiness; (5) validate authentication; (6) validate critical integrations; (7) validate health endpoints; (8) confirm rollback or recovery procedures; (9) review security-sensitive configuration changes.

Never deploy to production, alter production data or execute destructive production operations without explicit authorisation (the owner publishes on GoDaddy). Do not expose secrets when inspecting environment configuration.

---

# 12. TECHNICAL DEBT AND MAINTAINABILITY

Maintain the technical debt register `docs/TECH-DEBT.md` with stable identifiers TD-001, TD-002, …: architectural limitations; duplicate implementations; deprecated functions; security weaknesses; performance bottlenecks; unnecessary dependencies; incomplete test coverage; known UI inconsistencies; unresolved integration issues.

Do not silently expand task scope to resolve unrelated technical debt; document it and prioritise separately. When modifying an existing component, avoid introducing additional debt.

---

# 13. MANDATORY DEFINITION OF DONE

A task is complete only when all applicable items are verified:

**Implementation:** functionality implemented; acceptance criteria satisfied; architecture respected; no unnecessary duplicate implementation; error handling implemented; no unintended behaviour.
**Database:** required migrations created; integrity verified; existing data preserved; recovery strategy documented where applicable.
**Security:** server-side permissions validated; role access verified; direct API access tested; no secrets exposed; relevant security tests pass.
**Testing:** unit, integration, relevant E2E, regression and relevant UI tests pass; no unresolved critical errors.
**Documentation:** DEVELOPMENT-MEMORY, PLAN-CHECKLIST, FLOWS (when flows change) updated; general documentation impact assessment complete; relevant documentation updated.
**Verification:** production build succeeds where applicable; browser console and network errors checked; relevant screen sizes and role interfaces checked; git diff reviewed.
**Repository:** committed; pushed; commit hash recorded; push status verified.

If any applicable requirement cannot be completed, mark the task partially complete and document the blocker. Never falsely report a task as complete.

---

# 14. EVIDENCE-BASED COMPLETION REPORT

At the end of every development task report: (1) requested task; (2) what was implemented; (3) files modified; (4) database changes; (5) architectural decisions; (6) tests executed; (7) test results; (8) security verification; (9) UI verification; (10) documentation updated; (11) known limitations; (12) outstanding issues; (13) commit hash; (14) GitHub push status; (15) next recommended action.

Distinguish clearly between Implemented, Tested, Verified, Not tested, Blocked and Deferred. Never report an unexecuted test as passed. Never report a feature as browser-verified if it was only reviewed in source code.

---

# 15. AUTONOMOUS DEVELOPMENT BOUNDARIES

Work autonomously for routine, reversible development: inspect code; analyse architecture; plan; modify relevant code; add tests; update documentation; fix verified bugs; refactor within scope; run local tests; review diffs; commit and push completed work under the repository rules.

Request clarification or explicit authorisation before: destructive database operations; production data modification; production deployment; breaking API contract changes; irreversible migrations; authentication architecture changes; security policy changes; changes to fixed architectural decisions; removing existing functionality; deleting historical records; force-pushing Git history; replacing established infrastructure or integrations.

Do not interrupt routine work with unnecessary confirmation requests. Distinguish reversible development work from consequential or destructive operations.

---

# 16. FINAL ENGINEERING PRINCIPLES

1. Architecture before implementation.
2. Data integrity before convenience.
3. Security before accessibility of functionality.
4. Backward compatibility before unnecessary redesign.
5. Reusability before duplication.
6. Automated verification before completion claims.
7. Evidence before assumptions.
8. Documentation consistency before closing a task.
9. Performance before uncontrolled complexity.
10. Historical traceability before data modification.
11. Explicit authorisation before destructive operations.
12. Regression prevention before declaring success.

**Ultimate objective: ARS-CMS must evolve into a secure, scalable, configurable and maintainable enterprise approval platform without compromising existing functionality, historical data, business rules or user experience.**
