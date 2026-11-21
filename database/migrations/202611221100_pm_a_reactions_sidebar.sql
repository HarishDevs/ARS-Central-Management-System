-- v1.62.0 (D-366 plan approved; D-368 build): Project Management phase A, part 2.
-- 1. Emoji reactions on task comments (beside the existing Like): one row per
--    comment, person and reaction; a person toggles each reaction on and off.
-- 2. The sidebar's own order of projects per person: Starred projects (the
--    stars stay in work_favourites) and the Departments section, used when the
--    person picks "Manual" in that section's sort menu.
-- The task pane width ('work.pane_w') and the celebration choice
-- ('work.celebrations') live in user_settings; the Admin defaults (celebrations,
-- purge after 30 days) in system_settings ('tasks.pm_extras'): no schema change.
-- 3. task_events stays append-only, except that the 30-day purge job
--    (server/work/purge.ts) may remove the history of a task that has been in
--    Deleted for more than 30 days (the task itself goes in the same
--    transaction). Updates are still always refused.
-- Run order: after 202611221000_pm_a_views_prefs.sql.
--
-- Rollback (after rolling the code back to v1.61.x):
--   DROP TABLE comment_reactions;
--   DROP TABLE work_project_order;
--   DELETE FROM user_settings WHERE setting_key IN ('work.pane_w', 'work.celebrations', 'work.sidebar_starred_sort', 'work.sidebar_departments_sort');
--   DELETE FROM system_settings WHERE setting_key = 'tasks.pm_extras';
--   DROP TRIGGER IF EXISTS trg_task_events_no_delete;  then re-create the v1.9.0 one:
--   CREATE TRIGGER trg_task_events_no_delete BEFORE DELETE ON task_events FOR EACH ROW
--     BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'task_events is append-only'; END;
--   Tasks and projects already purged by the job can't be brought back (restore
--   them from a backup taken before v1.62.0 if needed).

CREATE TABLE comment_reactions (
  comment_id  BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  reaction    ENUM('THUMBS_UP', 'HEART', 'TADA', 'SMILE', 'EYES', 'CHECK') NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (comment_id, user_id, reaction),
  CONSTRAINT fk_comment_reactions_comment FOREIGN KEY (comment_id) REFERENCES task_comments(id),
  CONSTRAINT fk_comment_reactions_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_comment_reactions_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE work_project_order (
  user_id     BIGINT UNSIGNED NOT NULL,
  list_key    ENUM('STARRED', 'DEPARTMENTS') NOT NULL,
  project_id  BIGINT UNSIGNED NOT NULL,
  position    DOUBLE NOT NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, list_key, project_id),
  CONSTRAINT fk_work_project_order_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_work_project_order_project FOREIGN KEY (project_id) REFERENCES projects(id),
  INDEX idx_work_project_order_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- If the database user may not create triggers (hosted MySQL with binary
-- logging), IT runs these two blocks once in phpMyAdmin.
-- @optional
-- @begin
DROP TRIGGER IF EXISTS trg_task_events_no_delete;
-- @end

-- @optional
-- @begin
CREATE TRIGGER trg_task_events_no_delete BEFORE DELETE ON task_events
FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = OLD.task_id AND t.deleted_at IS NOT NULL AND t.deleted_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'task_events is append-only';
  END IF;
END;
-- @end
