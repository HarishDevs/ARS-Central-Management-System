# Automation inventory and recovery

Applies to v1.46.0 (2 Nov 2026). Earlier: v1.39.0 (31 Oct 2026).

Unified prompt FN2, FN8, FN11 and Addendum B (monitoring). The live version of this table is **Super Admin → Automation** (`/superadmin/automation`), built from `server/ops/automation.ts`. That page also shows each job's health, its last run, its 24-hour failures and its run history.

## How automations run

- **One entry point.** cPanel cron calls `POST /api/jobs/run` every 5 minutes with the `x-job-secret` header. A wrong or missing secret gets a 404.
- **Each step runs on its own.** `runAutomations()` runs every automation in turn. A failing step is recorded and the remaining steps still run (before v1.6.0 one failure stopped the whole run).
- **Every step is recorded** in `job_runs`:
  - run reference (the request's `x-request-id`, shared by the steps of one call);
  - job key;
  - trigger (CRON / MANUAL);
  - start and finish times;
  - status;
  - counts (numbers only);
  - a short error (name and message, no payloads).
  
  Rows are kept for 90 days. A step left `RUNNING` for over an hour is closed as `FAILED` ("ABANDONED").
- **Health (missed-run detection).**

  | Health | Meaning |
  |---|---|
  | OK | Ran successfully within the expected interval. |
  | LATE | No good run within 3 intervals (at least 20 minutes). |
  | FAILING | The latest run failed. |
  | NEVER | No record of any run. |

  The page also warns when the runner heartbeat is older than 15 minutes.
- **Alerts.** A failed backup, or any other failed step, alerts the Super Admin by email and WhatsApp, at most once a day per kind (`server/ops/alerts.ts`).

## Inventory

Applies to v1.46.0 (2 Nov 2026): **21 automations** (v1.41.0 had 18; v1.42.1 added `workTasks`; v1.46.0 added `securityRetention` and `driveBackup`), all in `AUTOMATIONS` in `server/ops/automation.ts`, run in this order by `runAutomations()`. Every one runs on the same cron call (`POST /api/jobs/run`, every 5 minutes); `server/jobs/` holds the code for three of them (`sla`, `deliveries` and `housekeeping`, `delegations`), the rest live with their module. There is no other scheduled entry point. If this table and the Automation page ever differ, the page is right; update this table.

| Key | Automation | Trigger | Retry | Idempotency | On failure | Recovery | Owner |
|---|---|---|---|---|---|---|---|
| outbox | Send queued messages | Every run; also right after each action | Up to 5 tries per message, then waits for IT | Each message is claimed before sending; sent messages are never sent again | Stays unsent; listed under Messages not sent and on Needs attention | **Resend** (fresh tries, never a second send) | Super Admin (providers); IT team (affected requests) |
| deliveries | Retry failed deliveries | Every run | Backs off between tries, up to the limit | Deliveries are leased before retry; sent ones are never retried | Stays FAILED in the delivery log | **Retry now** on Deliveries | Super Admin |
| sla | Reminders and escalations (built-in) | Every run | The next run picks up anything missed | Each reminder or escalation level is recorded once per task (`task_reminders`) | Recorded; the next run tries again | Run now | IT team |
| templates | WhatsApp template status sync | Daily, inside the run | Next day's run | Read and store only | Templates keep their last status | **Sync now** on Templates | Super Admin |
| housekeeping | Housekeeping: expired drafts, rate limits, old payloads, old sent queue rows, job history over 90 days, abandoned runs | Every run | Next run continues | Deletes only data past its retention | Data kept a little longer; nothing lost | None needed | Super Admin |
| securityRetention | Security records clean-up (v1.46.0, DR-06): deletes sign-in attempts (`login_logs`), WhatsApp code records (`otp_challenges`), ended sessions (`user_sessions` revoked or expired), `used_security_links` and used or expired `password_tokens` older than **90 days**. Never requests, their history, `audit_logs`, `users`, `user_devices` or notifications; a person under an active legal hold (REQUESTER scope) keeps theirs | Once a day, inside the run (skipped as NOT_DUE when a complete run finished in the last 23 hours) | Batches of 1,000, at most 20 per table per run; a PARTIAL run continues on the next runs (every 5 minutes) until DONE | Deletes only what is past 90 days; a second run deletes nothing more | Recorded here; the records are just kept a little longer; nothing is lost | None needed. Counts in the audit log (`SECURITY_RECORDS_PURGED`, one entry per run that deleted anything) | Super Admin |
| delegations | Delegation start and end audit | Every run | Next run | Each start and end recorded once | Delegations still apply by date | None needed | IT team |
| backup | Daily backup | Daily, inside the run | Each run tries until today's backup exists | At most one a day; never overwrites | Super Admin alerted (once a day) | **Back up now** (Super Admin home) | Super Admin |
| driveBackup | Google Drive backup copy (v1.46.0, DR-08; off until set up): uploads the newest **encrypted** backup (`.sql.gz.enc`) and its `.sha256` to the ARS shared-drive folder with a service account, then keeps the newest `backup.gdrive_keep` copies (default 14), deleting only files it uploaded | Every run, right after `backup`; does work once per new backup | Each run tries again until the newest backup is in the folder | A file already in the folder (same name) is never uploaded again; a backup counts as done once a run recorded it OK | Recorded as failed with Google's message (or "set BACKUP_ENCRYPTION_KEY first"); Super Admin alerted (once a day); the local backup stays | Super Admin → Settings → Google Drive backup → **Test**; fix the key, folder sharing or encryption key; then **Run now** | Super Admin |
| backupCentre | Backup centre (v1.81.0, D-408): makes the scheduled full package when due (`backup.package_schedule`, encrypted with `BACKUP_ENCRYPTION_KEY`; copied to Drive with `backup.package_drive`), carries on Drive copies and the last stages of a restore nobody is watching, stops a person's run left for 30 minutes (nothing changed; the passphrase is never stored), keeps the newest `backup.package_keep` scheduled packages, removes download-only packages after 24 hours and stale uploads | Every run, up to 90 s | Each run carries on where the last stopped (work is saved in steps) | One scheduled package per day/week; a step holds a lease, so two runners never work on one run; a half-made package is never listed | The run shows Failed in Recent activity; a half-made package is removed, a restore undoes itself | Super Admin → Backup, restore & migrate: read the run's message and start again | Super Admin |
| reports | Scheduled reports (v1.7.0) | Every run (reports due since the last run) | A failed delivery is retried at its next slot; three failures in a row pause the schedule | Each slot is claimed once (unique schedule + due time) | Shown in the schedule's run history under Reports | Fix the cause (usually email settings), then switch the schedule on again | The report's owner; Super Admin for email |
| alerts | Alert rules (v1.7.0) | Every run | Next run checks again | Each firing is claimed on the rule; at most once per cool-down while over the line | Recorded; checked again next run | None needed | Each rule's owner |
| expiry | Approval expiry notices (v1.7.0) | Every run | Next run | Each request claimed before its notice | Recorded; next run | None needed | IT team |
| rules | Reminder and escalation rules (v1.27.0, Admin → Reminders & escalations) | Every run | A failed send is logged; the run carries on | One send per rule, record, stage and repeat, claimed first | Recorded; other steps still run | Fix the rule or recipient; due sends go next run | IT team |
| modules | Task and information reminders (v1.9.0); meeting points and MOM deadline reminders to the Coordinator (v1.51.0) | Every run | Next run | Each reminder claimed (per task, kind and due time; per recipient; per meeting and deadline, recorded in meeting_events) | Recorded; next run | None needed | IT team |
| calendar | Google Calendar two-way sync (v1.11.0) | Every run, only when the integration is enabled | Exponential backoff with jitter up to the set limit; then marked failed for review | Fixed Google event id and stored version per record; one sync per connection at a time | Shown on the Google Calendar page; Super Admin alerted when retries run out | **Retry**, or **Full resync** for one person | Super Admin |
| ai | AI module upkeep (v1.15.0): expire proposals after 7 days, remove old conversations, copy Salesforce data read-only at most hourly | Every run; the Salesforce copy only when the last is an hour old | Next run; a failed Salesforce object keeps its last good copy | Single statements; Salesforce records stored by their own Id | Recorded; AI → Data Sources shows each object's last run and error | AI settings → **Sync now** after fixing the cause | Super Admin |
| exports | Background exports (v1.7.0); export files removed after 7 days | Every run, and right after each request | A run that died is re-queued after 30 min | Each export claimed (queued → running) | Shown as failed on Reports | Ask again | Each export's owner |
| hodWeekly | Weekly HOD report (D-247; off until the Super Admin switches it on) | Every run; sends from Monday 09:00 IST, once a week | A failed department is recorded FAILED for that week; the next week sends again | One claim per department and week (`hod_report_runs`), plus a one-per-week email key | Recorded with the failed count | Fix email settings or the HOD's address | Super Admin; IT |
| push | Send phone and desktop notifications (D-252) | Right after each action that notifies someone (a drain in the app process) and every job run | Up to 5 tries per device (1, 5, 15, 60 min); Retry-After respected; 404/410 marks the device expired | Each push is leased before sending; a repeat carries the same tag, so a device shows it once | FAILED rows in the delivery log; the message is always in the Inbox | Check Super Admin → Settings → Phone & desktop notifications (switch, keys) | Super Admin |
| workTasks | Work-step tasks: every open work step of a request has its task in Task Management (D-269, v1.42.1) | Every run | Next run | Each request locked and synced as on any change; nothing new for a step that has its task | The work still shows on the request and in Waiting for me | None needed (Needs attention → Recheck syncs one request) | IT team |
| workPurge | Purge deleted tasks and projects after 30 days in Deleted (D-368, v1.62.0); runs only while the phase A switch isn't Off and Admin → Task settings has it on (default on) | Every run | Up to 500 tasks and 50 projects a run; the next run carries on | Only rows still deleted and older than 30 days go; a repeat removes nothing more; one transaction and one audit entry (`WORK_TASKS_PURGED` / `WORK_PROJECTS_PURGED`) per batch | The batch rolls back; recorded here | None needed; purged items only come back from a backup | IT team |
| statusReminders | Project status reminders (D-373, v1.65.0): on Fridays (India) from 9 am, tells the owner of each project with "Remind the project owner every Friday" on to post a status update; also removes Undo records of dependent-task moves older than 7 days. Runs only while the phase B switch isn't Off | Every run (reminders on Fridays from 9 am) | Up to 500 projects a run; a failed message is retried by the delivery runner | Each project is claimed once per Friday (`status_reminded_on`) before its message | Recorded here; the next run tries the projects not yet claimed | None needed; a missed Friday isn't sent later | IT team |
| myTaskRules | Task Summary section rules (D-401, v1.76.0): moves open tasks into the person's Today and Upcoming sections by their rules ("due today", "due within N working days"; weekly offs and holidays don't count), from any section, once per due day, with an activity note only the person sees. Only people who use My sections | Every run; each person once per India day from 00:00 India time | Up to 500 people a run; the rest next run | `my_task_rules.last_run_day` per person; each move marked `my_task_placements.rule_key` (rule + due day), so a task the person moved back stays | Recorded here; the person's transaction rolls back and the next run retries | None needed; people can move tasks by hand | IT team |
| projectAutomations | Project automations (D-380, v1.68.0): handles task changes waiting in the automation outbox (normally handled right after the request), "due date is approaching" / "task is overdue" triggers and scheduled rules (daily or weekly at a time, India); each rule acts with its owner's rights as the system user ARS-CMS Automation. Also keeps each rule's last 200 runs (older ones after 2 days), removes webhook calls and their bodies after 30 days and handled events after 7 days. Runs only while the Projects automations switch isn't Off (the clean-up always) | Every run, and right after each request that changes a task in a project with live rules | Claims older than 10 minutes are taken again; up to 1,000 events and 200 tasks per time rule a run | One run per rule and run key (event, due date, scheduled day, webhook call: unique); loop protection: a rule's own changes never start it, at most 3 rules in a chain, 500 runs an hour per rule, 5,000 in all | Recorded here and in the rule's run log; the rule's owner is told once until it works again | None needed; a rule whose owner lost access pauses (project owners told) until someone chooses Become owner | IT team; each rule's project owners |
| stuck | Stuck-request scan | Every run | Next run | Read-only | Needs attention still works | None needed | IT team |

