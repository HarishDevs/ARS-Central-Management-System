# Project Management + Forms: Step 0 discovery report and plan

Prepared 21 Nov 2026 for the owner's approval. Nothing is built yet.

The spec package is `D:\REA\Asana\asana-reverse-engineering\docs` (about 22,000 lines). The CMS is ARS-CMS v1.60.0, in this repository.

Detailed evidence (file:line for every row) is in three companion files:
- [GAP-PROJECTS-VIEWS.md](GAP-PROJECTS-VIEWS.md): projects, views, customization and all 78 BR- rules.
- [GAP-FORMS-HOME-NAV-SECURITY.md](GAP-FORMS-HOME-NAV-SECURITY.md): forms, portfolios, Home, navigation and security.
- [MAPPING-TOKENS-COMPONENTS-DATA.md](MAPPING-TOKENS-COMPONENTS-DATA.md): the token mapping table (107 tokens), the component mapping table (CMP-01..38), the data model comparison (E-01..E-36 plus the module schemas) and infrastructure.

## 1. The main finding

ARS-CMS already has most of Phase A. Tasks & Projects (D-215 onward) already includes:
- projects, sections and multi-homing (at most 20 projects per task);
- subtasks (5 levels);
- List, Board, Calendar (month) and Timeline (read-only);
- task pane and full page, comments with one reply level, likes, followers and attachments;
- status updates, project roles, share, archive, and soft delete with a 30-day restore;
- My Tasks, Home, Inbox, universal search (Ctrl+K), the Create menu and the collapsible sidebar.

The Projects module is built but switched off for everyone until IT releases it (D-307).

So this plan upgrades and completes the existing module; it does not add a second one. That follows the owner's "blend into existing" rule: reuse tables, roles and the calendar, follow the reporting hierarchy for visibility, and keep settings in Admin.

| Area | Exists | Partial | Missing |
|---|---|---|---|
| Projects, views, customization (36 areas) | 16 | 9 | 11 |
| Forms, portfolios, Home, navigation, security (71 areas) | 24 | 18 | 29 |
| Tokens (107) | 61 | 23 | 23 |
| Components (CMP-01..38) | 14 | 21 | 3 new |
| Core entities (E-01..E-36) | 10 | 20 | 6 |

## 2. Stack (source of truth)

| Topic | ARS-CMS |
|---|---|
| Language, framework | TypeScript, Next.js 15 App Router, React 19 (server components and server actions) |
| Database | MySQL 8, `mysql2` raw SQL (no ORM); 67 forward-only `.sql` migrations with rollback notes; the owner runs them |
| API | Server actions for screens; REST under `app/api/*` (exports, files, jobs, webhooks, reports) |
| Auth, roles | Firebase Google sign-in, or User ID + password with a WhatsApp OTP; HMAC sessions; roles USER / IT_ADMIN / SUPER_ADMIN; per-module access; project roles (owner, editor, commenter, viewer); department and reporting-hierarchy visibility |
| Tenancy | Single organisation (no tenant column anywhere) |
| State | Server-rendered data plus `router.refresh()`; small client hooks; no global store |
| Realtime | None. Pages poll every 30–60 s, because GoDaddy cPanel Node hosting has no sockets (D-215) |
| Jobs | `jobs` table, with cron every 5 minutes calling `/api/jobs/run` |
| Files | Local storage with a type allow-list, size limits and content sniffing; no malware scan (D-150) |
| Email, notifications | GoDaddy SMTP relay / Resend, WhatsApp (CEOITBox), web push, in-app inbox with per-channel preferences |
| Search | `LIKE` queries across modules |
| UI | Tailwind with ARS tokens (light and dark), Lucide icons, Inter, the `features/ui` components |
| Tests, CI | Vitest (unit, and integration on Docker MySQL), Playwright e2e with axe, GitHub Actions `ci.yml` |

## 3. Gap list: infrastructure, with proposed choices

| Gap | Proposal (fits the stack, adds no major dependency) |
|---|---|
| Realtime | Keep polling, but tighter: refresh on focus and after every change, and poll every 15 s only while a project view is visible. SSE through cPanel/Passenger is unreliable (buffered). Revisit if hosting changes. **Owner decision.** |
| Charts | Hand-written SVG charts, as the analytics boards use today, each with a data table. No library. |
| List virtualization | A small windowing hook of our own for List and My Tasks (1,500+ rows), with role=treegrid and aria-rowcount/rowindex. |
| Drag and drop | Native HTML5 drag (already used), with keyboard equivalents for every drag: Space to lift, arrows to move, Enter to drop, plus live-region announcements. |
| Rich text | Our existing RichEditor (rich-text.ts format). |
| Scheduler | The existing job runner: automations, due-soon reminders, purging after 30 days, status reminders. |
| Search | `LIKE` is fine at our volume; add a MySQL FULLTEXT index on tasks if needed. |
| Malware scan | A hook interface (`scanUpload()`), off by default; turn it on with an external scan API only if public forms with files are approved. |
| Spam protection (public forms only) | Per-IP and per-form rate limits (DB-backed), a honeypot, a minimum fill time, and optionally Cloudflare Turnstile. **Only if public forms are approved.** |

