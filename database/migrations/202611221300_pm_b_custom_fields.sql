-- v1.64.0 (D-366 plan approved; D-371 build): Project Management phase B, part 1:
-- custom fields with eleven types, typed value storage, an organisation field
-- library, option rows with colours, ID sequences and timers.
-- Feature switch "pm_planning" (default OFF). With it off the screens are as
-- in v1.63 (text, number, choice and date fields); the storage below is used
-- either way, and the old column `task_field_values.value` keeps being written
-- (a plain-text copy of every value), so v1.63 code still reads every value.
--
-- 1. project_fields becomes the field definition: 11 kinds, description,
--    library flag (project_id NULL = an organisation library field), notify on
--    change, per-type settings (config_json: number format, decimals, formula,
--    reference/lookup, date with time), the ID prefix and its next number, and
--    who deleted it (a deleted field can be restored for 30 days; the 30-day
--    purge job then removes it with its values). Library names are unique.
-- 2. project_field_links: which projects show which fields (local fields in
--    their own project, library fields in every project that added them), in
--    what order, and whether the field was removed from the project (its
--    values stay and come back when it is added again).
--    Every existing field gets its link; a field removed before v1.64 becomes
--    "removed from the project" (not deleted), so none of its values is lost.
-- 3. project_field_options: the options of single- and multi-select fields
--    (name, colour 1..8 from the identity tokens, order, archived), copied
--    from options_json (kept, and kept up to date, for v1.63 code).
-- 4. task_field_values gets typed columns side by side with `value`:
--    text_value, number_value, date_value, time_value, option_id, ids_json
--    (multi-select options, people, referenced tasks), id_seq (an ID field's
--    number, unique per field) and typed_at (when the typed columns were
--    written). The existing values are copied into them below; `value` is NOT
--    dropped. Rows that can't be read as their kind keep typed_at NULL and are
--    still read from `value`.
-- 5. task_field_timer_runs: start/stop runs of timer fields per person (one
--    running run per person, task and field).
-- The limits (150 fields per project, 60 per task, 500 options per field) are
-- Admin settings ('tasks.field_limits' in system_settings, written when an
-- admin saves them): no schema change. "Only admins customise" is part of
-- projects.permissions_json: no schema change.
-- Run order: after 202611221200_pm_a_home_widgets.sql.
--
-- Rollback (after rolling the code back to v1.63.x; every value is still in
-- task_field_values.value, so v1.63 shows text, number, choice and date values):
--   UPDATE project_fields f JOIN project_field_links l ON l.field_id = f.id AND l.project_id = f.project_id
--     SET f.deleted_at = COALESCE(f.deleted_at, l.removed_at) WHERE l.removed_at IS NOT NULL;
--   DROP TABLE task_field_timer_runs;
--   ALTER TABLE task_field_values DROP INDEX uq_task_field_values_id_seq, DROP INDEX idx_task_field_values_field,
--     DROP COLUMN text_value, DROP COLUMN number_value, DROP COLUMN date_value, DROP COLUMN time_value,
--     DROP COLUMN option_id, DROP COLUMN ids_json, DROP COLUMN id_seq, DROP COLUMN typed_at;
--   DROP TABLE project_field_options;
--   DROP TABLE project_field_links;
--   Library fields (project_id NULL) and fields of the new kinds have no place in v1.63:
--   DELETE v FROM task_field_values v JOIN project_fields f ON f.id = v.field_id
--     WHERE f.project_id IS NULL OR f.kind NOT IN ('TEXT', 'NUMBER', 'SELECT', 'DATE');
--   DELETE FROM project_fields WHERE project_id IS NULL OR kind NOT IN ('TEXT', 'NUMBER', 'SELECT', 'DATE');
--   ALTER TABLE project_fields DROP INDEX uq_project_fields_library, DROP COLUMN library_key,
--     DROP COLUMN description, DROP COLUMN is_library, DROP COLUMN notify_on_change, DROP COLUMN config_json,
--     DROP COLUMN id_prefix, DROP COLUMN id_next, DROP COLUMN deleted_by, DROP COLUMN updated_at,
--     MODIFY project_id BIGINT UNSIGNED NOT NULL,
--     MODIFY kind ENUM('TEXT', 'NUMBER', 'SELECT', 'DATE') NOT NULL;
--   DELETE FROM system_settings WHERE setting_key IN ('tasks.field_limits', 'features.pm_planning');
-- Owner step (later, not in this file): once the owner confirms the typed
-- values, a later migration may drop task_field_values.value (DEPLOYMENT G0i).

ALTER TABLE project_fields
  MODIFY project_id BIGINT UNSIGNED NULL COMMENT 'the project of a local field; NULL for a library field',
  MODIFY kind ENUM('TEXT', 'NUMBER', 'SELECT', 'DATE', 'MULTI_SELECT', 'PEOPLE', 'FORMULA', 'ID', 'TIMER', 'REFERENCE', 'LOOKUP') NOT NULL,
  ADD COLUMN description VARCHAR(500) NULL AFTER name,
  ADD COLUMN is_library BOOLEAN NOT NULL DEFAULT FALSE AFTER kind,
  ADD COLUMN notify_on_change BOOLEAN NOT NULL DEFAULT FALSE AFTER is_library,
  ADD COLUMN config_json JSON NULL AFTER options_json,
  ADD COLUMN id_prefix VARCHAR(12) NULL AFTER config_json,
  ADD COLUMN id_next BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER id_prefix,
  ADD COLUMN deleted_by BIGINT UNSIGNED NULL AFTER deleted_at,
  ADD COLUMN updated_at DATETIME NULL AFTER created_at,
  ADD COLUMN library_key VARCHAR(60) AS (CASE WHEN is_library AND deleted_at IS NULL THEN name END) STORED,
  ADD UNIQUE INDEX uq_project_fields_library (library_key),
  ADD CONSTRAINT fk_project_fields_deleted_by FOREIGN KEY (deleted_by) REFERENCES users(id);

