-- v1.81.0 (D-408, BK-1): Backup, restore & migrate centre (Super Admin).
-- backup_runs: one row per backup, check (dry run), restore, safety snapshot,
--   copy to/from Google Drive. Long work runs in resumable steps; state_json
--   holds only positions, counts and names (never a passphrase, key or
--   secret). active_slot is 'RESTORE' while a restore runs: its UNIQUE index
--   makes sure only one restore runs at a time.
-- backup_uploads: a package being uploaded in pieces (resumable, no size limit).
-- Both tables are never in a backup and never replaced by a restore (with
-- schema_migration_progress and ops_restores), and have no foreign keys to
-- tables a restore replaces.
-- No triggers. Run order: after 202611241000_home_overview_scope.sql.
--
-- Rollback (after rolling the code back to v1.80.x; packages already made stay
-- in the backup folder and can still be read by v1.81.0 or later):
--   DROP TABLE backup_uploads;
--   DROP TABLE backup_runs;

CREATE TABLE backup_runs (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kind           VARCHAR(20)     NOT NULL COMMENT 'BACKUP | VERIFY | RESTORE | DRIVE_COPY | DRIVE_FETCH',
  trigger_type   VARCHAR(20)     NOT NULL COMMENT 'MANUAL | SCHEDULED | SAFETY',
  status         VARCHAR(20)     NOT NULL COMMENT 'RUNNING | DONE | FAILED | CANCELLED | ROLLED_BACK',
  phase          VARCHAR(30)     NOT NULL,
  mode           VARCHAR(20)     NULL COMMENT 'restore: full | database | files | tables; backup: full | database',
  package_name   VARCHAR(200)    NULL,
  key_kind       VARCHAR(20)     NULL COMMENT 'PASSPHRASE | SERVER_KEY',
  options_json   JSON            NULL COMMENT 'choices: destinations, tables, keep on server (no secrets)',
  state_json     JSON            NULL COMMENT 'resumable step state (positions and counts only)',
  summary_json   JSON            NULL COMMENT 'what a check or restore found (no secrets)',
  progress_done  INT UNSIGNED    NOT NULL DEFAULT 0,
  progress_total INT UNSIGNED    NOT NULL DEFAULT 0,
  message        VARCHAR(500)    NULL,
  error_text     VARCHAR(1000)   NULL,
  token_hash     CHAR(64)        NULL COMMENT 'sha256 of the run token held by the browser',
  lease_until    DATETIME(3)     NULL COMMENT 'a step is running until then',
  active_slot    VARCHAR(10)     NULL COMMENT 'RESTORE while a restore runs (one at a time)',
  parent_run_id  BIGINT UNSIGNED NULL,
  created_by     BIGINT UNSIGNED NULL COMMENT 'users.id (no foreign key: users may be replaced by a restore)',
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  finished_at    DATETIME(3)     NULL,
  UNIQUE KEY uq_backup_runs_active (active_slot),
  KEY idx_backup_runs_status (status, kind),
  KEY idx_backup_runs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE backup_uploads (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  file_name      VARCHAR(200)    NOT NULL COMMENT 'the name on the PC (shown only)',
  stored_name    VARCHAR(200)    NOT NULL COMMENT 'the file in the backup folder while it arrives',
  size_expected  BIGINT UNSIGNED NOT NULL,
  size_received  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  status         VARCHAR(20)     NOT NULL COMMENT 'RECEIVING | DONE | CANCELLED',
  package_name   VARCHAR(200)    NULL COMMENT 'the package it became',
  created_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_backup_uploads_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
