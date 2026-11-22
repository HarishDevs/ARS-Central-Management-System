-- v1.60.0 (D-365) / v1.63.1 fix: the comment triggers, for hosted MySQL where
-- the app's database user can't create triggers (binary logging needs SUPER),
-- so the migration 202611211000_comment_edits.sql skips them with a warning.
--
-- IMPORTANT: run this once after publishing v1.63.1 or later. Without the
-- DROP below, an old "request_comments is append-only" trigger (if your
-- database has it) stops people editing or deleting request comments.
--
-- cPanel -> phpMyAdmin -> choose the app database -> SQL -> paste this file
-- -> Go. Safe to run twice (it drops before it creates).
DROP TRIGGER IF EXISTS trg_request_comments_no_update;
DROP TRIGGER IF EXISTS trg_request_comments_keep_identity;
CREATE TRIGGER trg_request_comments_keep_identity BEFORE UPDATE ON request_comments FOR EACH ROW BEGIN IF NEW.id <> OLD.id OR NEW.request_id <> OLD.request_id OR NEW.author_id <> OLD.author_id OR NEW.created_at <> OLD.created_at THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'request_comments: only the text may change'; END IF; END;
DROP TRIGGER IF EXISTS trg_comment_versions_no_update;
DROP TRIGGER IF EXISTS trg_comment_versions_no_delete;
CREATE TRIGGER trg_comment_versions_no_update BEFORE UPDATE ON comment_versions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'comment_versions is append-only';
CREATE TRIGGER trg_comment_versions_no_delete BEFORE DELETE ON comment_versions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'comment_versions is append-only';
