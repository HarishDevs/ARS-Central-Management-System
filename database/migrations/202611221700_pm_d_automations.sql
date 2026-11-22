-- v1.68.0 (D-366 plan approved; D-380 build): Project Management phase D,
-- part 2: project automations (rules). A rule = one trigger, steps, and
-- optional Paths (if/else branches) with steps per path. People build them in
-- the project's settings (Customize); the published version runs on the job
-- runner as the system user "ARS-CMS Automation" with the rule owner's rights.
-- Feature switch "pm_automations" (default OFF). With it off no automation
-- screen shows, nothing runs and the server refuses every automation
-- operation and every incoming webhook; the tables below are simply not used.
--
-- 1. project_automations: one row per rule of a project. draft_json is what
--    the builder edits; Publish checks it and copies it into published_json
--    (published_version + 1); only published_json ever runs, so editing a
--    published rule makes a draft (draft_changed) without changing what runs.
--    trigger_type copies the published trigger's type (found quickly by the
--    engine). owner_id: whose rights the rule acts with ("Become owner").
--    paused_reason: set when the owner can no longer edit the project (the
--    rule stops until someone becomes owner). webhook_token: the secret part
--    of the incoming webhook address (128 random bits, base64url);
--    webhook_secret_enc: the signing secret, AES-GCM encrypted with
--    ENCRYPTION_KEY. hour_start / hour_runs: the per-rule hourly cap.
--    scheduled_on: the last day a Scheduled trigger ran. failing: the
--    "owner told once" latch for failures.
-- 2. automation_events: the outbox of task changes in projects that have
--    published rules, written in the same transaction as the change; the
--    engine claims and evaluates them after the commit (and the job runner
--    every 5 minutes). depth/chain_json carry the loop protection (a rule's
--    own changes never start it again; at most 3 rules in a chain).
--    task_id has no foreign key, so purging a task never waits on this table.
--    DONE rows are removed after 7 days.
-- 3. automation_runs: the run log (the last 200 runs of each rule are kept;
--    older ones go after 2 days). run_key is unique per rule, so one event
--    (or one due date, one scheduled day, one webhook call) runs a rule once.
-- 4. automation_webhook_deliveries: every call to a rule's webhook address
--    (accepted or refused) with the JSON body of accepted calls, kept for
--    30 days, then removed by the job runner.
-- No triggers. Nothing existing is changed.
-- Run order: after 202611221600_pm_d_dashboards.sql.
--
-- Rollback (after rolling the code back to v1.67.x; rules and run logs are lost):
--   DROP TABLE automation_webhook_deliveries;
--   DROP TABLE automation_runs;
--   DROP TABLE automation_events;
--   DROP TABLE project_automations;
--   DELETE FROM system_settings WHERE setting_key IN ('features.pm_automations', 'tasks.automation_limits');

