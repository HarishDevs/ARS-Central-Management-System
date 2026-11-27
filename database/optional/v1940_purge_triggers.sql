-- WARNING: do NOT load this file with GoDaddy Database Manager -> Import
-- database. The importer drops EVERY table first and empties the database.
-- The app works without these triggers; skip them on GoDaddy if unsure.
-- v1.94.0 (D-455): the append-only guards on a request's timeline and
-- comments, updated for Super Admin's "Delete permanently" (owner, 27 Nov
-- 2026: bin, then purge). A delete is allowed only while the request has been
-- in the Super Admin bin for 30 days or more; every other delete is refused,
-- as before. The audit log (audit_logs) is never touched: it stays strictly
-- append-only. Run after the v1.94.0 migration (it needs superadmin_bin).
-- For comment edit history, also run v1600_comment_triggers.sql (updated in
-- v1.94.0).
--
-- How: cPanel -> phpMyAdmin -> choose the app database -> SQL -> paste this
-- whole file -> Go. Safe to run again (it drops before it creates).
DROP TRIGGER IF EXISTS trg_approval_events_no_delete;
DROP TRIGGER IF EXISTS trg_request_comments_no_delete;

DELIMITER $$

CREATE TRIGGER trg_approval_events_no_delete BEFORE DELETE ON approval_events
FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM superadmin_bin b WHERE b.active_key = CONCAT('REQUEST:', OLD.request_id) AND b.binned_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'approval_events is append-only';
  END IF;
END$$

CREATE TRIGGER trg_request_comments_no_delete BEFORE DELETE ON request_comments
FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM superadmin_bin b WHERE b.active_key = CONCAT('REQUEST:', OLD.request_id) AND b.binned_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'request_comments is append-only';
  END IF;
END$$

DELIMITER ;
