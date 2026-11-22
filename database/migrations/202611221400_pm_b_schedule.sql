-- v1.65.0 (D-366 plan approved; D-373 build): Project Management phase B, part 2:
-- dependency types, auto-shifting dependent dates, an editable Timeline and a
-- Gantt tab, the Calendar week view, and fuller status updates.
-- Feature switch "pm_planning" (default OFF, as in v1.64.0). With it off the
-- screens are as in v1.64 and every link is "finish to start" as before.
--
-- 1. task_dependencies gets the link's type (FS finish-to-start, the default and
--    what every existing link is; SS start-to-start; FF finish-to-finish; SF
--    start-to-finish) and lag_days (reserved: always 0 for now, shown read-only).
-- 2. projects gets its scheduling settings: shift_mode (OFF: never move
--    dependent tasks; KEEP_GAP: move them by the same number of days; CONSUME:
--    move them only when they would overlap), shift_skip_off_days (count only
--    working days: weekly offs and holidays of the Working calendar are skipped),
--    and the weekly status reminder (status_reminder, status_reminded_on: the
--    India day of the last reminder, so the job reminds once a week).
-- 3. task_shift_batches: what one date change moved (every task's dates before
--    and after), so the person who moved it can Undo for 15 minutes. Rows older
--    than 7 days are removed by the job runner (statusReminders step).
-- 4. work_views.view_type gets GANTT (a Gantt tab).
-- 5. project_status_updates gets owner_id, start_on, due_on (the project's
--    dates as stated in the update), next_steps (the Next steps section; body
--    stays the Summary), highlights_json (completed milestones and tasks the
--    author picked, frozen when posted) and recipients_json (who was told).
-- No triggers. Nothing existing is changed: every existing link becomes FS with
-- lag 0 (the default), every project OFF / skip / no reminder.
-- Run order: after 202611221300_pm_b_custom_fields.sql.
--
-- Rollback (after rolling the code back to v1.64.x; link types, shift and
-- reminder settings, Undo records and the new status update parts are lost):
--   DELETE FROM work_views WHERE view_type = 'GANTT';
--   ALTER TABLE work_views MODIFY view_type ENUM('LIST', 'BOARD', 'CALENDAR', 'TIMELINE', 'OVERVIEW') NOT NULL DEFAULT 'LIST';
--   ALTER TABLE project_status_updates DROP FOREIGN KEY fk_project_status_owner,
--     DROP COLUMN owner_id, DROP COLUMN start_on, DROP COLUMN due_on, DROP COLUMN next_steps,
--     DROP COLUMN highlights_json, DROP COLUMN recipients_json;
--   DROP TABLE task_shift_batches;
--   ALTER TABLE projects DROP COLUMN shift_mode, DROP COLUMN shift_skip_off_days,
--     DROP COLUMN status_reminder, DROP COLUMN status_reminded_on;
--   ALTER TABLE task_dependencies DROP COLUMN dep_type, DROP COLUMN lag_days;

ALTER TABLE task_dependencies
  ADD COLUMN dep_type ENUM('FS', 'SS', 'FF', 'SF') NOT NULL DEFAULT 'FS' COMMENT 'FS finish-to-start (default), SS, FF, SF' AFTER blocked_task_id,
  ADD COLUMN lag_days SMALLINT NOT NULL DEFAULT 0 COMMENT 'reserved; always 0 for now' AFTER dep_type;

ALTER TABLE projects
  ADD COLUMN shift_mode ENUM('OFF', 'KEEP_GAP', 'CONSUME') NOT NULL DEFAULT 'OFF' COMMENT 'what dependent tasks do when a task they wait for moves',
  ADD COLUMN shift_skip_off_days BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'shifts count working days only (weekly offs and holidays skipped)',
  ADD COLUMN status_reminder BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'remind the project owner every Friday to post a status update',
  ADD COLUMN status_reminded_on DATE NULL COMMENT 'India day of the last reminder';

CREATE TABLE task_shift_batches (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_id       BIGINT UNSIGNED NOT NULL,
  source_task_id BIGINT UNSIGNED NOT NULL COMMENT 'the task whose dates were changed (no foreign key: the purge may remove it)',
  moved          INT UNSIGNED    NOT NULL COMMENT 'dependent tasks moved',
  undo_json      JSON            NOT NULL COMMENT '[{id, start, due, newStart, newDue}] for every task changed, the source first',
  undone_at      DATETIME        NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_task_shift_batches_actor FOREIGN KEY (actor_id) REFERENCES users(id),
  INDEX idx_task_shift_batches_actor (actor_id, created_at),
  INDEX idx_task_shift_batches_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE work_views
  MODIFY view_type ENUM('LIST', 'BOARD', 'CALENDAR', 'TIMELINE', 'OVERVIEW', 'GANTT') NOT NULL DEFAULT 'LIST';

ALTER TABLE project_status_updates
  ADD COLUMN owner_id BIGINT UNSIGNED NULL AFTER body,
  ADD COLUMN start_on DATE NULL AFTER owner_id,
  ADD COLUMN due_on DATE NULL AFTER start_on,
  ADD COLUMN next_steps TEXT NULL COMMENT 'the Next steps section (body is the Summary)' AFTER due_on,
  ADD COLUMN highlights_json JSON NULL COMMENT 'picked completed milestones and tasks, frozen when posted' AFTER next_steps,
  ADD COLUMN recipients_json JSON NULL COMMENT 'ids of the people told' AFTER highlights_json,
  ADD CONSTRAINT fk_project_status_owner FOREIGN KEY (owner_id) REFERENCES users(id);
