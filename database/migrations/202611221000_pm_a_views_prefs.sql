-- v1.61.0 (D-366 plan approved; D-367 build): Project Management phase A, part 1.
-- Saved tabs for every view of a project (List, Board, Calendar, Timeline,
-- Overview), not only List (D-220). Each tab now has a view type and one tab
-- per project can be its default. A project's tab strip starts as the five
-- built-in views; the first time an owner or editor changes the strip (add,
-- rename, reorder, set default, duplicate or remove), the built-in views are
-- written as rows too (projects.view_tabs_set = TRUE) so every tab can be
-- renamed, reordered or removed. Existing saved tabs stay List tabs.
-- The row density preference lives in user_settings ('work.density'): no
-- schema change for it.
-- Run order: after 202611211000_comment_edits.sql.
--
-- Rollback (after rolling the code back to v1.60.x):
--   DELETE FROM work_views WHERE view_type <> 'LIST';
--   ALTER TABLE work_views DROP COLUMN is_default, DROP COLUMN view_type;
--   The old code reads only List tabs. In projects whose strip was written
--   (view_tabs_set = TRUE) the built-in List tab then also shows as a saved tab
--   named "List"; delete it if wanted (before dropping the column below):
--   DELETE w FROM work_views w JOIN projects p ON p.id = w.scope_id
--     WHERE w.scope = 'PROJECT' AND p.view_tabs_set AND w.name = 'List';
--   ALTER TABLE projects DROP COLUMN view_tabs_set;

ALTER TABLE work_views
  ADD COLUMN view_type ENUM('LIST', 'BOARD', 'CALENDAR', 'TIMELINE', 'OVERVIEW') NOT NULL DEFAULT 'LIST' AFTER scope_id,
  ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT FALSE AFTER position;

ALTER TABLE projects
  ADD COLUMN view_tabs_set BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'v1.61.0: the tab strip is stored in work_views' AFTER default_view;
