# Data model: ARS-CMS database (tables and relationships)

Applies to v1.46.0 (2 Nov 2026). Earlier: v1.39.0 (31 Oct 2026).

| | |
|---|---|
| Database | MySQL 8.0 (`docker-compose.yml` uses `mysql:8.0`; GoDaddy's Hosted Database is MySQL 8). Every table is InnoDB, `utf8mb4` / `utf8mb4_unicode_ci` |
| Source of truth | `database/migrations/*.sql`, **52 files**, from `202609281200_create_organisation.sql` to `202611021000_unify_condition_rules.sql` (48 at v1.39.0; v1.40.0 added 2, v1.41.0 1, v1.46.0 1) |
| Tables | **114** made by the migrations, plus **2** made by the migration runner itself (`schema_migrations`, `schema_migration_progress`) = 116 (v1.39.0: 110 + 2; since then `hod_report_runs`, `push_subscriptions`, `admin_broadcasts`, `condition_rules_backup`) |
| Fixes | Audit defect OPS-17 ("No ERD covers the 48 migrations") |

This page is a map, not a copy of the SQL. When the two differ, the SQL wins. Update this page in the same change as any new migration.

## Contents
- **1.** How migrations are applied
- **2.** Diagrams (7, one per area)
- **3.** Every table
- **4.** Notable constraints

---

## 1. How migrations are applied

- **The runner:** `scripts/database/migrate.js` (`npm run db:migrate`). It reads `database/migrations/*.sql` in file-name order (`YYYYMMDDHHMM_description.sql`) and applies those not yet listed in `schema_migrations`.
- **Resume after a failure:** MySQL can't roll back table changes, so progress is saved per statement in `schema_migration_progress`. After fixing the cause, the next run carries on from the statement that failed.
- **Triggers:** a trigger body sits between `-- @begin` and `-- @end` lines and is sent as one statement. A block marked `-- @optional` is skipped with a warning when the database user isn't allowed to create triggers; IT then runs `database/optional/v190_append_only_triggers.sql` once in phpMyAdmin.
- **On start:** `npm start` is `migrate.js && seed.js && next start`, so every production start applies new migrations and seeds before the app opens. The Next.js app itself doesn't migrate: no code under `app/`, `server/` or `lib/` touches `schema_migrations`, and there is no `instrumentation` file. `npm run start:app` starts the app without migrating.
- **Seeds:** `database/seeds/` (roles, the WhatsApp sign-in code template, the first Super Admin), run by `scripts/database/seed.js`.
- **Not migrations:** `database/optional/reporting_views.sql` (two read-only Power BI views, `reporting_requests` and `reporting_tasks`), `database/optional/v190_append_only_triggers.sql` and `database/optional/v1421_qa_indexes.sql` (v1.43.0: two additive indexes, `notifications (user_id, archived_at, id)` and `tasks (assignee_id, status, completed_at)`, run once the owner approves; only speed). IT runs them by hand.
- **Work-step tasks (D-269):** a `tasks` row made for an approval work step has `related_request_id` set and `form_data_json.__approvalWork = { requestId, taskKey }`; no column was added.
- **Background work (D-273, v1.44.0):** a work step with `background: true` (builder `holdsUp: false`) records the event `WORK_ASSIGNED` (`approval_events.payload_json = { nodeId, label, userIds, slaHours? }`) and the node state `assigned`; each person gets a `tasks` row with `related_request_id` and `form_data_json.__approvalLink = { requestId, key: "<event id>:<user id>", nodeId }`. No column was added.
- **The rule: migrations only add.** New tables, new nullable or defaulted columns, new indexes, new enum values. Older code keeps working on a newer database, so a rollback is "redeploy the previous release". Never edit a migration that has shipped; add a new one. The few `MODIFY COLUMN` statements only widen (more enum values, a longer `VARCHAR`, `request_submission_checks.request_paise` made signed). Two data changes exist: `202610081400_super_admin_google_email.sql` changes the bootstrap Super Admin's email once, and **`202611021000_unify_condition_rules.sql` (v1.46.0)** rewrites saved form rules into the one rule shape (§4, "v1.46.0"). The second is the one exception to "older code keeps working": v1.45.0 can't read the new shape, so its rollback statements (in the file header) must be run when going back.

---

## 2. Diagrams

How to read them:
- Only key columns are shown: primary key, foreign keys, and a few that matter. Types are simplified (`varchar` for `VARCHAR(n)`, `datetime` for `DATETIME(3)`).
- `PK` primary key, `FK` foreign key, `UK` part of a unique key.
- A **solid line** is a real `FOREIGN KEY` constraint. A **dotted line** is a link **by convention only** (an id column with no constraint; the app keeps it right).
- `users` appears as a short stub in most diagrams; its full shape is in 2.1. Almost every table also has `created_by` / `updated_by` FKs to `users`; most of those are left out to keep the pictures readable.

### 2.1 People, organisation and access

```mermaid
erDiagram
    departments {
        bigint id PK
        varchar code UK
        varchar name
        bigint hod_user_id FK
        boolean active
    }
    designations {
        bigint id PK
        varchar code UK
        varchar name
        boolean is_approver
        boolean active
    }
    users {
        bigint id PK
        varchar login_id UK
        varchar email UK
        varchar whatsapp_number UK
        varchar firebase_uid UK
        bigint department_id FK
        bigint designation_id FK
        bigint reporting_manager_id FK
        enum sign_in_method "GOOGLE PASSWORD BOTH"
        varchar password_hash "scrypt"
        set module_access
        set chat_modes
        enum salesforce_scope
        boolean is_break_glass
        boolean is_demo
        boolean active
    }
    roles {
        bigint id PK
        varchar code UK
        boolean is_system
    }
    user_roles {
        bigint user_id PK, FK
        bigint role_id PK, FK
        bigint assigned_by FK
    }
    approver_groups {
        bigint id PK
        varchar code UK
        varchar name
    }
    approver_group_members {
        bigint group_id PK, FK
        bigint user_id PK, FK
    }
    delegations {
        bigint id PK
        bigint user_id FK "the person away"
        bigint delegate_id FK
        date starts_on
        date ends_on
        datetime ended_at
    }
    user_devices {
        bigint id PK
        bigint user_id FK, UK
        char device_key_hash UK
        datetime trusted_until
    }
    user_sessions {
        char id PK "UUID"
        bigint user_id FK
        bigint device_id FK
        enum auth_method
        bigint tried_by FK
        datetime expires_at
        datetime revoked_at
    }
    page_access_rules {
        bigint id PK
        varchar page_key UK
        enum scope UK
        bigint scope_id UK
        enum level
    }

    departments |o--o{ users : "department_id"
    designations |o--o{ users : "designation_id"
    users |o--o{ users : "reporting_manager_id"
    users |o--o{ departments : "hod_user_id"
    users ||--o{ user_roles : "user_id"
    roles ||--o{ user_roles : "role_id"
    approver_groups ||--o{ approver_group_members : "group_id"
    users ||--o{ approver_group_members : "user_id"
    users ||--o{ delegations : "user_id"
    users ||--o{ delegations : "delegate_id"
    users ||--o{ user_devices : "user_id"
    users ||--o{ user_sessions : "user_id"
    user_devices |o--o{ user_sessions : "device_id"
    users |o..o{ page_access_rules : "scope_id when scope USER"
    departments |o..o{ page_access_rules : "scope_id when scope DEPARTMENT"
```

By convention: `page_access_rules.scope_id` points at a user or a department depending on `scope` (0 for EVERYONE). The reporting hierarchy is `users.reporting_manager_id`, a self-reference.

### 2.2 Workflows, requests and approval steps

```mermaid
erDiagram
    users {
        bigint id PK
    }
    workflow_definitions {
        bigint id PK
        varchar code UK
        enum kind "PREDEFINED CUSTOM"
        varchar request_prefix
        bigint owner_user_id FK
        enum resubmit_policy
        json settings_json
        boolean active
    }
    workflow_versions {
        bigint id PK
        bigint workflow_id FK, UK
        int version_no UK
        enum status "DRAFT PUBLISHED ARCHIVED"
        json definition_json "nodes and edges"
        json form_json
        json builder_json
        bigint published_workflow_id UK "generated"
        int draft_revision
    }
    approval_requests {
        bigint id PK
        varchar request_no UK
        bigint workflow_version_id FK
        bigint requester_id FK, UK
        char submission_key UK
        enum status
        int round
        json form_data_json
        json state_json "engine state"
        int state_version "optimistic lock"
        datetime valid_until
        datetime deleted_at "soft delete"
        bigint deleted_by FK
    }
    approval_tasks {
        bigint id PK
        bigint request_id FK, UK
        varchar task_key UK
        varchar node_id
        enum task_type "APPROVAL WORK"
        int round
        bigint approver_id FK
        enum status
        bigint decided_by FK
        bigint on_behalf_of FK
        datetime due_at
        datetime escalate_at
    }
    task_reminders {
        bigint task_id PK, FK
        enum kind PK
        datetime sent_at
    }
    approval_events {
        bigint id PK
        bigint request_id FK
        varchar event_type
        bigint actor_id FK
        json payload_json
    }
    request_comments {
        bigint id PK
        bigint request_id FK
        bigint author_id FK
        varchar body
    }
    request_attachments {
        bigint id PK
        bigint request_id FK
        bigint uploaded_by FK
        varchar field_key
        varchar stored_path UK
        char sha256
    }
    request_revisions {
        bigint request_id PK, FK
        int round PK
        json fields_json
    }
    request_collaborators {
        bigint request_id PK, FK
        bigint user_id PK, FK
        datetime removed_at
    }
    consultations {
        bigint id PK
        bigint request_id FK
        bigint requested_by FK
        bigint consultee_id FK
        enum status
    }
    request_amendments {
        bigint id PK
        bigint original_id FK
        bigint amendment_id FK, UK
        json changes_json
    }
    request_submission_checks {
        bigint request_id PK, FK
        json result_json
        bigint budget_department
        enum budget_state
    }
    budgets {
        bigint id PK
        bigint department_id FK, UK
        smallint fy_start_year UK
        bigint amount_paise
    }
    request_sequences {
        varchar prefix PK
        smallint year PK
        int current_value
    }
    workflow_migrations {
        bigint id PK
        bigint workflow_id FK
        bigint from_version_id FK
        bigint to_version_id FK
        json mapping_json
    }
    workflow_migration_items {
        bigint id PK
        bigint migration_id FK
        bigint request_id FK
        enum outcome
    }

    users |o--o{ workflow_definitions : "owner_user_id"
    workflow_definitions ||--o{ workflow_versions : "workflow_id"
    workflow_versions ||--o{ approval_requests : "workflow_version_id"
    users ||--o{ approval_requests : "requester_id"
    approval_requests ||--o{ approval_tasks : "request_id"
    users ||--o{ approval_tasks : "approver_id"
    approval_tasks ||--o{ task_reminders : "task_id"
    approval_requests ||--o{ approval_events : "request_id"
    approval_requests ||--o{ request_comments : "request_id"
    approval_requests ||--o{ request_attachments : "request_id"
    approval_requests ||--o{ request_revisions : "request_id"
    approval_requests ||--o{ request_collaborators : "request_id"
    approval_requests ||--o{ consultations : "request_id"
    approval_requests ||--o{ request_amendments : "original_id"
    approval_requests ||--o| request_amendments : "amendment_id"
    approval_requests ||--o| request_submission_checks : "request_id"
    budgets |o..o{ request_submission_checks : "budget_department and budget_fy"
    workflow_definitions ||..o{ request_sequences : "request_prefix"
    workflow_definitions ||--o{ workflow_migrations : "workflow_id"
    workflow_versions ||--o{ workflow_migrations : "from and to version"
    workflow_migrations ||--o{ workflow_migration_items : "migration_id"
    approval_requests ||--o{ workflow_migration_items : "request_id"
```

By convention: `request_sequences.prefix` matches `workflow_definitions.request_prefix` (one row per prefix and year, locked while a number is taken); `request_submission_checks.budget_department` / `budget_fy` match a `budgets` row but have no FK. The engine's steps live in `workflow_versions.definition_json` and the request's `state_json`; `approval_tasks` is a projection of them for queues. Also linked to `approval_requests` by real FKs, not drawn: `request_links` (two FKs), `recent_views`, `stuck_snoozes`, `tasks.related_request_id`.

### 2.3 Notifications, audit, settings and jobs

```mermaid
erDiagram
    users {
        bigint id PK
    }
    notifications {
        bigint id PK
        bigint user_id FK
        varchar event_type
        enum category
        varchar entity_type
        bigint entity_id
        datetime read_at
        datetime archived_at
    }
    notification_deliveries {
        bigint id PK
        bigint notification_id FK
        enum channel "EMAIL WHATSAPP"
        enum status
        varchar provider_reference
        json payload_json "sealed"
        datetime next_retry_at
    }
    notification_outbox {
        bigint id PK
        bigint request_id
        json payload_json
        datetime claimed_at
        datetime sent_at
    }
    notification_preferences {
        bigint user_id PK, FK
        varchar event_group PK
        enum channel PK
        boolean enabled
    }
    notification_rules {
        bigint id PK
        enum kind
        enum module "APPROVAL TASK"
        json conditions_json
        json stages_json
    }
    notification_rule_sends {
        bigint id PK
        bigint rule_id FK, UK
        enum record_kind UK
        bigint record_id UK
        tinyint stage_no UK
        tinyint send_no UK
    }
    whatsapp_templates {
        bigint id PK
        varchar template_code UK
        varchar language UK
        int version UK
        varchar event_type
        enum status
    }
    whatsapp_template_variables {
        bigint id PK
        bigint template_id FK, UK
        int position UK
        varchar variable_key
    }
    audit_logs {
        bigint id PK
        bigint actor_user_id FK
        bigint on_behalf_of_user_id FK
        varchar action
        varchar entity_type
        varchar entity_id
        json metadata_json
        datetime occurred_at
    }
    system_settings {
        bigint id PK
        varchar setting_key UK
        varchar setting_group
        boolean encrypted
        text value
    }
    settings_change_history {
        bigint id PK
        varchar setting_key
        bigint changed_by FK
        varchar old_value_reference
        varchar new_value_reference
    }
    jobs {
        bigint id PK
        varchar job_type
        enum status
        datetime run_after
    }
    job_runs {
        bigint id PK
        varchar run_ref
        varchar job_key
        enum status
        varchar error_code
    }
    approval_requests {
        bigint id PK
    }

    users ||--o{ notifications : "user_id"
    notifications ||--o{ notification_deliveries : "notification_id"
    users ||--o{ notification_preferences : "user_id"
    notification_rules ||--o{ notification_rule_sends : "rule_id, cascade"
    whatsapp_templates ||--o{ whatsapp_template_variables : "template_id"
    users |o--o{ audit_logs : "actor_user_id"
    users |o--o{ audit_logs : "on_behalf_of_user_id"
    users |o--o{ system_settings : "updated_by"
    users |o--o{ settings_change_history : "changed_by"
    system_settings ||..o{ settings_change_history : "setting_key"
    approval_requests |o..o{ notification_outbox : "request_id"
```

By convention: `notification_outbox.request_id`, `notifications.entity_type` / `entity_id`, `notification_rule_sends.record_kind` / `record_id` (an `approval_tasks` or `tasks` id), `audit_logs.entity_type` / `entity_id` / `session_id`, and `settings_change_history.setting_key`. `jobs` and `job_runs` have no FKs. There is no backups table: the daily backup is the `backup` automation, and each run is a `job_runs` row.

### 2.4 Tasks and projects

```mermaid
erDiagram
    users {
        bigint id PK
    }
    module_types {
        bigint id PK
        enum module UK "TASK INFO"
        varchar code UK
        varchar name
        boolean active
    }
    module_type_versions {
        bigint id PK
        bigint type_id FK, UK
        int version_no UK
        enum status
        json form_json
        json settings_json
        bigint published_type_id UK "generated"
    }
    tasks {
        bigint id PK
        varchar task_no UK
        bigint type_version_id FK
        bigint parent_task_id FK
        bigint root_task_id
        bigint series_id
        bigint assign_group_id
        bigint assignee_id FK
        bigint created_by FK, UK
        char submission_key UK
        bigint related_request_id FK
        enum status
        enum priority
        datetime due_at
        json form_data_json
        json recurrence_json
        int row_version
        datetime deleted_at "soft delete"
    }
    task_events {
        bigint id PK
        bigint task_id FK
        bigint actor_id FK
        varchar event_type
    }
    task_item_reminders {
        bigint task_id PK, FK
        varchar kind PK
    }
    projects {
        bigint id PK
        varchar name
        bigint department_id FK
        enum privacy
        bigint owner_id FK
        boolean is_template
        json template_json
        json permissions_json
        datetime deleted_at "soft delete"
    }
    project_members {
        bigint project_id PK, FK
        enum member_type PK "USER DEPARTMENT"
        bigint member_id PK
        enum role
    }
    project_sections {
        bigint id PK
        bigint project_id FK
        double position
        datetime deleted_at
    }
    task_projects {
        bigint task_id PK, FK
        bigint project_id PK, FK
        bigint section_id FK
        double position
    }
    project_fields {
        bigint id PK
        bigint project_id FK "NULL = library field"
        enum kind "11 types"
        boolean is_library
        json config_json
        varchar id_prefix
    }
    project_field_links {
        bigint project_id PK, FK
        bigint field_id PK, FK
        double position
        datetime removed_at
    }
    project_field_options {
        bigint id PK
        bigint field_id FK
        tinyint color
        datetime archived_at
    }
    task_field_values {
        bigint task_id PK, FK
        bigint field_id PK, FK
        varchar value "kept, plain text"
        decimal number_value
        date date_value
        bigint option_id
        json ids_json
    }
    task_field_timer_runs {
        bigint id PK
        bigint task_id FK
        bigint field_id FK
        bigint user_id FK
    }
    task_comments {
        bigint id PK
        bigint task_id FK
        bigint parent_comment_id FK
        bigint author_id FK
        datetime deleted_at
    }
    task_followers {
        bigint task_id PK, FK
        bigint user_id PK, FK
        enum source
    }
    task_dependencies {
        bigint blocker_task_id PK, FK
        bigint blocked_task_id PK, FK
        enum dep_type
        smallint lag_days
    }
    work_tags {
        bigint id PK
        varchar name UK
    }
    task_tags {
        bigint task_id PK, FK
        bigint tag_id PK, FK
    }
    my_task_sections {
        bigint id PK
        bigint user_id FK, UK
        enum system_key UK
    }
    my_task_placements {
        bigint user_id PK, FK
        bigint task_id PK, FK
        bigint section_id FK
    }

    module_types ||--o{ module_type_versions : "type_id"
    module_type_versions ||--o{ tasks : "type_version_id"
    tasks |o--o{ tasks : "parent_task_id"
    users ||--o{ tasks : "assignee_id"
    tasks ||--o{ task_events : "task_id"
    tasks ||--o{ task_item_reminders : "task_id"
    users ||--o{ projects : "owner_id"
    projects ||--o{ project_members : "project_id"
    projects ||--o{ project_sections : "project_id"
    tasks ||--o{ task_projects : "task_id"
    projects ||--o{ task_projects : "project_id"
    project_sections ||--o{ task_projects : "section_id"
    projects ||--o{ project_fields : "project_id"
    tasks ||--o{ task_field_values : "task_id"
    project_fields ||--o{ task_field_values : "field_id"
    project_fields ||--o{ project_field_links : "field_id"
    projects ||--o{ project_field_links : "project_id"
    project_fields ||--o{ project_field_options : "field_id"
    project_fields ||--o{ task_field_timer_runs : "field_id"
    tasks ||--o{ task_comments : "task_id"
    task_comments |o--o{ task_comments : "parent_comment_id"
    tasks ||--o{ task_followers : "task_id"
    users ||--o{ task_followers : "user_id"
    tasks ||--o{ task_dependencies : "blocker_task_id"
    tasks ||--o{ task_dependencies : "blocked_task_id"
    tasks ||--o{ task_tags : "task_id"
    work_tags ||--o{ task_tags : "tag_id"
    users ||--o{ my_task_sections : "user_id"
    my_task_sections ||--o{ my_task_placements : "section_id, cascade"
    tasks ||--o{ my_task_placements : "task_id"
    tasks |o..o{ tasks : "root_task_id, series_id, assign_group_id"
```

By convention: `tasks.root_task_id`, `series_id` and `assign_group_id` (all point at another `tasks` row), `project_members.member_id` (a user or a department, by `member_type`), `work_views.scope_id` (a user or a project), `work_likes.target_id`, `work_favourites.object_id`, and `task_followers.added_by` / `task_comments.deleted_by` (no FK).

### 2.5 Information

```mermaid
erDiagram
    users {
        bigint id PK
    }
    module_type_versions {
        bigint id PK
    }
    info_items {
        bigint id PK
        varchar info_no UK
        bigint type_version_id FK
        enum status "DRAFT PUBLISHED WITHDRAWN ARCHIVED"
        enum priority
        boolean ack_required
        bigint created_by FK
        bigint withdrawn_by FK
        json form_data_json
        int row_version
    }
    info_targets {
        bigint info_id PK, FK
        enum target_type PK
        bigint target_id PK
    }
    info_recipients {
        bigint info_id PK, FK
        bigint user_id PK, FK
        varchar source
        datetime read_at
        datetime acknowledged_at
    }
    info_events {
        bigint id PK
        bigint info_id FK
        bigint actor_id FK
        varchar event_type
    }
    record_files {
        bigint id PK
        enum entity_type "TASK INFO"
        bigint entity_id
        varchar purpose "GENERAL EVIDENCE INTERNAL (v1.71.2: internal ticket remark)"
        bigint uploaded_by FK
        varchar stored_path UK
        char sha256
    }

    module_type_versions ||--o{ info_items : "type_version_id"
    users ||--o{ info_items : "created_by"
    info_items ||--o{ info_targets : "info_id"
    info_items ||--o{ info_recipients : "info_id"
    users ||--o{ info_recipients : "user_id"
    info_items ||--o{ info_events : "info_id"
    users ||--o{ record_files : "uploaded_by"
    info_items |o..o{ record_files : "entity_id when INFO"
```

By convention: `info_targets.target_id` (a user, department or group by `target_type`, 0 for EVERYONE) and `record_files.entity_id` (a `tasks` or `info_items` id, by `entity_type`). Recipients are fixed when the item is published.

### 2.6 Calendar

```mermaid
erDiagram
    users {
        bigint id PK
    }
    gcal_settings {
        tinyint id PK "always 1"
        boolean enabled
        text client_secret_enc "encrypted"
        json config_json
    }
    gcal_connections {
        bigint id PK
        bigint user_id FK, UK
        text refresh_token_enc "encrypted"
        text access_token_enc "encrypted"
        varchar channel_id UK
        enum status
    }
    gcal_links {
        bigint id PK
        bigint connection_id FK, UK
        bigint user_id
        enum entity_type UK
        bigint entity_id UK
        varchar google_event_id UK
        enum state
    }
    gcal_jobs {
        bigint id PK
        bigint connection_id FK
        enum kind
        enum status
        varchar pending_key UK
    }
    gcal_conflicts {
        bigint id PK
        bigint link_id FK
        bigint user_id
        enum status
        enum resolution
    }
    gcal_oauth_states {
        char state_hash PK
        bigint user_id FK
        datetime expires_at
        datetime used_at
    }
    calendar_items {
        bigint id PK
        bigint user_id FK
        enum origin "ARS GOOGLE"
        datetime starts_at
        date start_date
        int version
        datetime deleted_at "soft delete"
    }
    holidays {
        date holiday_on PK
        varchar name
    }
    department_holidays {
        bigint department_id PK, FK
        date holiday_on PK
        varchar name
    }
    departments {
        bigint id PK
    }

    users ||--o| gcal_connections : "user_id"
    gcal_connections ||--o{ gcal_links : "connection_id"
    gcal_connections ||--o{ gcal_jobs : "connection_id"
    gcal_links ||--o{ gcal_conflicts : "link_id"
    users ||--o{ gcal_oauth_states : "user_id"
    users ||--o{ calendar_items : "user_id"
    calendar_items |o..o{ gcal_links : "entity_id when ITEM"
    departments ||--o{ department_holidays : "department_id"
```

By convention: `gcal_links.user_id`, `gcal_links.entity_id` (an approval step, request, task, information item or calendar item, by `entity_type`), `gcal_conflicts.user_id` / `resolved_by`, and `gcal_jobs.created_by`. `holidays` (organisation-wide) and `department_holidays` feed the working calendar used for response times.

### 2.7 AI assistant and Salesforce

```mermaid
erDiagram
    users {
        bigint id PK
    }
    ai_conversations {
        bigint id PK
        bigint owner_user_id FK
        varchar title
        varchar mode
        datetime pinned_at
    }
    ai_messages {
        bigint id PK
        bigint conversation_id FK, UK
        char request_key UK
        enum role "user assistant"
        mediumtext content
        varchar provider
        varchar model
        json evidence_json
    }
    ai_proposals {
        bigint id PK
        bigint conversation_id
        bigint requested_by FK
        bigint approver_user_id FK
        enum kind
        enum status
        char content_hash
    }
    ai_rules {
        varchar chat_mode PK
        mediumtext content
        bigint updated_by FK
    }
    ai_salesforce_connection {
        tinyint id PK "always 1"
        enum status
        text access_token_enc "encrypted"
        text refresh_token_enc "encrypted"
        text pending_verifier_enc "encrypted"
    }
    ai_sync_runs {
        bigint id PK
        varchar source_key
        varchar dataset
        enum status
    }
    ai_source_records {
        varchar source_key PK
        varchar dataset PK
        varchar record_id PK
        json data_json
    }

    users ||--o{ ai_conversations : "owner_user_id"
    ai_conversations ||--o{ ai_messages : "conversation_id"
    users ||--o{ ai_proposals : "requested_by"
    users |o--o{ ai_proposals : "approver_user_id"
    ai_conversations |o..o{ ai_proposals : "conversation_id"
    users ||--o{ ai_rules : "updated_by"
    ai_sync_runs ||..o{ ai_source_records : "source_key and dataset"
```

By convention: `ai_proposals.conversation_id`, `ai_sync_runs.started_by`, and `ai_salesforce_connection.pending_user_id` / `connected_by` have no FK. `ai_source_records` is keyed by the source's own record id (for example a Salesforce Id), so a repeated sync never duplicates. Provider API keys are not in these tables: they are encrypted rows in `system_settings`.

---

## 3. Every table

Migration names are shortened to their date-time prefix; the full file is `database/migrations/<prefix>_*.sql`.

| Table | Area | Purpose | Created in |
|---|---|---|---|
| `departments` | Organisation | Departments, with the HOD | 202609281200 |
| `designations` | Organisation | Job titles; `is_approver` says who can be chosen as an approver | 202609281200 |
| `users` | People | Every person: sign-in method, manager, modules, AI chat modes; `is_system` since v1.66.0 (the one system user "ARS-CMS Automation", never signs in) | 202609281201, 202611221500 |
| `roles` | People | Role list (SUPER_ADMIN, IT_ADMIN, USER and more) | 202609281201 |
| `user_roles` | People | Which roles each person holds | 202609281201 |
| `otp_challenges` | Sign-in | WhatsApp one-time codes, stored as hashes | 202609281202 |
| `user_devices` | Sign-in | Browsers a person has signed in from | 202609281202 |
| `user_sessions` | Sign-in | Server-side sessions, so they can be revoked | 202609281202 |
| `login_logs` | Sign-in | Every sign-in attempt, good or bad | 202609281202 |
| `audit_logs` | Audit | Append-only record of every action | 202609281203 |
| `system_settings` | Settings | Super Admin settings; secrets encrypted | 202609281204 |
| `settings_change_history` | Settings | Who changed which setting, with opaque references only | 202609281204 |
| `whatsapp_templates` | Notifications | WhatsApp templates, one row per version | 202609281205 |
| `whatsapp_template_variables` | Notifications | Positional variables of a template | 202609281205 |
| `whatsapp_rate_limit_log` | Notifications | WhatsApp send limiter | 202609281205 |
| `notifications` | Notifications | In-app inbox, one row per event and person | 202609281205 |
| `notification_deliveries` | Notifications | One email or WhatsApp send per notification, with retries | 202609281205 |
| `jobs` | Jobs | Queued background work run by the cron runner | 202609281205 |
| `password_tokens` | Sign-in | Single-use set-password links (hash only) | 202609291200 |
| `approver_groups` | Approvals | Named groups used as an approver source | 202609291201 |
| `approver_group_members` | Approvals | Members of each group | 202609291201 |
| `workflow_definitions` | Approvals | Approval types (predefined or custom) | 202609291201 |
| `workflow_versions` | Approvals | Versions of a type: node graph, form, builder spec | 202609291201 |
| `request_sequences` | Approvals | Next request number per prefix and year | 202609291201 |
| `approval_requests` | Approvals | Each request, with the engine state | 202609291201 |
| `approval_tasks` | Approvals | Approval and work steps, for queues | 202609291201 |
| `approval_events` | Approvals | Append-only request timeline | 202609291201 |
| `rate_limit_hits` | Security | Sliding-window rate-limit counters | 202609301200 |
| `request_comments` | Approvals | Discussion on a request; rows never deleted; since v1.60.0 the text can be edited or marked deleted (earlier text in `comment_versions`) | 202610011200, 202611211000 |
| `comment_versions` | Approvals, Tickets, Tasks | Append-only: the text a request comment, ticket remark or task comment had before each edit or delete (D-365) | 202611211000 |
| `delegations` | Approvals | Out of office: who acts for whom, and when | 202610011200 |
| `task_reminders` | Approvals | Reminders and escalations already sent per step | 202610011200 |
| `holidays` | Calendar | Organisation holidays for the working calendar | 202610011300 |
| `request_attachments` | Approvals | Files on requests (bytes on disk in UPLOAD_DIR) | 202610071200 |
| `notification_outbox` | Notifications | Messages written with the action, sent after commit; `claim_token` (v1.40.0, D-243) marks one claimed send | 202610081300, 202611010900 |
| `push_subscriptions` | Notifications | One row per browser push endpoint; keys encrypted (v1.41.0, §4) | 202611011200 |
| `admin_broadcasts` | Notifications | Notices IT sent from Admin → Notifications (v1.41.0, §4) | 202611011200 |
| `condition_rules_backup` | Runner | Each row's `form_json` as it was before the v1.46.0 rule conversion (`table_name`, `row_id` primary key); only for rollback; may be dropped once the release has settled | 202611021000 |
| `hod_report_runs` | Reports | The weekly HOD report: one row per department and week (claimed before sending; SENDING, SENT or FAILED; `attempts` since v1.57.6) | 202611011000, 202611191200 |
| `used_security_links` | Security | "This wasn't me" links already used | 202610091000 |
| `request_drafts` | Approvals | Autosaved request drafts, one per person and form | 202610100900 |
| `saved_views` | Personal | A person's saved request filters | 202610100900 |
| `notification_preferences` | Notifications | Per-person channel choices that differ from the default | 202610100900 |
| `user_flags` | Personal | Small per-person flags (checklist dismissed and so on) | 202610100900 |
| `user_settings` | Personal | Per-person settings such as the theme | 202610110900 |
| `recent_views` | Personal | Recently viewed requests | 202610110900 |
| `consultations` | Approvals | An approver asks someone for advice | 202610110900 |
| `request_revisions` | Approvals | What was submitted in each round | 202610110900 |
| `request_links` | Approvals | Related and follow-up links between requests | 202610110900 |
| `budgets` | Approvals | Department budget per financial year (paise) | 202610110900 |
| `request_submission_checks` | Approvals | Readiness and budget check made at submit | 202610110900 |
| `request_templates` | Approvals | A person's reusable values for one approval type | 202610110900 |
| `job_runs` | Jobs | One row per automation step per runner call (backups included) | 202610121000 |
| `stuck_snoozes` | Approvals | IT snoozes a stuck-request finding | 202610121000 |
| `request_amendments` | Approvals | Links an amendment request to its original | 202610121100 |
| `workflow_migrations` | Approvals | A run moving open requests to another version | 202610121200 |
| `workflow_migration_items` | Approvals | Each request's outcome in that run | 202610121200 |
| `analytics_views` | Reports | Saved Analytics and report filters | 202610121300 |
| `report_schedules` | Reports | Reports emailed on a schedule | 202610121300 |
| `report_runs` | Reports | Each scheduled run (`attempts` since v1.57.6: an interrupted run is retried once) | 202610121300, 202611191200 |
| `alert_rules` | Reports | A person's metric alerts | 202610121300 |
| `alert_events` | Reports | Each time an alert fired | 202610121300 |
| `legal_holds` | Governance | Holds that block deletion or pruning | 202610121400 |
| `request_collaborators` | Approvals | People following a request (never decide) | 202610130900 |
| `export_jobs` | Reports | Large exports made in the background (`attempts`: up to 3 tries since v1.57.6) | 202610140900, 202611191200 |
| `custom_approval_settings` | Approvals | Custom approval form and policy (one row) | 202610150900 |
| `page_access_rules` | People | Hidden, View or Full per page and scope | 202610150900 |
| `module_types` | Tasks / Information | Task types and Information types | 202610160900 |
| `module_type_versions` | Tasks / Information | Versions of a type: form and settings | 202610160900 |
| `tasks` | Tasks | Tasks, subtasks, recurring and ad hoc copies | 202610160900 |
| `task_events` | Tasks | Append-only task history | 202610160900 |
| `task_item_reminders` | Tasks | Task reminders already sent | 202610160900 |
| `info_items` | Information | Information items, optionally acknowledged | 202610160900 |
| `info_targets` | Information | Who an item was addressed to, as chosen | 202610160900 |
| `info_recipients` | Information | People it reached, with read and acknowledged times | 202610160900 |
| `info_events` | Information | Append-only item history | 202610160900 |
| `record_files` | Tasks / Information | Files on tasks and information items (later tickets and project messages). `purpose` GENERAL / EVIDENCE (work-step "done") / INTERNAL (v1.71.2, D-388: on an internal ticket remark; hidden from people who don't see internal remarks; no migration, the column is VARCHAR) | 202610160900 |
| `gcal_settings` | Calendar | Google Calendar set-up (one row) | 202610170900 |
| `gcal_connections` | Calendar | A person's Google Calendar connection | 202610170900 |
| `calendar_items` | Calendar | Personal calendar entries | 202610170900 |
| `gcal_links` | Calendar | Which ARS record each Google event stands for | 202610170900 |
| `gcal_jobs` | Calendar | Sync work with retries | 202610170900 |
| `gcal_conflicts` | Calendar | Events changed on both sides, for review | 202610170900 |
| `gcal_oauth_states` | Calendar | Single-use OAuth state values | 202610170900 |
| `ai_conversations` | AI | A person's AI chats | 202610241200 |
| `ai_messages` | AI | Questions and answers, with usage | 202610241200 |
| `ai_proposals` | AI | Actions the AI proposes; a person decides | 202610241200 |
| `ai_sync_runs` | AI / Salesforce | Each read-only sync of an outside source | 202610241200 |
| `ai_source_records` | AI / Salesforce | Records copied from that source | 202610241200 |
| `ai_salesforce_connection` | AI / Salesforce | The one Salesforce connection (one row) | 202610250900 |
| `ai_rules` | AI | Rules ("training") per chat mode, in Markdown | 202610251400 |
| `notification_rules` | Notifications | Reminder and escalation rules built in Admin | 202610281200 |
| `notification_rule_sends` | Notifications | Each rule send, once per record, stage and repeat | 202610281200 |
| `projects` | Projects | Projects and project templates; since v1.65.0 `shift_mode` (OFF / KEEP_GAP / CONSUME), `shift_skip_off_days`, `status_reminder` and `status_reminded_on` (the India day of the last Friday reminder) | 202610301000, 202611221400 |
| `project_members` | Projects | Members (people or departments) with a role | 202610301000 |
| `project_sections` | Projects | Sections of a project | 202610301000 |
| `task_projects` | Projects | A task's place in each project | 202610301000 |
| `task_followers` | Tasks | People following a task; `source` FORM since v1.66.0 (the submitter of a project form) | 202610301000, 202611221500 |
| `project_forms` | Projects | v1.66.0: a project's intake forms (kind PROJECT_INTAKE of the shared Form Builder): `share_token` (128 random bits, base64url; `/users/forms/<token>`, signed in only), `status` (DRAFT / PUBLISHED / UNPUBLISHED), `name`, `description`, `cover_path` / `cover_type`, `draft_json` (`fields`: the builder's FormField list; `mappings`: question key → task field or project field), `settings_json` (section, default assignee, due offset in working days, copy to description, confirmation, Submit another, add followers, who may submit, notices), `current_version_id`, `draft_changed`, `row_version`, soft delete | 202611221500 |
| `project_form_versions` | Projects | v1.66.0: each published snapshot of a form (`version_no` per form, `snapshot_json` never changed); people fill in the current one | 202611221500 |
| `project_form_submissions` | Projects | v1.66.0: one row per accepted submission: the version answered, the submitter, the typed answers (`answers_json`), the task made; UNIQUE (`form_id`, `submitter_id`, `submission_key`) stops a double submit; the hourly limit (20 per person per form) counts these rows | 202611221500 |
| `project_dashboard_widgets` | Projects | v1.67.0: a project's dashboard widgets in order (`position`): `kind` CHART (`config_json`: the chart setup checked by `server/work/reporting.ts`) or TEXT (`body`, ≤ 2000), `title` (≤ 80), `size` HALF / FULL, `row_version`; `created_by` NULL for the 8 default widgets; ≤ 20 a project | 202611221600 |
| `project_capacity` | Projects | v1.67.0: Workload capacity per working day: `user_id` NULL = the project's default, else one person's; `metric` `count` or `f<field id>` (a number or timer field); UNIQUE (`project_id`, `metric`, `user_key`) | 202611221600 |
| `task_comments` | Tasks | Task comments with one level of replies | 202610301000 |
| `work_likes` | Tasks | Likes on tasks, comments and status updates | 202610301000 |
| `task_dependencies` | Tasks | Blocked-by links between tasks; since v1.65.0 `dep_type` (FS default, SS, FF, SF) and `lag_days` (reserved, 0) | 202610301000, 202611221400 |
| `task_shift_batches` | Tasks | v1.65.0: one date change and the dependent tasks it moved (`undo_json`: every task's dates before and after), so its mover can Undo for 15 minutes (`undone_at`); removed after 7 days by the `statusReminders` step | 202611221400 |
| `work_tags` | Tasks | Organisation-wide tags | 202610301000 |
| `task_tags` | Tasks | Tags on each task | 202610301000 |
| `project_status_updates` | Projects | Status posts, frozen when posted; since v1.65.0 `owner_id`, `start_on`, `due_on`, `next_steps` (body = Summary), `highlights_json` (picked completed milestones/tasks, frozen) and `recipients_json` (who was told) | 202610301000, 202611221400 |
| `project_events` | Projects | Project history (the app only inserts) | 202610301000 |
| `work_favourites` | Personal | Starred projects and searches | 202610301000 |
| `work_recent_projects` | Personal | Recently opened projects | 202610301000 |
| `my_task_sections` | Tasks | A person's My Tasks sections | 202610301000 |
| `my_task_placements` | Tasks | Where each task sits in My Tasks | 202610301000 |
| `work_saved_searches` | Personal | Saved task searches | 202610301000 |
| `project_fields` | Projects | Custom field definitions: 11 types (v1.64.0), local (`project_id`) or library (`project_id` NULL, `is_library`, unique `library_key`), description, `notify_on_change`, `config_json` (number format and decimals, formula `{f<id>}`, date with time, lookup fields), `id_prefix` / `id_next`, soft delete (`deleted_at`, `deleted_by`; purged after 30 days) | 202610301200, 202611221300 |
| `project_field_links` | Projects | Which projects show which fields, in what order, `show_on_cards`; `removed_at` = removed from the project (values kept) | 202611221300 |
| `project_field_options` | Projects | Options of single- and multi-select fields: name, `color` 1..8 (identity tokens), position, `archived_at` | 202611221300 |
| `task_field_values` | Projects | Custom field values on tasks. Typed columns since v1.64.0 (`text_value`, `number_value`, `date_value`, `time_value`, `option_id`, `ids_json`, `id_seq` unique per field, `typed_at`); `value` is the plain-text copy kept until the owner confirms (G0j) | 202610301200, 202611221300 |
| `task_field_timer_runs` | Projects | Timer field runs per person (one running run per person, task and field) | 202611221300 |
| `work_digest_sends` | Tasks | Daily digests already sent | 202610301200 |
| `department_holidays` | Calendar | Holidays of one department only | 202610301200 |
| `work_views` | Tasks | Saved view tabs for My Tasks and projects; since v1.61.0 a project tab has a `view_type` (LIST, BOARD, CALENDAR, TIMELINE, OVERVIEW; GANTT since v1.65.0) and one tab per project `is_default` | 202610301400, 202611221000 |
| `schema_migrations` | Runner | Migration files already applied | `migrate.js` |
| `schema_migration_progress` | Runner | Statements done in a file that failed halfway | `migrate.js` |

---

## 4. Notable constraints

### Append-only (triggers)
These tables reject every `UPDATE` and `DELETE` with `SIGNAL SQLSTATE '45000'`:
- **Required:** `audit_logs`, `approval_events`, `request_comments` (6 triggers). The migration fails if the database user can't create triggers.
- **Optional:** `task_events`, `info_events` (4 triggers, marked `-- @optional`). Skipped with a warning when not allowed; `database/optional/v190_append_only_triggers.sql` adds them later.
- **App-level only (no trigger):** `project_events`, `request_attachments`, `request_submission_checks`. The app only inserts.

### Unique keys worth knowing
- **One published version per parent:** `workflow_versions.published_workflow_id` and `module_type_versions.published_type_id` are stored generated columns (the parent id when `status = 'PUBLISHED'`, otherwise NULL) with a unique key. MySQL has no partial index, so this does the job.
- **Idempotent submit:** `approval_requests (requester_id, submission_key)`, `tasks (created_by, submission_key)`, `ai_messages (conversation_id, request_key)`. A retried submit returns the first record.
- **Send once:** `task_reminders (task_id, kind)`, `task_item_reminders (task_id, kind)`, `notification_rule_sends (rule_id, record_kind, record_id, stage_no, send_no)`, `work_digest_sends (user_id, day)`, `report_runs (schedule_id, due_at)`, `gcal_jobs.pending_key`.
- **Identity:** `users.login_id`, `email`, `whatsapp_number`, `firebase_uid`; `approval_requests.request_no`; `tasks.task_no`; `info_items.info_no`; `request_attachments.stored_path`; `record_files.stored_path`.
- **One per person:** `gcal_connections.user_id`; `request_amendments.amendment_id` (an amendment has one original).

### v1.41.0 (D-250, D-252): push and daily sessions
- **`push_subscriptions`:**
  - one row per browser push endpoint (`endpoint_hash` unique);
  - `user_id`, `p256dh_enc` and `auth_enc` (AES-256-GCM);
  - `device_type`, `browser`, `operating_system`, `installed`, `permission`;
  - `status` ACTIVE / EXPIRED (the push service answered 404/410) / REMOVED;
  - `failure_count`, `last_failure_code`, `last_seen_at`, `last_used_at`.
  Signing out never changes it. Expired or removed rows are deleted after 90 days (housekeeping).
- **`notification_deliveries`:** channel `PUSH`; `subscription_id`. QUEUED rows are the push queue (`next_retry_at` = when due); SENT = accepted by the push service; FAILED keeps the code.
- **`notification_preferences.channel`:** adds `PUSH` ("Phone & desktop" in Profile → Notifications).
- **`admin_broadcasts`:** what IT sent from Admin → Notifications (title, message, category, priority, link, the audience as chosen and in words, recipients). `notifications.broadcast_id` links each Inbox message to it; `notifications.priority` is NORMAL or HIGH.
- **`user_sessions.session_policy`:** IDLE (the idle limit and 12 hours) or DAILY (ends at the next midnight IST, no idle limit).

### v1.46.0 (D-278 to D-280): rules, engine decisions, settings
Only one schema change: the table `condition_rules_backup` (above). Everything else lives in existing JSON columns:
- **Form rules** (`workflow_versions.form_json`, `module_type_versions.form_json`, `custom_approval_settings.form_json`, each field's `showIf` / `requiredIf`): one shape everywhere, `{ field, operator, value? }` or `{ match: "ALL" | "ANY", conditions: [...] }` (`server/conditions/rule.ts`; operators EQ, NEQ, GT, GTE, LT, LTE, IN, NOT_IN, CONTAINS, IS_EMPTY, IS_NOT_EMPTY). The older `{ field, op, value }` (FILLED, EMPTY …) is converted by the migration and, until then, on every read.
- **Join option** (`workflow_versions.definition_json`, a JOIN node with ANY_ONE / ANY_N): `onReject: "END" | "WHEN_UNREACHABLE"` (absent = END). WHEN_UNREACHABLE ends only the rejected branch until the join can no longer be met; refused on ALL joins.
- **Request state** (`approval_requests.state_json`): `failedJoinEdges` (join id → incoming edges whose branch was rejected), `mayFinishWithoutApprover` (stamped at submit), `humanCheck: { nodeId, endNodeId }` (the step given to the HOD when nobody approved).
- **Type setting** (`workflow_definitions.settings_json`): `mayFinishWithoutApprover` (boolean, default false; honoured for PREDEFINED types only).
- **New event types** (`approval_events.event_type`, details in `payload_json`): `ROUTE_CHANGED` (`added`, `removed`, `approverChanged`, `restartNodeIds`, `fromBeginning`), `BRANCH_ENDED` (`nodeId`, `joinId`), `HUMAN_APPROVAL_ROUTED` (`nodeId`, `to`: HOD or IT, `userIds`), `EXPIRED_REUSED` (`kind`: AMENDMENT or FOLLOW_UP, `reason`, `newRequestId`, `newRequestNo`).
- **Expired** is derived from `approval_requests.valid_until` (status APPROVED and the date passed); the stored status stays `APPROVED`.
- **Settings** (`system_settings`, group GDRIVE_BACKUP): `backup.gdrive_enabled` (ON/OFF, default OFF), `backup.gdrive_service_account_json` (**encrypted**), `backup.gdrive_folder_id` (**encrypted**), `backup.gdrive_keep` (1–90, default 14).
- **Audit actions** (`audit_logs.action`): `SECURITY_RECORDS_PURGED`, `BACKUP_COPIED_TO_DRIVE`, `GDRIVE_BACKUP_TESTED`, `BREAK_GLASS_SIGNIN_NO_OTP`. `login_logs.step` may be `PASSWORD` for a break-glass sign-in without the code.
- **Job runs** (`job_runs.job_key`): `securityRetention`, `driveBackup`.

### Encrypted and hashed columns
- **AES-256-GCM with `ENCRYPTION_KEY`** (`lib/security/encryption.ts`): `system_settings.value` when `encrypted = TRUE` (API keys, webhook secret, Salesforce app keys); `gcal_settings.client_secret_enc`; `gcal_connections.refresh_token_enc`, `access_token_enc`; `ai_salesforce_connection.access_token_enc`, `refresh_token_enc`, `pending_verifier_enc`. Changing `ENCRYPTION_KEY` makes these unreadable; they must be entered again.
- **Sealed in code:** `notification_deliveries.payload_json` is stored as `{"sealed": "<encrypted>"}` since v1.3.6 (`lib/security/delivery-payload.ts`), because it can hold a set-password link. The column type is still plain JSON.
- **Hashes only, never the value:** `users.password_hash` (scrypt); `otp_challenges.otp_hash`, `challenge_token_hash`; `password_tokens.token_hash`; `user_devices.device_key_hash`; `used_security_links.token_hash`; `gcal_connections.channel_token_hash`; `gcal_oauth_states.state_hash`, `nonce_hash`; `ai_salesforce_connection.pending_state_hash`.
- `settings_change_history` keeps only opaque references, never the old or new plaintext.

### Soft deletes and "never deleted"
- **`deleted_at` soft delete:** `approval_requests` (with `deleted_by`, `delete_reason`; every screen, queue, job and report ignores it), `tasks`, `projects`, `project_sections`, `project_fields`, `task_comments`, `project_status_updates`, `calendar_items`.
- **Ended, not deleted:** `users.active` (people are never deleted), `departments`, `designations`, `roles`, `approver_groups`, `module_types` (`active`); `delegations.ended_at`; `request_collaborators.removed_at`; `legal_holds.released_at`; `info_items` (WITHDRAWN, ARCHIVED); `workflow_versions` (ARCHIVED).
- **Rows that are hard-deleted on purpose:** `rate_limit_hits` (older than a day), `request_drafts` (on submit, discard or after 30 days), `notification_outbox` (sent rows after 30 days), `job_runs` (after 90 days), and since v1.46.0 (DR-06) `login_logs`, `otp_challenges`, ended `user_sessions`, `used_security_links` and used or expired `password_tokens` after 90 days (job step `securityRetention`; a person under an active legal hold keeps theirs). Export files are removed from disk after 7 days; their `export_jobs` row stays as EXPIRED. Legal holds stop pruning of what they cover.
- **Cascades:** only two. `notification_rule_sends` → `notification_rules` and `my_task_placements` → `my_task_sections` are `ON DELETE CASCADE`. Every other FK has no `ON DELETE` action, so a parent with children can't be deleted.

### JSON columns
JSON is used for engine and form data that changes shape between versions, not for anything the database must join on:
- **Engine and forms:** `workflow_versions.definition_json`, `form_json`, `builder_json`; `approval_requests.form_data_json`, `state_json`; `module_type_versions.form_json`, `settings_json`; `tasks.form_data_json`, `recurrence_json`; `info_items.form_data_json`; `custom_approval_settings.form_json`, `policy_json`; `workflow_definitions.settings_json`.
- **History and snapshots:** `audit_logs.metadata_json` (never secrets), `approval_events.payload_json`, `task_events.payload_json`, `info_events.payload_json`, `request_revisions.fields_json`, `request_amendments.changes_json`, `request_submission_checks.result_json`, `project_status_updates.snapshot_json`.
- **Saved filters and config:** `saved_views`, `analytics_views`, `report_schedules`, `export_jobs` (`query_json`); `work_views.config_json`; `projects.template_json`, `permissions_json`; `notification_rules.conditions_json`, `stages_json`; `gcal_settings.config_json`.
- **AI and integrations:** `ai_messages.evidence_json`, `unverified_json`; `ai_proposals.evidence_json`; `ai_source_records.data_json`; `gcal_conflicts.ars_json`, `google_json`.
- `users.module_access` and `users.chat_modes` are MySQL `SET` columns, not JSON.

### Optimistic locking
`approval_requests.state_version`, `tasks.row_version`, `info_items.row_version`, `projects.row_version`, `request_drafts.version`, `calendar_items.version`, `gcal_settings.version`, `ai_proposals.version` (with `content_hash`), and `workflow_versions.draft_revision` (a save from an older revision is refused). The app checks the number on every write.

### Times
Times are stored in UTC (`DATETIME`, set by `CURRENT_TIMESTAMP` or the app). India dates are plain `DATE` columns: `holidays.holiday_on`, `department_holidays.holiday_on`, `delegations.starts_on` / `ends_on`, `work_digest_sends.day`. Event and audit tables use `DATETIME(3)` (milliseconds) so their order is stable.

## v1.67.0: project dashboards and Workload (migration 202611221600_pm_d_dashboards, D-375)
- `projects.dashboard_set` BOOLEAN: the 8 default widgets were written (the first time anyone opened the Dashboard tab), so a dashboard whose editors removed every widget stays empty.
- `project_dashboard_widgets`, `project_capacity` (see the table list). `work_views.view_type` gets DASHBOARD and WORKLOAD.
- Chart figures are never stored: each is one SQL query (GROUP BY) over `task_projects`, `tasks`, `task_field_values` (typed columns) and, for time entries, `task_field_timer_runs` (stopped runs of the project's timer fields), limited to the tasks the viewer may see; formula fields are worked out in code from the same rows.

## v1.66.0: project intake forms (migration 202611221500_pm_c_intake_forms, D-374)
- `users.is_system` BOOLEAN (default FALSE) and one row `ars-cms-automation` / "ARS-CMS Automation" (active FALSE, no password, an `.invalid` email): the creator of tasks made from form submissions. The app reads it as inactive whatever its row says; sign-in rules and the session check refuse it; Admin → Users never lists it.
- `project_forms`, `project_form_versions`, `project_form_submissions` (see the table list). A form's questions use the shared Form Builder's `FormField` JSON (the same as approval, task-type and ticket forms); branches are the fields' `showIf` rules (`{field, operator: "IN", value: [options]}`), at most 5 levels.
- `tasks.source_form_id` → `project_forms`: the form a task came from (such a task is edited like a project task, not as an ad hoc task of its creator).
- `task_followers.source` gets `FORM`.

## v1.63.0: Home widgets, private notepad, My Tasks tabs (migration 202611221200_pm_a_home_widgets, D-369)
- `home_layouts` (user_id PK → users, `widgets_json` JSON `[{ "kind": "my_tasks" | "projects" | "status_updates" | "notepad" | "workload" | "assigned" | "people", "size": "half" | "full" }]` in order, at most 20, each kind once; `version` INT for optimistic saves; updated_at). No row = the default layout. Kinds of modules the person lacks are dropped when read and refused when saved (`server/home/widgets.ts`). `forms` is reserved for phase C.
- `home_notes` (user_id PK → users, `body` MEDIUMTEXT, the app's formatting text, at most 50,000 characters; `version`; updated_at): the private notepad, read and written only for the signed-in person.
- My Tasks tabs: `work_views` rows with `scope = 'MY_TASKS'`, `scope_id` = the person, `view_type` LIST / BOARD / CALENDAR (up to 30); `user_settings` key `work.my_tabs_set` = '1' once the person's strip is stored (like `projects.view_tabs_set`). Audit `MY_TASKS_TABS_CHANGED` (entity USER).

## v1.62.0: reactions, sidebar order, the 30-day purge (migration 202611221100_pm_a_reactions_sidebar, D-368)
- `comment_reactions` (comment_id → task_comments, user_id → users, `reaction` ENUM THUMBS_UP, HEART, TADA, SMILE, EYES, CHECK, created_at; PK comment+user+reaction): emoji reactions on task comments, toggled per person.
- `work_project_order` (user_id, `list_key` STARRED | DEPARTMENTS, project_id → projects, `position` DOUBLE; PK user+list+project): a person's manual order of the sidebar's Starred and Departments lists. Stars themselves stay in `work_favourites`.
- `user_settings` keys: `work.pane_w` (task pane width, 380–720 px), `work.celebrations` (OFF, OCCASIONAL, ALWAYS; absent = the Admin default), `work.sidebar_starred_sort` and `work.sidebar_departments_sort` (MANUAL, AZ, RECENT).
- `system_settings` key `tasks.pm_extras` JSON `{ "celebrations": "OCCASIONAL", "purge": true }` (Admin → Task settings).
- `trg_task_events_no_delete` now allows deleting the history of a task that has been deleted for more than 30 days (only the purge job does); updates stay refused.
- Purge job `workPurge`: removes tasks with `deleted_at` older than 30 days (not ticket or meeting tasks, not tasks of requests under a legal hold, not a parent whose subtask stays) and every row on them (reactions, likes, comment versions, comments, files and their stored copies, dependencies, tags, followers, field values, reminders, My Tasks places, project links, history, rule sends, calendar links), subtasks first; and projects deleted over 30 days ago with their sections, fields (and values), members, status updates, events, tabs, stars, recents and sidebar order (their tasks stay). Audit: `WORK_TASKS_PURGED`, `WORK_PROJECTS_PURGED` (one per batch).

## v1.61.0: project tabs for every view (migration 202611221000_pm_a_views_prefs, D-367)
- `work_views.view_type` ENUM('LIST','BOARD','CALENDAR','TIMELINE','OVERVIEW') default LIST (existing tabs are List tabs) and `work_views.is_default` (one per project; the tab that opens first). Up to 50 tabs per project (30 for My Tasks). `config_json` holds the List's grid view (filters, sort, groups, columns, `hideEmpty`) or the Board's (`incomplete`, `showDone`, `mine`, `dueWithin`, `sort`, `dir`, `sortField`, `search`); other views store `{}`.
- `projects.view_tabs_set`: FALSE = the strip is the five built-in views plus saved List tabs (computed); set TRUE the first time an owner or editor changes the strip, when the built-in views are written as `work_views` rows.
- `user_settings` key `work.density` = `COMPACT` (absent = Comfortable): a person's row height in task lists.
- Audit: `PROJECT_TABS_CHANGED` (metadata `op`: add, rename, default, duplicate, remove, reorder, save).

## v1.47.0: coloured choices and request priority (no schema change)
- Form JSON (`workflow_versions.form_json`, `module_type_versions.form_json`, `custom_approval_settings.form_json`): choice fields (CHOICE, RADIO, MULTI_CHOICE) may carry `optionColors`: `{ "<option>": "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "purple" | "pink" | "grey" }`.
- A request's priority is read from `approval_requests.form_data_json` at the key `priority` (case-insensitive) when its form version has a choice field with that key; nothing is stored separately.

## v1.54.0: approval templates (migration 202611111400_approval_templates)
- `approval_templates` (user_id, name unique per person, `spec_json` = `{"stages": [...]}` the levels as New request builds them, timestamps). Private to the person; at most 100 each. Never holds form values or files. The old `request_templates` (personal templates of IT approval types) is no longer used and is left in place.

## v1.53.0: the Projects module (migration 202611111300_project_module)
- `users.module_access` gains `PROJECT` (separate from `TASK`); nobody gets it (released later). The column default becomes `APPROVAL,TASK` (new people).

## v1.52.3: deleting request files (migration 202611111200_attachment_delete)
- `request_attachments.deleted_at`, `deleted_by`: a deleted file is marked, kept for audit, and left out of every read and count.

## v1.51.0: Meeting Management (migration 202611110900_meetings)
- `users.module_access` gains `MEETING` (default and every existing user).
- `meeting_types` (code, name, default points `template`, position, active; 11 seeded) and `meeting_management_members` (the Management group: ED, MD).
- `meetings`: `meeting_no` (MTG-YYYY-NNNNNN), title, description, type, organising department, `owner_id` (Meeting Owner), `coordinator_id`, mode/venue/link, priority (NORMAL, IMPORTANT, HIGH, URGENT as tasks), confidentiality (GENERAL, MANAGEMENT), guests, status (SCHEDULED → IN_PROGRESS → AWAITING_MOM → MOM_SUBMITTED / MOM_RETURNED → MOM_APPROVED → CLOSED; CANCELLED), scheduled and actual start/end (UTC), `agenda_due_at`, `mom_due_at`, points approval (`points_status`, `points_policy` BLOCK / LAST_APPROVED, times, remarks), MOM approval (times, remarks), `series_id` and `parent_meeting_id` (follow-up chain), `row_version`.
- `meeting_departments`, `meeting_participants` (response, response note, attendance), `meeting_points` (position, title, presenter, discussion), `meeting_decisions`.
- `meeting_actions`: title, description, `owner_id` (task assignee), priority, `due_on`, `task_id` (set on MOM approval), `carried_from_id` (the same task carried into a follow-up meeting), `confirmed_by` / `confirmed_at`, `review_note`; UNIQUE (meeting_id, task_id).
- `meeting_open_points` (text, owner, review date, OPEN/CLOSED with note, `carried_from_id`) and `meeting_events` (history, reminders).
- `tasks.meeting_id`: the meeting an action-item task came from (FK, indexed).

## From/To durations, estimates from dates and the critical path (v1.74.0, D-398; no migration)

No new table or column. `projects.start_on` / `due_on` are read as the project's From and To (validated: real days, From ≤ To). New setting `tasks.planning` in `system_settings` (JSON `{hoursPerDay: 8}`, 1-24 in half hours; Admin → Task settings; audit `TASK_SETTINGS`). Working days, a task's estimate from its dates (`tasks.time_estimate_minutes` when set, else working days × hours per day) and the critical path are worked out when read from `tasks.starts_on`, `tasks.due_at`, `tasks.is_milestone`, `task_dependencies` (type and `lag_days`), `holidays` and the Working calendar; nothing is stored, so they follow every change.

## Files, Messages, Page and time tracking (v1.71.0, D-384; migration 202611222000_pm_e_collab.sql)

| Table / column | Key columns | Notes |
|---|---|---|
| `project_messages` | `id`, `project_id` → projects, `parent_id` → project_messages (a reply: its thread; one level), `author_id` → users, `subject` (threads, ≤ 150), `body` TEXT (the app's formatting text, never HTML; ≤ 10,000), `created_at`, `last_activity` (threads: the newest reply), `edited_at/by`, `deleted_at/by` | A deleted message keeps its row and reads "deleted"; its files are no longer served. |
| `project_message_versions` | `message_id` → project_messages, `subject`, `body` (before the change), `change_kind` EDIT/DELETE, `changed_by`, `changed_at` | The D-365 pattern ("Show edits"), its own table so the 30-day purge can remove it with the project (comment_versions has an optional no-delete trigger). |
| `project_message_reactions` | PK (`message_id`, `user_id`, `reaction`) | The six reactions of comments. |
| `project_pages` | PK `project_id` → projects, `title` (≤ 150), `body` MEDIUMTEXT (≤ 100,000), `row_version`, `updated_by`, `updated_at` | One page per project. A save names the version it started from; a newer one in between is refused. |
| `project_page_versions` | `project_id`, `version_no` (UNIQUE with the project), `title`, `body`, `restored_from`, `saved_by`, `saved_at` | Every save; only the newest 50 are kept. A restore is a new version. |
| `task_time_entries` | `id`, `task_id` → tasks, `user_id` → users (whose time), `work_day` DATE (India), `minutes` (NULL while a timer runs; ≤ 1,440), `note` (≤ 500), `source` MANUAL/TIMER, `started_at` (TIMER), `running` (generated; UNIQUE with task and person: one running timer each), `created_by`, `edited_at/by` | Deleted rows go (audited with what they were). The Dashboard's "time entries" source adds them to the timer-field runs. |
| `tasks.time_estimate_minutes` | INT, NULL | The task's estimate (Workload "Estimated time"). |
| `work_views.view_type` | + FILES, MESSAGES, PAGE | Project tabs. |
| `record_files.entity_type` | + PROJECT_MESSAGE | Files on project messages (same storage and checks as task files). |

Notices: `WORK_PROJECT_MESSAGE` (a new conversation to the members; a reply to the conversation's people; @mentions in messages and on the page, only people who can see the project). Audit actions: `PROJECT_MESSAGE_POSTED/REPLIED/EDITED/DELETED`, `PROJECT_PAGE_SAVED/RESTORED`, `TIME_LOGGED`, `TIME_TIMER_STARTED/STOPPED`, `TIME_ENTRY_CHANGED/DELETED` (with before/after and whether it was someone else's), `TIME_ESTIMATE_SET`, `PROJECT_TIME_EXPORTED`. The 30-day purge removes a purged project's messages (with their files, versions and reactions), page and page versions, and a purged task's time entries.

## Templates, import/export and calendar feeds (v1.70.0, D-383; migration 202611221900_pm_e_extras.sql)

| Table / column | Key columns | Notes |
|---|---|---|
| `projects.template_json` (v2) | `{version: 2, project, sections, fields, placeholders, tasks, dependencies, tabs, widgets, automations, forms}` (`server/work/template-rules.ts` `templateV2Schema`) | Saved by **Save as template** (a project row with `is_template` = TRUE) and given by the JSON export. Dates are days from the start (`dueOffset` always set); field values travel by option name / days / person id / template task key; ids inside settings are the source project's and are remapped (`remapRefs`) when a project is made. D-218 bodies (no `version`) are read by `parseTemplateBody` (upgraded) and shown by the old screens through `legacyView`. |
| `projects.template_shared` | BOOLEAN, default FALSE | IT's "organisation template": everyone with Projects sees and uses it. |
| `calendar_feeds` | `id`, `user_id` → users, `scope` MY_TASKS/PROJECT, `project_id` → projects (PROJECT), `token_hash` CHAR(64) UNIQUE (SHA-256 of the secret), `token_hint` (last 4 characters), `created_at`, `last_used_at`, `revoked_at` | One live address per person and calendar (making a new one revokes the old). The secret is never stored. Deleted with the project by the 30-day purge. |

Setting: `features.pm_extras` (ON / OFF / IT_ONLY, default OFF). Imports and exports store nothing of their own: imported rows become ordinary tasks (audit `PROJECT_IMPORTED` with the file name and counts), exports are built on request (audit `PROJECT_EXPORTED`). Audit actions also: `PROJECT_FROM_TEMPLATE`, `PROJECT_DUPLICATED`, `PROJECT_TEMPLATE_RENAMED/DELETED/SHARED/UNSHARED`, `CALENDAR_FEED_CREATED/ROTATED/REVOKED`.

## Portfolios (v1.69.0, D-382; migration 202611221800_pm_d_portfolios.sql)

| Table | Key columns | Notes |
|---|---|---|
| `portfolios` | `id`, `name`, `color` (a project colour key), `owner_id` → users, `privacy` PRIVATE/DEPARTMENT/ORGANISATION, `department_id` → departments, `default_access_role` EDITOR/COMMENTER/VIEWER (default VIEWER), `description`, `start_on`, `due_on`, `current_status` (from the latest status update), `default_tab` LIST/TIMELINE/PROGRESS/DASHBOARD, `archived_at`, `row_version`, `created_by`, `deleted_at`, `deleted_by` | Soft delete; purged 30 days after (with everything below). `visiblePortfolioClause` = `effectivePortfolioRole` (the project rule: own grant, privacy default, managers of a member see it, IT owner, nothing without the Projects module). |
| `portfolio_members` | PK (`portfolio_id`, `user_id`), `role` OWNER/EDITOR/COMMENTER/VIEWER, `added_by` | At least one OWNER (checked by the app). People only (no department members). |
| `portfolio_items` | `id`, `portfolio_id` → portfolios, `project_id` → projects or `child_portfolio_id` → portfolios (exactly one, checked by the app), `priority` HIGH/MEDIUM/LOW, `position`, `added_by`, `added_at`; UNIQUE (portfolio, project), (portfolio, child) | Nesting: no circles, at most 5 levels (`server/work/portfolio-rules.ts` `nestingProblem`), ≤ 500 items. A deleted project or portfolio drops out of the rows until restored; purging a project deletes its rows here. |
| `portfolio_fields` | `id`, `portfolio_id`, `name`, `kind` TEXT/NUMBER/SELECT/DATE/PEOPLE, `options_json`, `position`, `created_by` | The portfolio's own columns (≤ 20). Hard delete with values. |
| `portfolio_field_values` | PK (`item_id` → portfolio_items, `field_id` → portfolio_fields), `value` VARCHAR(500), `updated_by` | Checked per kind (`checkFieldValue`). |
| `portfolio_status_updates` | `id`, `portfolio_id`, `status`, `title`, `body`, `author_id`, `deleted_at`, `created_at` | The portfolio's own updates (project updates stay in `project_status_updates`). |

`work_favourites.object_type` adds PORTFOLIO. Setting: `features.pm_portfolios` (ON / OFF / IT_ONLY, default OFF). Figures (task progress, counts, charts) are not stored: worked out per viewer from `task_projects`/`tasks` over the projects they can see, each task once.

## Project automations (v1.68.0, D-380; migration 202611221700_pm_d_automations.sql)

| Table | Key columns | Notes |
|---|---|---|
| `project_automations` | `id`, `project_id` → projects, `name`, `owner_id` → users, `draft_json`, `published_json`, `published_version`, `published_at`, `draft_changed`, `trigger_type`, `enabled`, `paused_reason`, `webhook_token` (unique), `webhook_secret_enc` (AES-GCM), `scheduled_on`, `hour_start`, `hour_runs`, `failing`, `last_run_at`, `last_result`, `last_error`, `row_version`, `created_by`, `updated_by` | A rule: one trigger, steps, optional paths (JSON, `server/work/automation-rules.ts` `definitionSchema`). Only `published_json` runs. Hard delete (with its runs and webhook calls); purged with its project. |
| `automation_events` | `id`, `task_id` (no FK), `event_type`, `from_status`, `to_status`, `payload_json`, `actor_id`, `depth`, `chain_json`, `status` PENDING/CLAIMED/DONE, `claimed_at`, `created_at` | The outbox: written by `appendTaskEvent` (and attachment adds) in the change's own transaction, only for tasks in projects with live rules. DONE rows go after 7 days. |
| `automation_runs` | `id`, `automation_id` → project_automations, `version`, `run_key` (unique per rule), `trigger_label`, `task_id`, `task_no`, `status` RUNNING/SUCCEEDED/FAILED/SKIPPED, `steps_json`, `error`, `depth`, `started_at`, `finished_at` | The run log; the newest 200 per rule are kept (older ones after 2 days). |
| `automation_webhook_deliveries` | `id`, `automation_id`, `received_at`, `status` ACCEPTED/REFUSED/FAILED, `http_status`, `payload_json` (accepted bodies, ≤ 16 KB), `task_id`, `error` | Every webhook call; removed after 30 days. Also counts the 60-a-minute limit. |

Settings: `features.pm_automations` (ON / OFF / IT_ONLY, default OFF), `tasks.automation_limits` (JSON `{perProject: 50, stepsPerRule: 20}`). `task_events.payload_json.automation = {id, name, ownerId}` marks a change made by a rule (actor = the system user); `audit_logs.on_behalf_of_user_id` is the rule's owner.
