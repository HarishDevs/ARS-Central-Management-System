-- v1.63.0 (D-366 plan approved; D-369 build): Project Management phase A, part 3.
-- Home widgets (PM-A12, spec HOME_MODULE): each person's own Home layout (which
-- widgets, their order and size: half or full width) and a private notepad.
-- Both are per person and never shown to anyone else; nothing is written
-- until the person customises Home or types a note (until then Home shows the
-- default layout and an empty note).
-- My Tasks tabs (PM-A13) need no schema change: they are work_views rows with
-- scope 'MY_TASKS' (D-220) and the user_settings key 'work.my_tabs_set'.
-- Run order: after 202611221100_pm_a_reactions_sidebar.sql.
--
-- Rollback (after rolling the code back to v1.62.x; the layouts and notes are lost):
--   DROP TABLE home_notes;
--   DROP TABLE home_layouts;
--   Optional, My Tasks tabs written by v1.63.0 (the old code shows only List tabs;
--   the built-in List tab would show as a saved tab named "List"):
--   DELETE FROM work_views WHERE scope = 'MY_TASKS' AND (view_type <> 'LIST' OR name = 'List');
--   DELETE FROM user_settings WHERE setting_key = 'work.my_tabs_set';

CREATE TABLE home_layouts (
  user_id      BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  widgets_json JSON            NOT NULL COMMENT '[{kind, size}] in order; server/home/widgets.ts',
  version      INT UNSIGNED    NOT NULL DEFAULT 1 COMMENT 'optimistic concurrency: a save names the version it changed',
  updated_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_home_layouts_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE home_notes (
  user_id    BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  body       MEDIUMTEXT      NOT NULL COMMENT 'the app formatting text (rich-text.ts), at most 50,000 characters',
  version    INT UNSIGNED    NOT NULL DEFAULT 1,
  updated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_home_notes_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
