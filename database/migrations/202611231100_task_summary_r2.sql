-- v1.77.0 (D-404, owner's Task Summary decision 3, release 2 "organise and share"):
-- Run after every earlier migration (after 202611231000_task_summary_r1.sql).
-- No triggers, no stored procedures.
--
-- task_summary_shares: a person shares their Task Summary read-only with
-- chosen people (Share → Manage privacy). One row per owner and viewer; a
-- removal sets revoked_at/revoked_by (the row is kept as the sharing record)
-- and sharing again clears it. Managers above the owner in the reporting
-- chain (D-216) need no row. A viewer only ever sees the tasks they may see
-- themselves.
--
-- Existing data is not changed. (Customise › Fields is stored in
-- user_settings "work.my_tasks.fields"; Board and Calendar tab settings in
-- work_views.config_json: no schema change.)
--
-- Rollback:
--   DROP TABLE task_summary_shares;

CREATE TABLE task_summary_shares (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  owner_id    BIGINT UNSIGNED NOT NULL COMMENT 'whose Task Summary',
  viewer_id   BIGINT UNSIGNED NOT NULL COMMENT 'who may open it, read-only',
  granted_by  BIGINT UNSIGNED NOT NULL,
  granted_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at  DATETIME        NULL,
  revoked_by  BIGINT UNSIGNED NULL,
  CONSTRAINT uq_task_summary_shares UNIQUE (owner_id, viewer_id),
  KEY ix_task_summary_shares_viewer (viewer_id, revoked_at),
  CONSTRAINT fk_task_summary_shares_owner FOREIGN KEY (owner_id) REFERENCES users(id),
  CONSTRAINT fk_task_summary_shares_viewer FOREIGN KEY (viewer_id) REFERENCES users(id),
  CONSTRAINT fk_task_summary_shares_by FOREIGN KEY (granted_by) REFERENCES users(id),
  CONSTRAINT fk_task_summary_shares_revoker FOREIGN KEY (revoked_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
