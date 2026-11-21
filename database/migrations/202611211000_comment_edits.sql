-- v1.60.0 (D-365, owner, 21 Nov 2026: "i want edit option in all the comments";
-- answers: keep every version; the author and IT admins; no time limit; edit
-- and delete). Comments on requests, tickets (remarks) and tasks can be edited
-- and deleted. Every earlier text is kept in comment_versions (append-only), so
-- the history still shows what was first said (D-061 kept in spirit: nothing is
-- lost). request_comments stays undeletable as a row; a "deleted" comment is
-- only marked. Run after 202611201000.
--
-- Rollback (after rolling the code back):
--   DROP TRIGGER IF EXISTS trg_request_comments_keep_identity;
--   CREATE TRIGGER trg_request_comments_no_update BEFORE UPDATE ON request_comments FOR EACH ROW
--     BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'request_comments is append-only'; END;
--   (the new columns and comment_versions can stay; they are unused by the old code)

CREATE TABLE comment_versions (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  target      ENUM('REQUEST', 'TICKET', 'TASK') NOT NULL,
  comment_id  BIGINT UNSIGNED NOT NULL,
  body        TEXT            NOT NULL COMMENT 'the text before this change',
  change_kind ENUM('EDIT', 'DELETE') NOT NULL,
  changed_by  BIGINT UNSIGNED NOT NULL,
  changed_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_comment_versions_by FOREIGN KEY (changed_by) REFERENCES users(id),
  INDEX idx_comment_versions_comment (target, comment_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- @begin
CREATE TRIGGER trg_comment_versions_no_update BEFORE UPDATE ON comment_versions
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'comment_versions is append-only';
END;
-- @end

-- @begin
CREATE TRIGGER trg_comment_versions_no_delete BEFORE DELETE ON comment_versions
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'comment_versions is append-only';
END;
-- @end

ALTER TABLE request_comments
  ADD COLUMN edited_at  DATETIME        NULL,
  ADD COLUMN edited_by  BIGINT UNSIGNED NULL,
  ADD COLUMN deleted_at DATETIME        NULL,
  ADD COLUMN deleted_by BIGINT UNSIGNED NULL;

ALTER TABLE ticket_comments
  ADD COLUMN edited_at  DATETIME        NULL,
  ADD COLUMN edited_by  BIGINT UNSIGNED NULL,
  ADD COLUMN deleted_by BIGINT UNSIGNED NULL;

ALTER TABLE task_comments
  ADD COLUMN edited_by  BIGINT UNSIGNED NULL;

-- request_comments: the text may change now (its versions are kept); who wrote
-- it, on which request and when may not. Rows are still never deleted.
DROP TRIGGER IF EXISTS trg_request_comments_no_update;

-- @begin
CREATE TRIGGER trg_request_comments_keep_identity BEFORE UPDATE ON request_comments
FOR EACH ROW
BEGIN
  IF NEW.id <> OLD.id OR NEW.request_id <> OLD.request_id OR NEW.author_id <> OLD.author_id OR NEW.created_at <> OLD.created_at THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'request_comments: only the text may change';
  END IF;
END;
-- @end