**Event-driven, not scheduled (so not in the table):**

- Delivery receipts: CEOITBox calls `POST /api/webhooks/ceoitbox` (DELIVERED, READ).
- Google Calendar change notifications: Google calls `POST /api/webhooks/google-calendar`; the `calendar` step then processes them.
- Project automation webhooks (v1.68.0, D-380): another system calls `POST /api/webhooks/automations/<token>` (signed with the rule's secret); the task is created or updated and the rule runs during the call. Every call is logged on the rule (bodies kept 30 days).
- File uploads are processed during the request; there is no background file job.
- Imports run synchronously and show a result page.

**Gaps (register: Yet to do):**

- Imports have no background run or recovery of their own; a failed import is simply run again.
- `/api/health` reports the runner heartbeat only (OK within 15 minutes, LATE, NEVER), not each job or the age of the last backup (audit OPS-11). **Fixed in v1.40.0:** `/api/health` also reports `backupAgeHours`, `storage` and `degraded`, and `/api/health/deep` answers 503 when the runner is late or the newest backup is over 26 hours old.

## Stuck-request detection (FN2)

`server/ops/stuck.ts`, shown on **IT → Needs attention** (`/admin/attention`). Detection is read-only. Each finding is fixed through an existing audited action, or hidden for 1–30 days with a reason (`stuck_snoozes`, audited as `STUCK_SNOOZED`).

| Reason | Detected when | What to do |
|---|---|---|
| A step nobody can act on | The engine marked a step `BLOCKED` (nobody eligible, or no path matches) | Open the request: give the step to someone, or skip it (D-098) |
| Waiting on someone who is inactive | A pending task's holder is inactive and has no active delegate | Hand over their tasks (Users → the person) |
| No activity for a long time | In progress or on hold, with no event for `general.stuck_idle_days` (default 7) | Check with the approver |
| Sent back, not resubmitted | Changes required for longer than the same limit | Ask the requester to resubmit or withdraw |
| Messages not sent | Outbox rows the sender gave up on, or more than 30 minutes late | **Resend messages** |

A healthy pending request is never listed. This is covered by `tests/integration/reliability.int.test.ts`.

## Safe retry rules (FN8, FN11)

1. **Messages only, never decisions.** Retry and resend touch messages only. No recovery action can repeat or change an approval decision.
2. **Resend is guarded.** It releases an outbox row only when all of these hold:
   - it is unsent;
   - it is not being sent right now (no claim in the last 10 minutes);
   - its request isn't deleted.
   
   Sending then claims the row again, so two resends at once can't both send it.
3. **Server-side authorization.** Every action checks on the server:
   - Run now: Super Admin;
   - Resend on Automation: Super Admin;
   - Resend on Needs attention: IT team;
   - Snooze: IT team.
   
   Everyone else gets "Not found." or a 404.
4. **Every manual action is audited:**
   - `JOBS_RUN_MANUALLY` (with the run reference);
   - `OUTBOX_RESENT`;
   - `DELIVERY_RETRIED`;
   - `STUCK_SNOOZED`.
5. **Automatic retries are bounded:**
   - outbox: 5 tries;
   - deliveries: backoff and a limit.
   
   When tries run out, the item shows as "gave up" and needs manual action.
6. **Nothing sensitive is stored.** No message text, recipient or secret appears in `job_runs` or on these screens; only event types, counts and request numbers.

## Recovery runbook

| Symptom | Where it shows | Action |
|---|---|---|
| Runner heartbeat over 15 minutes | Automation banner; `/api/health` | Check the cPanel cron entry and that its `JOB_RUNNER_SECRET` matches the GoDaddy env var (KNOWN_ISSUES OPS-01) |
| A job is FAILING | Automation | Read the error and the run reference; find the reference in the server log; fix the cause; **Run now** |
| Messages not sent | Automation; Needs attention | Check provider settings (Super Admin → Providers), then **Resend** |
| Backup failed | Alert; Automation | Check disk space and the backup folder; **Back up now** |
| Google Drive backup copy FAILING (v1.46.0) | Alert; Automation (error text) | "Only encrypted backups…": set `BACKUP_ENCRYPTION_KEY` and wait for the next backup. "folder wasn't found" or "can't add files": share the shared-drive folder with the service account as Content manager. "couldn't delete an old backup": the upload worked; check the service account's role. Then **Test** and **Run now**. Meanwhile download the newest backup by hand (DEPLOYMENT P1) |
| Security records clean-up FAILING (v1.46.0) | Automation | Read the error (usually a lock timeout on a busy table); **Run now** later. Nothing is lost; records are kept longer |

## v1.57.6 (19 Nov 2026): state recovery (D-348)
- **One run at a time:** `runAutomations` takes a MySQL named lock (per database); a run while one is going returns "skipped: already running" and runs no step; Super Admin "Run now" says another run is going.
- **Exports:** up to 3 tries (`export_jobs.attempts`); after the 3rd failure the job is FAILED and the requester is told. Finish / fail / requeue only apply to the run that claimed it (same attempt count, still RUNNING).
- **Google Calendar jobs:** finish and fail only apply while the job is still RUNNING (a recovered job isn't overwritten by a late worker).
- **Outbox:** claims older than 15 minutes that were never sent are released and sent on the next run (this replaces D-243's "a stopped send is never retried by itself" for outbox messages); marking sent checks the claim token.
- **Weekly HOD report / scheduled reports:** runs stuck SENDING / RUNNING for over an hour are marked FAILED ("interrupted") and retried once on the next run (same email key, so no duplicates). Ordinary send failures are not retried.
- **AI data sync:** runs stuck RUNNING for over an hour are marked FAILED; the checkpoint never moves forward from them.