CREATE TABLE project_field_links (
  project_id    BIGINT UNSIGNED NOT NULL,
  field_id      BIGINT UNSIGNED NOT NULL,
  position      DOUBLE          NOT NULL DEFAULT 0,
  show_on_cards BOOLEAN         NOT NULL DEFAULT TRUE,
  added_by      BIGINT UNSIGNED NULL,
  added_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at    DATETIME        NULL COMMENT 'removed from this project: values kept, back when added again',
  PRIMARY KEY (project_id, field_id),
  CONSTRAINT fk_project_field_links_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_project_field_links_field FOREIGN KEY (field_id) REFERENCES project_fields(id),
  CONSTRAINT fk_project_field_links_user FOREIGN KEY (added_by) REFERENCES users(id),
  INDEX idx_project_field_links_field (field_id),
  INDEX idx_project_field_links_order (project_id, removed_at, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every existing field in its project; a field removed before v1.64 is
-- "removed from the project" (values kept), not deleted.
INSERT INTO project_field_links (project_id, field_id, position, added_by, added_at, removed_at)
  SELECT project_id, id, position, created_by, created_at, deleted_at FROM project_fields WHERE project_id IS NOT NULL;
UPDATE project_fields SET deleted_at = NULL WHERE deleted_at IS NOT NULL;

CREATE TABLE project_field_options (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  field_id    BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(60)     NOT NULL,
  color       TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '1..8 = --color-identity-N; 0 = none',
  position    DOUBLE          NOT NULL DEFAULT 0,
  archived_at DATETIME        NULL COMMENT 'kept on tasks, not offered for new choices',
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_project_field_options_field FOREIGN KEY (field_id) REFERENCES project_fields(id),
  INDEX idx_project_field_options_field (field_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The choices of today's "Choice" fields, in their order, coloured in turn.
INSERT INTO project_field_options (field_id, name, color, position)
  SELECT f.id, j.name, MOD(j.n - 1, 8) + 1, j.n * 1024
  FROM project_fields f, JSON_TABLE(f.options_json, '$[*]' COLUMNS (n FOR ORDINALITY, name VARCHAR(60) PATH '$')) j
  WHERE f.kind = 'SELECT' AND j.name IS NOT NULL AND j.name <> '';

ALTER TABLE task_field_values
  ADD COLUMN text_value   TEXT            NULL AFTER value,
  ADD COLUMN number_value DECIMAL(30, 6)  NULL AFTER text_value,
  ADD COLUMN date_value   DATE            NULL AFTER number_value,
  ADD COLUMN time_value   TIME            NULL AFTER date_value,
  ADD COLUMN option_id    BIGINT UNSIGNED NULL AFTER time_value,
  ADD COLUMN ids_json     JSON            NULL COMMENT 'multi-select option ids, people ids or referenced task ids' AFTER option_id,
  ADD COLUMN id_seq       BIGINT UNSIGNED NULL COMMENT 'an ID field: its number' AFTER ids_json,
  ADD COLUMN typed_at     DATETIME        NULL COMMENT 'set once the typed columns hold the value' AFTER id_seq,
  ADD INDEX idx_task_field_values_field (field_id),
  ADD UNIQUE INDEX uq_task_field_values_id_seq (field_id, id_seq);

-- Copy today's values into the typed columns (side by side; `value` stays).
UPDATE task_field_values v JOIN project_fields f ON f.id = v.field_id
  SET v.text_value = v.value, v.typed_at = UTC_TIMESTAMP()
  WHERE f.kind = 'TEXT' AND v.typed_at IS NULL;
UPDATE task_field_values v JOIN project_fields f ON f.id = v.field_id
  SET v.number_value = CAST(v.value AS DECIMAL(30, 6)), v.typed_at = UTC_TIMESTAMP()
  WHERE f.kind = 'NUMBER' AND v.typed_at IS NULL AND v.value REGEXP '^-?[0-9]{1,15}(\\.[0-9]{1,6})?$';
UPDATE task_field_values v JOIN project_fields f ON f.id = v.field_id
  SET v.date_value = CAST(v.value AS DATE), v.typed_at = UTC_TIMESTAMP()
  WHERE f.kind = 'DATE' AND v.typed_at IS NULL AND v.value REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';
UPDATE task_field_values v JOIN project_fields f ON f.id = v.field_id
  JOIN project_field_options o ON o.field_id = v.field_id AND o.name = v.value
  SET v.option_id = o.id, v.typed_at = UTC_TIMESTAMP()
  WHERE f.kind = 'SELECT' AND v.typed_at IS NULL;

CREATE TABLE task_field_timer_runs (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id     BIGINT UNSIGNED NOT NULL,
  field_id    BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  started_at  DATETIME        NOT NULL,
  stopped_at  DATETIME        NULL,
  running     TINYINT AS (CASE WHEN stopped_at IS NULL THEN 1 END) STORED,
  CONSTRAINT fk_task_field_timer_runs_task FOREIGN KEY (task_id) REFERENCES tasks(id),
  CONSTRAINT fk_task_field_timer_runs_field FOREIGN KEY (field_id) REFERENCES project_fields(id),
  CONSTRAINT fk_task_field_timer_runs_user FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE INDEX uq_task_field_timer_runs_running (task_id, field_id, user_id, running),
  INDEX idx_task_field_timer_runs_field (field_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
