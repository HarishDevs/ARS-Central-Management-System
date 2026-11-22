-- v1.76.0 (D-401, owner's Task Summary decisions, release 1 "daily use"):
-- Run after every earlier migration. No triggers, no stored procedures.
--
-- 1. Personal tab names may repeat (Task Summary only). The unique key on
--    work_views (scope, scope_id, name) becomes a key on a generated column
--    that holds the name only for PROJECT tabs (NULL for MY_TASKS rows; NULLs
--    never clash), so project tabs keep unique names and a person may have
--    two tabs called "Today's DB".
-- 2. my_task_placements.rule_key: which rule last moved the task, for which
--    due day ("TODAY:2026-11-23"), so the nightly rule moves a task at most
--    once per due day (the person can move it back and it stays).
-- 3. my_task_rules: each person's section rules for Task Summary ("move to
--    Today when due today", "move to Upcoming when due within N working
--    days") and the India day the rules last ran for them. A row exists only
--    once the person uses My sections.
--
-- Existing data is not changed.
--
-- Rollback (in this order):
--   DROP TABLE my_task_rules;
--   ALTER TABLE my_task_placements DROP COLUMN rule_key;
--   -- only if no person has two tabs with one name (else rename them first):
--   ALTER TABLE work_views DROP INDEX uq_work_views_name, ADD CONSTRAINT uq_work_views_name UNIQUE (scope, scope_id, name), DROP COLUMN name_key;

ALTER TABLE work_views
  ADD COLUMN name_key VARCHAR(60) COLLATE utf8mb4_unicode_ci GENERATED ALWAYS AS (IF(scope = 'PROJECT', name, NULL)) STORED COMMENT 'v1.76.0: the name for PROJECT tabs only (unique); NULL for personal tabs, whose names may repeat';

ALTER TABLE work_views
  DROP INDEX uq_work_views_name,
  ADD CONSTRAINT uq_work_views_name UNIQUE (scope, scope_id, name_key);

ALTER TABLE my_task_placements
  ADD COLUMN rule_key VARCHAR(40) NULL COMMENT 'v1.76.0: the rule and due day that last moved it (TODAY:YYYY-MM-DD)' AFTER position;

CREATE TABLE my_task_rules (
  user_id       BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  today_on      BOOLEAN         NOT NULL DEFAULT TRUE,
  upcoming_on   BOOLEAN         NOT NULL DEFAULT TRUE,
  upcoming_days TINYINT UNSIGNED NOT NULL DEFAULT 7,
  last_run_day  DATE            NULL COMMENT 'India day the rules last ran for this person',
  updated_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_my_task_rules_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
