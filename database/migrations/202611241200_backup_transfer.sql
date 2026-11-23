-- v1.82.0 (D-409, BK-1 part 2): moving the system between servers app to app.
-- backup_pairings: one-time pairing codes. RECEIVE = this server accepts one
--   package pushed by another ARS-CMS; OFFER = this server lets another
--   ARS-CMS pull one named package. Only the code's sha256 is stored; a code
--   expires (2 hours to start), works once, and wrong codes are rate-limited
--   per address (rate_limit_hits). Never in a backup, never replaced by a
--   restore (like backup_runs), no foreign keys.
-- No triggers. Run order: after 202611241100_backup_centre.sql.
--
-- Rollback (after rolling the code back to v1.81.x):
--   DROP TABLE backup_pairings;

CREATE TABLE backup_pairings (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  purpose         VARCHAR(10)     NOT NULL COMMENT 'RECEIVE | OFFER',
  code_hash       CHAR(64)        NOT NULL COMMENT 'sha256 of the code (the code itself is shown once)',
  package_name    VARCHAR(200)    NULL COMMENT 'OFFER: the package another server may pull',
  upload_id       BIGINT UNSIGNED NULL COMMENT 'RECEIVE: the upload it opened (backup_uploads.id)',
  status          VARCHAR(12)     NOT NULL COMMENT 'OPEN | IN_USE | USED | REVOKED',
  expires_at      DATETIME(3)     NOT NULL,
  peer_ip         VARCHAR(45)     NULL COMMENT 'the address that used it',
  bytes_sent      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_by      BIGINT UNSIGNED NULL COMMENT 'users.id (no foreign key: users may be replaced by a restore)',
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_backup_pairings_code (code_hash),
  KEY idx_backup_pairings_status (status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
