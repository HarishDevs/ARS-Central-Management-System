-- v1.94.0 (D-451..D-458, owner 27 Nov 2026: "From Super admin should be able
-- to create, Modify, Delete, archive anything like approval, task, Ticket at
-- any level"). Super Admin full control.
--
-- 1. superadmin_bin: the one "Deleted items" bin for every module. A row per
--    item Super Admin moved to the bin (and per item moved with it, e.g. a
--    subtask: parent_bin_id). The item itself is hidden through its module's
--    existing soft-delete columns (deleted_at), which every screen, queue,
--    job, search and report already leaves out; this table says who binned
--    it, why, and when it may be deleted permanently (purge_after = 30 days).
--    active_key is set only while the item is in the bin (unique: an item is
--    in the bin at most once at a time). Restored and purged rows stay as the
--    bin's history (number, title, who, when, why), never the item content.
-- 2. Archive: archived_at / archived_by on approval_requests, tasks, tickets
--    (read-only, still visible, un-archivable).
-- 3. Create on behalf: created_on_behalf_by on the same three tables (the
--    Super Admin who raised it for the requester / creator).
-- 4. tickets gain the soft-delete columns the other modules already have.
-- 5. Existing requests deleted by Super Admin before (D-086) are put in the
--    bin, so they can be restored or deleted permanently like the rest.
-- 6. The append-only guards (optional triggers) allow a delete only while the
--    request / ticket comment's item has been in the bin for 30 days or more
--    (the owner-approved permanent delete, D-455). audit_logs stays strictly
--    append-only (its triggers are not touched).
--
-- Additive and backward compatible: new nullable columns and a new table; the
-- v1.93 code never reads them. Detection: the runner records the file in
-- schema_migrations and never runs it twice.
--
-- Recovery (forward fix preferred). To roll the code back, leave the columns
-- and table in place (harmless; items still in the bin stay hidden because
-- their deleted_at is set: restore them first with the v1.94 code if they are
-- wanted back). Only if the schema must go, after rolling back:
--   ALTER TABLE approval_requests DROP COLUMN archived_at, DROP COLUMN archived_by, DROP COLUMN created_on_behalf_by;
--   ALTER TABLE tasks DROP COLUMN archived_at, DROP COLUMN archived_by, DROP COLUMN created_on_behalf_by;
--   ALTER TABLE tickets DROP COLUMN deleted_at, DROP COLUMN deleted_by, DROP COLUMN archived_at, DROP COLUMN archived_by, DROP COLUMN created_on_behalf_by;
--   DROP TABLE superadmin_bin;
--   then re-run the v1.71.1 trigger blocks (database/optional/v1600_comment_triggers.sql) and
--   the approval_events / request_comments blocks of 202609291201 / 202610011200 in phpMyAdmin;
--   DELETE FROM schema_migrations WHERE filename = '202611271000_superadmin_control.sql';
-- The trigger blocks are optional (hosted MySQL refuses triggers to the app's
-- user): on GoDaddy they are skipped with a warning; IT may run
-- database/optional/v1940_purge_triggers.sql once in phpMyAdmin (never with
-- Database Manager -> Import).

CREATE TABLE IF NOT EXISTS superadmin_bin (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_type     VARCHAR(20)     NOT NULL COMMENT 'REQUEST, TASK, TICKET (server/superadmin/control/registry.ts)',
  entity_id       BIGINT UNSIGNED NOT NULL COMMENT 'no foreign key: the row outlives a permanent delete',
  parent_bin_id   BIGINT UNSIGNED NULL COMMENT 'moved to the bin with this entry (restored and purged with it)',
  entity_no       VARCHAR(40)     NULL,
  title           VARCHAR(200)    NOT NULL,
  detail_json     JSON            NULL COMMENT 'what the bin needs to put it back (e.g. the statuses before)',
  reason          VARCHAR(500)    NOT NULL,
  binned_by       BIGINT UNSIGNED NULL,
  binned_at       DATETIME        NOT NULL COMMENT 'UTC',
  purge_after     DATETIME        NOT NULL COMMENT 'UTC; Delete permanently is allowed from then on',
  restored_at     DATETIME        NULL,
  restored_by     BIGINT UNSIGNED NULL,
  restore_reason  VARCHAR(500)    NULL,
  purged_at       DATETIME        NULL,
  purged_by       BIGINT UNSIGNED NULL,
  active_key      VARCHAR(40) AS (CASE WHEN restored_at IS NULL AND purged_at IS NULL THEN CONCAT(entity_type, ':', entity_id) END) STORED,
  UNIQUE KEY uq_superadmin_bin_active (active_key),
  INDEX idx_superadmin_bin_entity (entity_type, entity_id),
  INDEX idx_superadmin_bin_list (parent_bin_id, binned_at),
  CONSTRAINT fk_superadmin_bin_parent FOREIGN KEY (parent_bin_id) REFERENCES superadmin_bin(id),
  CONSTRAINT fk_superadmin_bin_binned_by FOREIGN KEY (binned_by) REFERENCES users(id),
  CONSTRAINT fk_superadmin_bin_restored_by FOREIGN KEY (restored_by) REFERENCES users(id),
  CONSTRAINT fk_superadmin_bin_purged_by FOREIGN KEY (purged_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE approval_requests
  ADD COLUMN archived_at          DATETIME        NULL COMMENT 'D-456: read-only, still visible',
  ADD COLUMN archived_by          BIGINT UNSIGNED NULL,
  ADD COLUMN created_on_behalf_by BIGINT UNSIGNED NULL COMMENT 'D-458: the Super Admin who raised it for the requester',
  ADD CONSTRAINT fk_approval_requests_archived_by FOREIGN KEY (archived_by) REFERENCES users(id),
  ADD CONSTRAINT fk_approval_requests_on_behalf FOREIGN KEY (created_on_behalf_by) REFERENCES users(id);

ALTER TABLE tasks
  ADD COLUMN archived_at          DATETIME        NULL COMMENT 'D-456: read-only, still visible',
  ADD COLUMN archived_by          BIGINT UNSIGNED NULL,
  ADD COLUMN created_on_behalf_by BIGINT UNSIGNED NULL COMMENT 'D-458: the Super Admin who created it for the creator',
  ADD CONSTRAINT fk_tasks_archived_by FOREIGN KEY (archived_by) REFERENCES users(id),
  ADD CONSTRAINT fk_tasks_on_behalf FOREIGN KEY (created_on_behalf_by) REFERENCES users(id);

ALTER TABLE tickets
  ADD COLUMN deleted_at           DATETIME        NULL COMMENT 'D-454: in the Super Admin bin: hidden everywhere',
  ADD COLUMN deleted_by           BIGINT UNSIGNED NULL,
  ADD COLUMN archived_at          DATETIME        NULL COMMENT 'D-456: read-only, still visible',
  ADD COLUMN archived_by          BIGINT UNSIGNED NULL,
  ADD COLUMN created_on_behalf_by BIGINT UNSIGNED NULL COMMENT 'D-458: the Super Admin who raised it for the requester',
  ADD CONSTRAINT fk_tickets_deleted_by FOREIGN KEY (deleted_by) REFERENCES users(id),
  ADD CONSTRAINT fk_tickets_archived_by FOREIGN KEY (archived_by) REFERENCES users(id),
  ADD CONSTRAINT fk_tickets_on_behalf FOREIGN KEY (created_on_behalf_by) REFERENCES users(id),
  ADD INDEX idx_tickets_deleted (deleted_at);

-- Requests deleted before this release (D-086) go into the bin.
INSERT INTO superadmin_bin (entity_type, entity_id, entity_no, title, detail_json, reason, binned_by, binned_at, purge_after)
SELECT 'REQUEST', r.id, r.request_no, LEFT(r.title, 200), JSON_OBJECT('from', 'D-086'), COALESCE(NULLIF(r.delete_reason, ''), 'Deleted before v1.94.0'), r.deleted_by, r.deleted_at, DATE_ADD(r.deleted_at, INTERVAL 30 DAY)
FROM approval_requests r
WHERE r.deleted_at IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM superadmin_bin b WHERE b.entity_type = 'REQUEST' AND b.entity_id = r.id);

-- @optional
-- @begin
DROP TRIGGER IF EXISTS trg_approval_events_no_delete;
-- @end

-- @optional
-- @begin
CREATE TRIGGER trg_approval_events_no_delete BEFORE DELETE ON approval_events
FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM superadmin_bin b WHERE b.active_key = CONCAT('REQUEST:', OLD.request_id) AND b.binned_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'approval_events is append-only';
  END IF;
END;
-- @end

-- @optional
-- @begin
DROP TRIGGER IF EXISTS trg_request_comments_no_delete;
-- @end

-- @optional
-- @begin
CREATE TRIGGER trg_request_comments_no_delete BEFORE DELETE ON request_comments
FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM superadmin_bin b WHERE b.active_key = CONCAT('REQUEST:', OLD.request_id) AND b.binned_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'request_comments is append-only';
  END IF;
END;
-- @end

-- @optional
-- @begin
DROP TRIGGER IF EXISTS trg_comment_versions_no_delete;
-- @end

-- @optional
-- @begin
CREATE TRIGGER trg_comment_versions_no_delete BEFORE DELETE ON comment_versions
FOR EACH ROW
BEGIN
  IF NOT (
    (OLD.target = 'TASK' AND EXISTS (
      SELECT 1 FROM task_comments c JOIN tasks t ON t.id = c.task_id
      WHERE c.id = OLD.comment_id AND t.deleted_at IS NOT NULL AND t.deleted_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)))
    OR (OLD.target = 'REQUEST' AND EXISTS (
      SELECT 1 FROM request_comments c JOIN superadmin_bin b ON b.active_key = CONCAT('REQUEST:', c.request_id)
      WHERE c.id = OLD.comment_id AND b.binned_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)))
    OR (OLD.target = 'TICKET' AND EXISTS (
      SELECT 1 FROM ticket_comments c JOIN superadmin_bin b ON b.active_key = CONCAT('TICKET:', c.ticket_id)
      WHERE c.id = OLD.comment_id AND b.binned_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)))
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'comment_versions is append-only';
  END IF;
END;
-- @end

-- task_events: the v1.71.1 trigger already allows a delete once the task has
-- been deleted for 30 days; a binned task's deleted_at is set when it is
-- binned, so the permanent delete fits it unchanged.
