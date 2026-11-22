-- v1.66.0 (D-366 plan approved; D-374 build): Project Management phase C,
-- project intake forms for signed-in people (C-1: the public no-account link
-- is NOT part of this release; see "Later" below).
-- Feature switch "pm_forms" (default OFF). With it off no form screen shows
-- and the server refuses every form operation.
--
-- 1. users.is_system and ONE system user, "ARS-CMS Automation" (C-10): the
--    creator of tasks made from form submissions. It can never sign in by any
--    route: inactive, no password, no Google account (an address that can't
--    exist), refused by the sign-in rules and the session check, hidden from
--    Admin → Users (can't be reactivated or edited) and from every people
--    picker (they list active people only).
-- 2. project_forms: a project's intake form. The questions use the shared
--    Form Builder's field shape (server/forms/fields.ts, the same JSON as
--    approval, task-type and ticket forms) plus a mapping of questions to task
--    fields or project custom fields, and the settings (target section, title,
--    default assignee, due offset in working days, confirmation, who may
--    submit, notices). draft_json is what the builder edits; publishing copies
--    it into project_form_versions (immutable snapshot) and points
--    current_version_id at it. share_token: 128 random bits (base64url), used
--    in /users/forms/<token> (signed-in only). Soft delete (deleted_at).
-- 3. project_form_versions: the published snapshots, numbered per form.
-- 4. project_form_submissions: one row per accepted submission (answers as
--    typed values, the version answered, the task made); UNIQUE submission
--    key per form and person stops a double submit; the per-person hourly
--    limit counts these rows.
-- 5. tasks.source_form_id: the form a task was made from (its "submitted
--    through" link; such a task is edited like a project task, not like an
--    ad hoc task of its creator, who is the system user).
-- 6. task_followers.source gets FORM (the submitter as a collaborator).
-- No triggers. Nothing existing is changed.
-- Run order: after 202611221400_pm_b_schedule.sql.
--
-- Later (C-1, only if the owner approves public links): a pm_public_forms
-- migration with per-IP buckets, a challenge, the submitter IP hash and a
-- public route; the share_token here stays the key.
--
-- Rollback (after rolling the code back to v1.65.x; forms, versions and
-- submissions are lost; tasks made from forms stay as ordinary tasks):
--   ALTER TABLE tasks DROP FOREIGN KEY fk_tasks_source_form, DROP COLUMN source_form_id;
--   DROP TABLE project_form_submissions;
--   ALTER TABLE project_forms DROP FOREIGN KEY fk_project_forms_version;
--   DROP TABLE project_form_versions;
--   DROP TABLE project_forms;
--   UPDATE task_followers SET source = 'MANUAL' WHERE source = 'FORM';
--   ALTER TABLE task_followers MODIFY source ENUM('CREATOR', 'ASSIGNEE', 'MANUAL', 'MENTION', 'COMMENT') NOT NULL;
--   (keep the system user row: tasks and events refer to it; it can't sign in)
--   ALTER TABLE users DROP COLUMN is_system;  -- only if no code reads it any more
--   DELETE FROM system_settings WHERE setting_key = 'features.pm_forms';

ALTER TABLE users
  ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'D-374: the non-sign-in system user (ARS-CMS Automation); never signs in' AFTER is_demo;

INSERT INTO users (login_id, name, email, sign_in_method, password_hash, active, is_system, module_access)
SELECT 'ars-cms-automation', 'ARS-CMS Automation', 'automation@system.ars-cms.invalid', 'PASSWORD', NULL, FALSE, TRUE, ''
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM users WHERE login_id = 'ars-cms-automation');

