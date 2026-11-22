-- v1.79.0 (D-406): the three Home overviews identically featured.
-- Each person now keeps a separate widget layout per overview (Approvals,
-- My Work = tasks, Meetings). home_layouts gets a `scope` column and the key
-- becomes (user_id, scope). Every layout saved before this release was a
-- Task Management (My Work) layout, so existing rows take scope 'tasks' and
-- nobody's Home changes. The private notepad (home_notes) stays one note per
-- person, shared by all three overviews (no change).
-- No triggers. Run order: after 202611231100_task_summary_r2.sql (and any
-- Task Summary R3 migration of v1.78.0).
--
-- Rollback (after rolling the code back to v1.78.x; Approvals and Meetings
-- layouts are lost, Task layouts kept):
--   DELETE FROM home_layouts WHERE scope <> 'tasks';
--   ALTER TABLE home_layouts DROP PRIMARY KEY, ADD PRIMARY KEY (user_id), DROP COLUMN scope;

ALTER TABLE home_layouts
  ADD COLUMN scope VARCHAR(16) NOT NULL DEFAULT 'tasks' COMMENT 'which Home overview: approvals, tasks or meetings (server/home/widgets.ts)' AFTER user_id,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (user_id, scope);
