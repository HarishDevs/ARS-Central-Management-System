-- v1.71.1 (D-385, Q-035): the 30-day purge (v1.62.0, D-368) deletes the edit
-- history (comment_versions) of a task's comments, but the v1.60.0 guard
-- trigger trg_comment_versions_no_delete refused every delete. Wherever the
-- trigger is installed (database/optional/v1600_comment_triggers.sql run in
-- phpMyAdmin, or the test database), a deleted task with an edited comment
-- stopped the whole purge batch. Like trg_task_events_no_delete (D-368), the
-- trigger now allows deleting only the versions of a task comment whose task
-- has been in Deleted for more than 30 days; request and ticket comment
-- versions, and everything else, stay undeletable. Run after 202611222000.
--
-- Hosted MySQL refuses CREATE/DROP TRIGGER for the app's user (D-370): both
-- blocks are optional. IT then runs database/optional/v1600_comment_triggers.sql
-- (updated in v1.71.1) once more in phpMyAdmin.
--
-- Rollback: DROP TRIGGER IF EXISTS trg_comment_versions_no_delete; then
--   CREATE TRIGGER trg_comment_versions_no_delete BEFORE DELETE ON comment_versions FOR EACH ROW
--   SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'comment_versions is append-only';

-- @optional
-- @begin
DROP TRIGGER IF EXISTS trg_comment_versions_no_delete;
-- @end

-- @optional
-- @begin
CREATE TRIGGER trg_comment_versions_no_delete BEFORE DELETE ON comment_versions
FOR EACH ROW
BEGIN
  IF OLD.target <> 'TASK' OR NOT EXISTS (
    SELECT 1 FROM task_comments c JOIN tasks t ON t.id = c.task_id
    WHERE c.id = OLD.comment_id AND t.deleted_at IS NOT NULL AND t.deleted_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'comment_versions is append-only';
  END IF;
END;
-- @end
