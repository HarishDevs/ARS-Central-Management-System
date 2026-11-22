-- v1.71.0 (D-366 plan approved; D-384 build): Project Management phase E,
-- part 2: the Files, Messages and Page tabs of a project, and time tracking
-- on tasks. Behind the existing switch "pm_extras" (default OFF). With it off
-- none of the new tabs is offered, the task's Time section is hidden and the
-- server refuses every new operation.
--
-- 1. work_views.view_type gets FILES, MESSAGES and PAGE (project tabs).
-- 2. record_files.entity_type gets PROJECT_MESSAGE: files attached to a
--    project message use the same storage, checks and download route as
--    task files.
-- 3. project_messages: project conversations. A thread is a top-level
--    message with a subject; replies (one level) point at it. Edit and delete
--    keep every earlier text in project_message_versions (the D-365 pattern;
--    an own table so the 30-day purge can remove a purged project's history,
--    which comment_versions' optional no-delete trigger would refuse).
--    project_message_reactions: the six emoji reactions (as on comments).
-- 4. project_pages: one rich-text page (brief) per project, with
--    project_page_versions (every save; the newest 50 are kept; restore makes
--    a new version).
-- 5. task_time_entries: time logged on a task by a person (by hand: day,
--    minutes, note; or with start/stop: a running entry has no minutes yet,
--    at most one running per person and task). tasks.time_estimate_minutes:
--    the task's estimate.
-- No triggers. Nothing existing is changed.
-- Run order: after 202611221900_pm_e_extras.sql.
--
-- Rollback (after rolling the code back to v1.70.x; messages, pages and time
-- entries are lost, so back them up first if they matter):
--   DROP TABLE task_time_entries;
--   ALTER TABLE tasks DROP COLUMN time_estimate_minutes;
--   DROP TABLE project_page_versions;
--   DROP TABLE project_pages;
--   DROP TABLE project_message_reactions;
--   DROP TABLE project_message_versions;
--   DELETE FROM record_files WHERE entity_type = 'PROJECT_MESSAGE';  (and their stored files)
--   DROP TABLE project_messages;
--   ALTER TABLE record_files MODIFY entity_type ENUM('TASK', 'INFO', 'TICKET') NOT NULL;
--   DELETE FROM work_views WHERE view_type IN ('FILES', 'MESSAGES', 'PAGE');
--   ALTER TABLE work_views MODIFY view_type ENUM('LIST', 'BOARD', 'CALENDAR', 'TIMELINE', 'OVERVIEW', 'GANTT', 'DASHBOARD', 'WORKLOAD') NOT NULL DEFAULT 'LIST';

ALTER TABLE work_views
  MODIFY view_type ENUM('LIST', 'BOARD', 'CALENDAR', 'TIMELINE', 'OVERVIEW', 'GANTT', 'DASHBOARD', 'WORKLOAD', 'FILES', 'MESSAGES', 'PAGE') NOT NULL DEFAULT 'LIST';

ALTER TABLE record_files
  MODIFY entity_type ENUM('TASK', 'INFO', 'TICKET', 'PROJECT_MESSAGE') NOT NULL;

CREATE TABLE project_messages (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id    BIGINT UNSIGNED NOT NULL,
  parent_id     BIGINT UNSIGNED NULL COMMENT 'a reply: the thread (top-level message) it answers; one level only',
  author_id     BIGINT UNSIGNED NOT NULL,
  subject       VARCHAR(150)    NULL COMMENT 'threads only',
  body          TEXT            NOT NULL COMMENT 'the app formatting text (never HTML)',
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_activity DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'threads: the newest reply (for the order)',
  edited_at     DATETIME        NULL,
  edited_by     BIGINT UNSIGNED NULL,
  deleted_at    DATETIME        NULL,
  deleted_by    BIGINT UNSIGNED NULL,
  CONSTRAINT fk_project_messages_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_project_messages_parent FOREIGN KEY (parent_id) REFERENCES project_messages(id),
  CONSTRAINT fk_project_messages_author FOREIGN KEY (author_id) REFERENCES users(id),
  INDEX idx_project_messages_threads (project_id, parent_id, last_activity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_message_versions (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id  BIGINT UNSIGNED NOT NULL,
  subject     VARCHAR(150)    NULL,
  body        TEXT            NOT NULL COMMENT 'the text before this change',
  change_kind ENUM('EDIT', 'DELETE') NOT NULL,
  changed_by  BIGINT UNSIGNED NOT NULL,
  changed_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_project_message_versions_message FOREIGN KEY (message_id) REFERENCES project_messages(id),
  CONSTRAINT fk_project_message_versions_by FOREIGN KEY (changed_by) REFERENCES users(id),
  INDEX idx_project_message_versions (message_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_message_reactions (
  message_id  BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  reaction    ENUM('THUMBS_UP', 'HEART', 'TADA', 'SMILE', 'EYES', 'CHECK') NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id, reaction),
  CONSTRAINT fk_project_message_reactions_message FOREIGN KEY (message_id) REFERENCES project_messages(id),
  CONSTRAINT fk_project_message_reactions_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_pages (
  project_id  BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  title       VARCHAR(150)    NOT NULL DEFAULT '',
  body        MEDIUMTEXT      NOT NULL COMMENT 'the app formatting text (never HTML)',
  row_version INT UNSIGNED    NOT NULL DEFAULT 1,
  updated_by  BIGINT UNSIGNED NOT NULL,
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_project_pages_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_project_pages_by FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_page_versions (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id  BIGINT UNSIGNED NOT NULL,
  version_no  INT UNSIGNED    NOT NULL COMMENT 'the page row_version this text had',
  title       VARCHAR(150)    NOT NULL DEFAULT '',
  body        MEDIUMTEXT      NOT NULL,
  restored_from INT UNSIGNED  NULL COMMENT 'a restore: the version it brought back',
  saved_by    BIGINT UNSIGNED NOT NULL,
  saved_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_project_page_versions_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_project_page_versions_by FOREIGN KEY (saved_by) REFERENCES users(id),
  UNIQUE INDEX uq_project_page_versions (project_id, version_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE tasks
  ADD COLUMN time_estimate_minutes INT UNSIGNED NULL COMMENT 'D-384: the estimate, in minutes' AFTER starts_on;

CREATE TABLE task_time_entries (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id     BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL COMMENT 'whose time it is',
  work_day    DATE            NOT NULL COMMENT 'the India day the time was spent',
  minutes     INT UNSIGNED    NULL COMMENT 'NULL while a start/stop entry runs',
  note        VARCHAR(500)    NULL,
  source      ENUM('MANUAL', 'TIMER') NOT NULL,
  started_at  DATETIME        NULL COMMENT 'TIMER: when it was started (UTC)',
  running     TINYINT AS (CASE WHEN source = 'TIMER' AND minutes IS NULL THEN 1 END) STORED,
  created_by  BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at   DATETIME        NULL,
  edited_by   BIGINT UNSIGNED NULL,
  CONSTRAINT fk_task_time_entries_task FOREIGN KEY (task_id) REFERENCES tasks(id),
  CONSTRAINT fk_task_time_entries_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_task_time_entries_creator FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE INDEX uq_task_time_entries_running (task_id, user_id, running),
  INDEX idx_task_time_entries_task (task_id, work_day),
  INDEX idx_task_time_entries_user (user_id, work_day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