CREATE TABLE project_automations (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id         BIGINT UNSIGNED NOT NULL,
  name               VARCHAR(120)    NOT NULL,
  owner_id           BIGINT UNSIGNED NOT NULL COMMENT 'the rule acts with this person''s rights',
  draft_json         JSON            NOT NULL COMMENT 'server/work/automation-rules.ts RuleDefinition (what the builder edits)',
  published_json     JSON            NULL COMMENT 'the version that runs',
  published_version  INT UNSIGNED    NOT NULL DEFAULT 0,
  published_at       DATETIME        NULL,
  draft_changed      BOOLEAN         NOT NULL DEFAULT TRUE COMMENT 'the draft differs from the published version',
  trigger_type       VARCHAR(32)     NULL COMMENT 'the published trigger type',
  enabled            BOOLEAN         NOT NULL DEFAULT TRUE,
  paused_reason      VARCHAR(255)    NULL COMMENT 'set when the owner lost access; cleared by Become owner',
  webhook_token      VARCHAR(43)     NULL COMMENT '/api/webhooks/automations/<token>',
  webhook_secret_enc TEXT            NULL COMMENT 'signing secret, AES-GCM encrypted',
  scheduled_on       DATE            NULL COMMENT 'last day a Scheduled trigger ran (India)',
  hour_start         DATETIME        NULL,
  hour_runs          INT UNSIGNED    NOT NULL DEFAULT 0,
  failing            BOOLEAN         NOT NULL DEFAULT FALSE COMMENT 'owner told about failures once',
  last_run_at        DATETIME        NULL,
  last_result        VARCHAR(16)     NULL,
  last_error         VARCHAR(500)    NULL,
  row_version        INT UNSIGNED    NOT NULL DEFAULT 1,
  created_by         BIGINT UNSIGNED NOT NULL,
  created_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by         BIGINT UNSIGNED NULL,
  updated_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT uq_project_automations_webhook UNIQUE (webhook_token),
  CONSTRAINT fk_project_automations_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_project_automations_owner FOREIGN KEY (owner_id) REFERENCES users(id),
  CONSTRAINT fk_project_automations_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_project_automations_updater FOREIGN KEY (updated_by) REFERENCES users(id),
  INDEX idx_project_automations_project (project_id),
  INDEX idx_project_automations_trigger (trigger_type, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE automation_events (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id      BIGINT UNSIGNED NOT NULL COMMENT 'no foreign key: purging a task never waits on this table',
  event_type   VARCHAR(32)     NOT NULL,
  from_status  VARCHAR(20)     NULL,
  to_status    VARCHAR(20)     NULL,
  payload_json JSON            NULL,
  actor_id     BIGINT UNSIGNED NULL,
  depth        TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 = a person; n = made by the nth rule of a chain',
  chain_json   JSON            NULL COMMENT 'ids of the rules in the chain that made this change',
  status       ENUM('PENDING', 'CLAIMED', 'DONE') NOT NULL DEFAULT 'PENDING',
  claimed_at   DATETIME        NULL,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_automation_events_status (status, id),
  INDEX idx_automation_events_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE automation_runs (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  automation_id BIGINT UNSIGNED NOT NULL,
  version       INT UNSIGNED    NOT NULL,
  run_key       VARCHAR(120)    NOT NULL COMMENT 'one run per rule and key (event, due date, day, webhook call)',
  trigger_label VARCHAR(200)    NOT NULL,
  task_id       BIGINT UNSIGNED NULL COMMENT 'no foreign key (tasks can be purged)',
  task_no       VARCHAR(30)     NULL,
  status        ENUM('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED') NOT NULL,
  steps_json    JSON            NULL COMMENT '[{label, ok, message}] in order',
  error         VARCHAR(500)    NULL,
  depth         TINYINT UNSIGNED NOT NULL DEFAULT 1,
  started_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at   DATETIME(3)     NULL,
  CONSTRAINT uq_automation_runs_key UNIQUE (automation_id, run_key),
  CONSTRAINT fk_automation_runs_rule FOREIGN KEY (automation_id) REFERENCES project_automations(id),
  INDEX idx_automation_runs_rule (automation_id, id),
  INDEX idx_automation_runs_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE automation_webhook_deliveries (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  automation_id BIGINT UNSIGNED NOT NULL,
  received_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  status        ENUM('ACCEPTED', 'REFUSED', 'FAILED') NOT NULL,
  http_status   SMALLINT UNSIGNED NOT NULL,
  payload_json  JSON            NULL COMMENT 'the JSON body of an accepted call (at most 16 KB), kept 30 days',
  task_id       BIGINT UNSIGNED NULL,
  error         VARCHAR(255)    NULL,
  CONSTRAINT fk_automation_webhook_rule FOREIGN KEY (automation_id) REFERENCES project_automations(id),
  INDEX idx_automation_webhook_rule (automation_id, received_at),
  INDEX idx_automation_webhook_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
