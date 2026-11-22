-- v1.78.0 (D-405, Task Summary release 3 "extra tabs and reach"):
-- Run after every earlier migration (after 202611231100_task_summary_r2.sql).
-- No triggers, no stored procedures.
--
-- 1. work_views.view_type gets NOTES (a Task Summary tab showing the person's
--    private notes). Dashboard and Files tabs reuse DASHBOARD and FILES.
-- 2. task_summary_notes: one private rich-text note per person (only its
--    owner reads or writes it; row_version guards against two tabs saving
--    over each other).
-- 3. task_summary_access_requests: someone refused a Task Summary asks its
--    owner for access. One row per owner and requester; answering it sets
--    resolved_at/resolved_by/outcome (the row is kept as the record) and
--    asking again later reopens it.
--
-- Existing data is not changed.
--
-- Rollback:
--   DROP TABLE task_summary_access_requests;
--   DROP TABLE task_summary_notes;
--   DELETE FROM work_views WHERE view_type = 'NOTES';
--   ALTER TABLE work_views MODIFY view_type ENUM('LIST', 'BOARD', 'CALENDAR', 'TIMELINE', 'OVERVIEW', 'GANTT', 'DASHBOARD', 'WORKLOAD', 'FILES', 'MESSAGES', 'PAGE') NOT NULL DEFAULT 'LIST';

ALTER TABLE work_views
  MODIFY view_type ENUM('LIST', 'BOARD', 'CALENDAR', 'TIMELINE', 'OVERVIEW', 'GANTT', 'DASHBOARD', 'WORKLOAD', 'FILES', 'MESSAGES', 'PAGE', 'NOTES') NOT NULL DEFAULT 'LIST';

CREATE TABLE task_summary_notes (
  user_id     BIGINT UNSIGNED NOT NULL PRIMARY KEY COMMENT 'whose notes (only they read them)',
  body        MEDIUMTEXT      NOT NULL,
  row_version INT UNSIGNED    NOT NULL DEFAULT 1,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_task_summary_notes_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE task_summary_access_requests (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  owner_id     BIGINT UNSIGNED NOT NULL COMMENT 'whose Task Summary',
  requester_id BIGINT UNSIGNED NOT NULL COMMENT 'who asked to open it',
  note         VARCHAR(300)    NULL,
  requested_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at  DATETIME        NULL,
  resolved_by  BIGINT UNSIGNED NULL,
  outcome      ENUM('GRANTED', 'DECLINED') NULL,
  CONSTRAINT uq_task_summary_access_requests UNIQUE (owner_id, requester_id),
  KEY ix_task_summary_access_requests_open (owner_id, resolved_at),
  CONSTRAINT fk_task_summary_access_requests_owner FOREIGN KEY (owner_id) REFERENCES users(id),
  CONSTRAINT fk_task_summary_access_requests_requester FOREIGN KEY (requester_id) REFERENCES users(id),
  CONSTRAINT fk_task_summary_access_requests_resolver FOREIGN KEY (resolved_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
