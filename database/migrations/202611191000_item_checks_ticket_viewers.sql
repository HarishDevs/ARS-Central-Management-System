-- v1.57.0 (owner, 18 Nov 2026):
-- (1) D-335 "one more line items with tick boxes ... a stationary items list with qty
--     request box so that the admin can confirm what are all provided": the ticks of
--     an Item list field (form field type ITEM_LIST), one row per item line of a
--     request or ticket. The items themselves stay in the record's form data.
-- (2) D-336 "ticket dashboards should also be visible to IT team": the departments
--     and people who see every ticket (dashboards, coordinator board, analytics,
--     and each ticket read-only), set in Admin → Ticket categories.
--
-- Rollback (after rolling the code back):
--   DROP TABLE record_item_checks;
--   DROP TABLE ticket_viewers;

CREATE TABLE record_item_checks (
  entity_type  ENUM('REQUEST', 'TICKET') NOT NULL,
  entity_id    BIGINT UNSIGNED NOT NULL,
  field_key    VARCHAR(80)     NOT NULL,
  line_no      SMALLINT UNSIGNED NOT NULL COMMENT '0-based position in the stored item list',
  provided     BOOLEAN         NOT NULL DEFAULT FALSE,
  checked_by   BIGINT UNSIGNED NOT NULL,
  checked_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entity_type, entity_id, field_key, line_no),
  CONSTRAINT fk_record_item_checks_by FOREIGN KEY (checked_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ticket_viewers (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  department_id  BIGINT UNSIGNED NULL,
  user_id        BIGINT UNSIGNED NULL,
  created_by     BIGINT UNSIGNED NOT NULL,
  created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ticket_viewers_department (department_id),
  UNIQUE KEY uq_ticket_viewers_user (user_id),
  CONSTRAINT fk_ticket_viewers_department FOREIGN KEY (department_id) REFERENCES departments (id),
  CONSTRAINT fk_ticket_viewers_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_ticket_viewers_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT chk_ticket_viewers_one CHECK ((department_id IS NULL) <> (user_id IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