CREATE TABLE project_forms (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id         BIGINT UNSIGNED NOT NULL,
  kind               ENUM('PROJECT_INTAKE') NOT NULL DEFAULT 'PROJECT_INTAKE' COMMENT 'a kind of the shared Form Builder',
  share_token        VARCHAR(43)     NOT NULL COMMENT '128 random bits, base64url; /users/forms/<token>',
  status             ENUM('DRAFT', 'PUBLISHED', 'UNPUBLISHED') NOT NULL DEFAULT 'DRAFT',
  name               VARCHAR(120)    NOT NULL COMMENT 'the draft title',
  description        TEXT            NULL,
  cover_path         VARCHAR(255)    NULL COMMENT 'cover image under the upload folder (PNG, JPG, WEBP)',
  cover_type         VARCHAR(50)     NULL,
  draft_json         JSON            NOT NULL COMMENT '{fields: FormField[], mappings: {key: target}}',
  settings_json      JSON            NOT NULL COMMENT 'server/work/intake-rules.ts IntakeSettings',
  current_version_id BIGINT UNSIGNED NULL COMMENT 'the published snapshot people fill in',
  draft_changed      BOOLEAN         NOT NULL DEFAULT TRUE COMMENT 'the draft differs from the published version',
  row_version        INT UNSIGNED    NOT NULL DEFAULT 1,
  created_by         BIGINT UNSIGNED NOT NULL,
  created_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by         BIGINT UNSIGNED NULL,
  updated_at         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at         DATETIME        NULL,
  deleted_by         BIGINT UNSIGNED NULL,
  CONSTRAINT uq_project_forms_token UNIQUE (share_token),
  CONSTRAINT fk_project_forms_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_project_forms_creator FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_project_forms_project (project_id, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_form_versions (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  form_id       BIGINT UNSIGNED NOT NULL,
  version_no    INT UNSIGNED    NOT NULL,
  snapshot_json JSON            NOT NULL COMMENT '{name, description, hasCover, fields, mappings, settings}; never changed',
  published_by  BIGINT UNSIGNED NOT NULL,
  published_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_project_form_versions UNIQUE (form_id, version_no),
  CONSTRAINT fk_project_form_versions_form FOREIGN KEY (form_id) REFERENCES project_forms(id),
  CONSTRAINT fk_project_form_versions_user FOREIGN KEY (published_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE project_forms
  ADD CONSTRAINT fk_project_forms_version FOREIGN KEY (current_version_id) REFERENCES project_form_versions(id);

CREATE TABLE project_form_submissions (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  form_id        BIGINT UNSIGNED NOT NULL,
  version_id     BIGINT UNSIGNED NOT NULL,
  submitter_id   BIGINT UNSIGNED NOT NULL,
  submission_key VARCHAR(64)     NOT NULL COMMENT 'from the fill view; the same key twice is one submission',
  task_id        BIGINT UNSIGNED NULL,
  answers_json   JSON            NOT NULL COMMENT 'typed answers by question key (dates, numbers, options, file counts)',
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT uq_project_form_submissions_key UNIQUE (form_id, submitter_id, submission_key),
  CONSTRAINT fk_project_form_submissions_form FOREIGN KEY (form_id) REFERENCES project_forms(id),
  CONSTRAINT fk_project_form_submissions_version FOREIGN KEY (version_id) REFERENCES project_form_versions(id),
  CONSTRAINT fk_project_form_submissions_user FOREIGN KEY (submitter_id) REFERENCES users(id),
  CONSTRAINT fk_project_form_submissions_task FOREIGN KEY (task_id) REFERENCES tasks(id),
  INDEX idx_project_form_submissions_rate (form_id, submitter_id, created_at),
  INDEX idx_project_form_submissions_mine (submitter_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE tasks
  ADD COLUMN source_form_id BIGINT UNSIGNED NULL COMMENT 'D-374: the intake form this task was submitted through',
  ADD CONSTRAINT fk_tasks_source_form FOREIGN KEY (source_form_id) REFERENCES project_forms(id);

ALTER TABLE task_followers
  MODIFY source ENUM('CREATOR', 'ASSIGNEE', 'MANUAL', 'MENTION', 'COMMENT', 'FORM') NOT NULL;