## 4. Where the spec conflicts with fixed ARS decisions (need the owner's call)

| # | Spec says | ARS today | Recommendation |
|---|---|---|---|
| C-1 | Public form link for people without an account | Only admin-created users sign in (fixed decision); no anonymous writes; CAPTCHA skipped because there were none (D-150) | Phase C ships forms for signed-in users first. Public links come later, behind an Admin on/off switch, after rate limits, a challenge, a scan decision, and privacy/terms updates. |
| C-2 | Zero or one assignee | Exactly one (D-215) | Keep exactly one. Form submissions go to the form's default assignee (required when publishing). |
| C-3 | Due date optional | Due date mandatory (D-316) | Keep it mandatory. A form submission's due date is the form's default (e.g. +3 working days). |
| C-4 | Recurrence for any task | Only tasks for yourself repeat (D-313) | Keep. |
| C-5 | Approval task type | Approvals belong to the approval engine (D-001); approval steps are barred from projects (D-271) | No approval task type. Link a task to a request instead (exists, D-273). |
| C-6 | Live sync | Polling (cPanel) | See section 3. |
| C-7 | Teams | Departments and the reporting hierarchy (D-216) | Use departments as "teams" in the sidebar and in sharing. |
| C-8 | Field limits 150 / 60 / 500 | 20 fields and 30 options per project | Make the limits Admin settings, defaulting to the spec's values. |
| C-9 | Custom statuses per task type | A fixed status list | Keep the fixed statuses for the engine; add a per-project "Stage" field (single-select) for custom stages. |
| C-10 | System actor | `tasks.created_by` must be a real user | Add one non-sign-in system user ("ARS-CMS Automation"), like break-glass but unable to sign in. |

## 5. Phased plan (each phase shippable, tested, behind a feature flag)

Feature flags: `projects` exists (D-307). Add `pm_planning`, `pm_forms`, `pm_public_forms`, `pm_reporting`, `pm_automations` and `pm_portfolios` in Superadmin → Features. The celebrations default and the limits go in Admin → Task settings.

