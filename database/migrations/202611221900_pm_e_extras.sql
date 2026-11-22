-- v1.70.0 (D-366 plan approved; D-383 build): Project Management phase E,
-- part 1: complete templates, duplicate with choices, import and export,
-- and calendar (iCal) feeds.
-- Feature switch "pm_extras" (default OFF). With it off the template and copy
-- screens are as in v1.69 and the server refuses every new operation (the
-- gallery, sharing a template, duplicate choices, import, export, feeds).
--
-- 1. projects.template_shared: IT marks a template as an organisation
--    template; everyone with the Projects module then sees it in the
--    template gallery (other templates are seen by the people of the project
--    they were saved from, as before).
-- 2. calendar_feeds: a person's secret calendar address (My Tasks, or one
--    project). Only a SHA-256 hash of the token is stored; the address is
--    shown once when made. Rotate = the old one stops and a new one is made;
--    revoke = it stops. What a feed shows is decided when the calendar asks
--    (only tasks the person may see then).
-- No triggers. Nothing existing is changed (templates saved before keep
-- working: they are read as they are).
-- Run order: after 202611221800_pm_d_portfolios.sql.
--
-- Rollback (after rolling the code back to v1.69.x; feed addresses stop working):
--   DROP TABLE calendar_feeds;
--   ALTER TABLE projects DROP COLUMN template_shared;
--   DELETE FROM system_settings WHERE setting_key = 'features.pm_extras';

ALTER TABLE projects
  ADD COLUMN template_shared BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'D-383: an organisation template (set by IT); shown to everyone with Projects' AFTER template_json;

CREATE TABLE calendar_feeds (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      BIGINT UNSIGNED NOT NULL,
  scope        ENUM('MY_TASKS', 'PROJECT') NOT NULL,
  project_id   BIGINT UNSIGNED NULL COMMENT 'scope PROJECT: the project',
  token_hash   CHAR(64)        NOT NULL COMMENT 'SHA-256 (hex) of the secret in the address; the secret itself is never stored',
  token_hint   VARCHAR(8)      NOT NULL COMMENT 'the last characters of the secret, to tell feeds apart',
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME        NULL,
  revoked_at   DATETIME        NULL,
  CONSTRAINT uq_calendar_feeds_token UNIQUE (token_hash),
  CONSTRAINT fk_calendar_feeds_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_calendar_feeds_project FOREIGN KEY (project_id) REFERENCES projects(id),
  INDEX idx_calendar_feeds_owner (user_id, scope, project_id, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
