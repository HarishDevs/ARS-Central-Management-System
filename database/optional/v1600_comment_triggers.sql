-- WARNING (22 Nov 2026): do NOT load this file with GoDaddy Database Manager ->
-- Import database. The importer drops EVERY table first and empties the
-- database. The app works without these triggers; skip them on GoDaddy.
-- v1.60.0 (D-365) / v1.63.1 / v1.71.1: the comment triggers, for hosted MySQL
-- where the app's database user can't create triggers (binary logging needs
-- SUPER), so the migrations skip them with a warning.
--
-- What it does:
-- * drops the old "request_comments is append-only" trigger (if your database
--   has it), which would stop people editing or deleting request comments;
-- * lets only the text of a request comment change;
-- * keeps comment edit history (comment_versions) unchangeable, except that the
--   30-day clean-up may remove the history of a task deleted more than 30 days
--   ago (v1.71.1, D-385).
--
-- How: cPanel -> phpMyAdmin -> choose the app database -> SQL -> paste this
-- whole file -> Go. Safe to run again (it drops before it creates). The
-- DELIMITER lines are needed because the trigger bodies contain ";".
DROP TRIGGER IF EXISTS trg_request_comments_no_update;
DROP TRIGGER IF EXISTS trg_request_comments_keep_identity;
DROP TRIGGER IF EXISTS trg_comment_versions_no_update;
DROP TRIGGER IF EXISTS trg_comment_versions_no_delete;

DELIMITER $$

CREATE TRIGGER trg_request_comments_keep_identity BEFORE UPDATE ON request_comments
FOR EACH ROW
BEGIN
  IF NEW.id <> OLD.id OR NEW.request_id <> OLD.request_id OR NEW.author_id <> OLD.author_id OR NEW.created_at <> OLD.created_at THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'request_comments: only the text may change';
  END IF;
END$$

CREATE TRIGGER trg_comment_versions_no_update BEFORE UPDATE ON comment_versions
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'comment_versions is append-only';
END$$

CREATE TRIGGER trg_comment_versions_no_delete BEFORE DELETE ON comment_versions
FOR EACH ROW
BEGIN
  IF OLD.target <> 'TASK' OR NOT EXISTS (
    SELECT 1 FROM task_comments c JOIN tasks t ON t.id = c.task_id
    WHERE c.id = OLD.comment_id AND t.deleted_at IS NOT NULL AND t.deleted_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'comment_versions is append-only';
  END IF;
END$$

DELIMITER ;