### Phase A: Foundations (upgrade what exists). About 2–3 weeks.
- **Tokens:** `--color-row-active`, `--color-identity-1..8` (replacing the hex values in COLOR_HEX), the row-height and density tokens, `--pane-w`, `--z-popover`, the missing type steps, `--font-mono`; light and dark.
- **Tabs:** an add-tab catalogue, rename, duplicate, set default, copy link, remove, and keyboard reorder, for every view (only List today). View changes stay unsaved until **Save view**.
- **List:** treegrid semantics, virtualization, row numbers, the "hide empty groups" and "expand/collapse subtasks" section options, and search within the view.
- **Board:** Space-to-lift keyboard moves, card field chips and comment count.
- **Task pane:** an optional right-side resizable pane (the centred dialog stays on small screens), a visibility banner, and reactions (emoji) beside likes.
- **Completion:** an original check animation (the spec's `animations/task-complete.html`, re-themed after an asset-policy check). Celebrations are a user preference (Off / Occasional default / Always) and respect reduced motion. Undo toast for complete and delete.
- **Sidebar:** Starred projects; Departments sections with a sort menu; the Home greeting and widget sections.
- **Purge job:** after 30 days in Deleted, rows are purged (an Admin setting; default on).

### Phase B: Planning and data. About 4–5 weeks.
- **Custom fields, 11 types:** text, number (format and decimals), single- and multi-select (colour, reorder), date, people, formula, ID (prefix and sequence), timer, reference, lookup.
  - Typed value storage; a field library; edit after creation; notify on change; access.
  - Filter, sort and group by a field; list columns, board chips and pane rows.
- **Dependencies:** FS/SS/FF/SF types, with lag stored but reserved; cycle checks stay.
  - Project settings gets **Dependencies** and **Scheduling** tabs: auto-shift (none / keep gap / consume slack), with working days from the holiday calendar.
- **Timeline becomes editable, plus a Gantt view:**
  - zoom (days to quarters), today line and weekend shading;
  - drag or resize to reschedule, with keyboard equivalents;
  - connectors, and creating dependencies by drag or typeahead;
  - a Blocked-by column.
- **Calendar:** a week view and a no-date drawer.
- **Status updates:** the highlights panel, recipients and weekly reminder.

### Phase C: Forms. About 3–4 weeks.
- **One builder:** extend the existing shared Form Builder; don't build a second one. Add a **Project intake form** type, built by project editors from the project's Customize panel.
- **Question types:** text, single-select, multi-select, date, number and attachment, plus headings.
- **Branching:** per option (the existing show-if becomes "Add branch").
- **Mapping:** each question maps to a task field or a project custom field. The date-answer gap is fixed by design.
- **Settings:**
  - target section, title field, default assignee (required), due offset;
  - copy answers to the description;
  - confirmation message and "Add new request";
  - submitters become collaborators.
- **Publishing and sharing:** versions and publishing as today; a share link for signed-in users; a QR code.
- **Submission → task:**
  - created at the top of the section by the system user;
  - the description is "Label: value" lines plus a footer with the form link;
  - mapped fields and the ID field are set;
  - notifications and an email confirmation.
- **Home Forms widget**, and Forms in Customize (edit, duplicate, unpublish, delete).
- **Public link (only if C-1 is approved):** a separate `/f/<token>` page with the full anti-abuse set and an embed code.

### Phase D: Reporting, workload, automations, portfolios. About 5–6 weeks.
- **Project dashboard:** a chart builder with number, bar (stacked and grouped), line, burnup, burndown, donut, lollipop and text widgets.
  - X/Y axes, filters, data labels, benchmark line, and a data table for every chart.
  - 8 default widgets.
- **Workload:** person × day, task count or an effort field, against capacity.
- **Automations:**
  - triggers (moved, field changed, dates approaching or overdue, status, attachment, comment, collaborator, manual, scheduled, incoming webhook);
  - steps (move, add to project, set field, create task or subtasks, comment, collaborators) and Paths (conditions);
  - draft and publish, a run log, loop protection (depth 3 and a per-hour cap), owner and "become owner";
  - runs on the job runner as the system user.
- **Portfolios:** a create wizard, a grid with roll-ups, Progress, Timeline (quarters), dashboard roll-ups, and members.

### Phase E: Backlog
Templates (save and instantiate), duplicate with checkboxes, import and export (CSV and JSON; XLSX through our existing export code), iCal feed, Files tab, Messages, Page, time tracking.

## 6. Migrations (planned; forward-only with rollback notes, run by the owner)

| Phase | Migration | What |
|---|---|---|
| A | `pm_a_views_prefs` | view tabs for every view type; user prefs (celebrations, density); starred projects; purge settings |
| B | `pm_b_custom_fields` | field definitions (11 types, library, settings), options (colour, order), typed values, ID sequences; the limits become settings |
| B | `pm_b_dependencies` | `type` (FS/SS/FF/SF) and `lag_days` on task_dependencies; project scheduling settings |
| C | `pm_c_intake_forms` | project form type: target section, mapping, settings, submissions/answers (reusing the form tables where they fit); system user row |
| C* | `pm_c_public_forms` | share tokens, rate-limit buckets, submission IP hash (only if C-1 is approved) |
| D | `pm_d_dashboards` | dashboard widgets (chart JSON) |
| D | `pm_d_automations` | automations, triggers, steps, path conditions, run log |
| D | `pm_d_portfolios` | portfolios, items, members |

Existing data is never changed without the owner's approval. The value-storage change in B copies today's `VARCHAR(500)` values into typed columns and keeps the old column until the owner confirms.

## 7. Risks

1. **Size.** This is about 15–18 weeks of work at our pace. Each phase ships on its own; the owner picks the order.
2. **Polling instead of live sync.** Two people editing the same board see each other's changes after up to 15 s. Row versions already stop lost updates.
3. **Public forms.** These are the first anonymous writes in the app: spam, abuse, files from strangers, and personal data from non-employees (privacy policy). Mitigated by keeping them off by default and approving them separately (C-1).
4. **Automations** can create loops or mass changes. Mitigations: depth and rate caps, a run log, and draft/publish.
5. **Custom field value migration** touches existing data (B). It runs side by side and is reversible.
6. **Performance** of List at 1,500+ rows on shared hosting. Virtualization, paged queries and indexes on (project, section, position).
7. **The general-pages rule** applies to every phase: privacy, terms, User Guide, Help, tour, checklist and release notes.
8. **Asset policy:** we use no third-party names, icons, illustrations or copy, and we check the spec's animations against `ASSET_REUSE_POLICY.md` before reusing them.

## 8. Test plan (summary)

Unit tests cover the rules and the deny-by-default permission matrix. Integration tests run on the Docker MySQL test database. Playwright e2e covers:
- create project → views → custom fields → tasks → dependency on Gantt → complete;
- form build → publish → submit → task;
- chart create;
- portfolio roll-up.

Also:
- axe on every new screen, plus keyboard walkthroughs;
- a performance check with a 1,500-task section;
- screenshots in light and dark at desktop, tablet and phone widths.

Every test is mapped to the ACCEPTANCE_CRITERIA / TEST_SCENARIOS IDs, with a coverage report per phase.
