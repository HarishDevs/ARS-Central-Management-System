-- WARNING (22 Nov 2026): do NOT load this file with GoDaddy Database Manager ->
-- Import database. The importer drops EVERY table first and empties the
-- database. The app works without these triggers; skip them on GoDaddy.
-- v1.9.0 / v1.62.0 / v1.71.2: optional append-only guards for the task and
-- information history (task_events, info_events). The app only ever inserts
-- into these tables, so it works without them; they add a database-level lock
-- against edits.
--
-- v1.71.2 (D-391, QA logic #3): task_events may be deleted only for a task
-- that has been in Deleted for more than 30 days (the 30-day clean-up removes
-- the task and its history together, D-368). The v1.9.0 copy of this file
-- refused every delete, which made that clean-up fail on every run. If you ran
-- the old file, run this one: it replaces the triggers.
--
-- The app's database user can't create triggers on hosted MySQL with binary
-- logging (needs SUPER), so the migrations skip them with a warning. To add
-- them: cPanel -> phpMyAdmin -> choose the app database -> SQL -> paste this
-- whole file -> Go. Safe to run again (it drops before it creates). The
-- DELIMITER lines are needed because the trigger bodies contain ";".
DROP TRIGGER IF EXISTS trg_task_events_no_update;
DROP TRIGGER IF EXISTS trg_task_events_no_delete;
DROP TRIGGER IF EXISTS trg_info_events_no_update;
DROP TRIGGER IF EXISTS trg_info_events_no_delete;

DELIMITER $$

CREATE TRIGGER trg_task_events_no_update BEFORE UPDATE ON task_events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'task_events is append-only';
END$$

CREATE TRIGGER trg_task_events_no_delete BEFORE DELETE ON task_events
FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = OLD.task_id AND t.deleted_at IS NOT NULL AND t.deleted_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'task_events is append-only';
  END IF;
END$$

CREATE TRIGGER trg_info_events_no_update BEFORE UPDATE ON info_events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'info_events is append-only';
END$$

CREATE TRIGGER trg_info_events_no_delete BEFORE DELETE ON info_events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'info_events is append-only';
END$$

DELIMITER ;
