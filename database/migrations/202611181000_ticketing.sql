-- v1.55.0 (D-326, D-327): Ticketing System, Phase 3 core. Additive only.
-- Ticket forms are module types (module = 'TICKET'), built with the shared
-- Form Builder and versioned like Task and Information types; every ticket
-- keeps the form version it was raised with. Coordinators are set per form
-- (owner, 18 Nov 2026). The work itself is a normal task linked by ticket_id.
--
-- Rollback (after rolling the code back; the ENUM values can stay):
--   ALTER TABLE tasks DROP FOREIGN KEY fk_tasks_ticket, DROP COLUMN ticket_id;
--   DROP TABLE ticket_confirm_steps, ticket_feedback, ticket_comments, ticket_events, tickets,
--              ticket_coordinators, ticket_request_types, ticket_categories;

ALTER TABLE module_types MODIFY module ENUM('TASK', 'INFO', 'TICKET') NOT NULL;
ALTER TABLE record_files MODIFY entity_type ENUM('TASK', 'INFO', 'TICKET') NOT NULL;
ALTER TABLE notifications MODIFY category ENUM('APPROVAL', 'TASK', 'INFORMATION', 'SYSTEM', 'MEETING', 'TICKET') NULL;
ALTER TABLE notification_rules MODIFY module ENUM('APPROVAL', 'TASK', 'TICKET') NOT NULL;

-- IT Software, IT Hardware, Admin… (data, not code).
CREATE TABLE ticket_categories (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(40)     NOT NULL,
  name           VARCHAR(80)     NOT NULL,
  number_prefix  VARCHAR(10)     NOT NULL COMMENT 'e.g. IT-SW: numbers read IT-SW-2026-00001 (request_sequences.prefix is 10)',
  number_digits  TINYINT UNSIGNED NOT NULL DEFAULT 5,
  position       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  active         BOOLEAN         NOT NULL DEFAULT TRUE,
  created_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ticket_categories_code (code),
  CONSTRAINT fk_ticket_categories_by FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO ticket_categories (code, name, number_prefix, number_digits, position) VALUES
  ('IT_SOFTWARE', 'IT Software', 'IT-SW', 5, 1),
  ('IT_HARDWARE', 'IT Hardware', 'IT-HW', 5, 2),
  ('ADMIN', 'Admin', 'ADM', 5, 3);

-- A ticket form (request type) belongs to one category.
CREATE TABLE ticket_request_types (
  type_id      BIGINT UNSIGNED NOT NULL COMMENT 'module_types.id with module = TICKET',
  category_id  BIGINT UNSIGNED NOT NULL,
  position     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (type_id),
  KEY idx_ticket_request_types_category (category_id),
  CONSTRAINT fk_ticket_request_types_type FOREIGN KEY (type_id) REFERENCES module_types (id),
  CONSTRAINT fk_ticket_request_types_category FOREIGN KEY (category_id) REFERENCES ticket_categories (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The people who allot a form's tickets (any one of them may act). Kept per
-- form, not per version: changing them needs no new form version.
CREATE TABLE ticket_coordinators (
  type_id     BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  added_by    BIGINT UNSIGNED NULL,
  added_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (type_id, user_id),
  KEY idx_ticket_coordinators_user (user_id),
  CONSTRAINT fk_ticket_coordinators_type FOREIGN KEY (type_id) REFERENCES module_types (id),
  CONSTRAINT fk_ticket_coordinators_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_ticket_coordinators_by FOREIGN KEY (added_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tickets (
  id                         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_no                  VARCHAR(40)     NOT NULL,
  category_id                BIGINT UNSIGNED NOT NULL,
  type_version_id            BIGINT UNSIGNED NOT NULL COMMENT 'the form version it was raised with (immutable)',
  title                      VARCHAR(200)    NOT NULL,
  description                TEXT            NULL,
  form_data_json             JSON            NOT NULL,
  requester_id               BIGINT UNSIGNED NOT NULL,
  requester_department_id    BIGINT UNSIGNED NULL COMMENT 'snapshot when raised',
  priority                   ENUM('HIGH', 'MEDIUM', 'LOW') NOT NULL DEFAULT 'MEDIUM',
  -- Owner's simple workflow (18 Nov 2026): CLOSED with close_kind AUTO is "Closed – auto closed".
  status                     ENUM('NEW', 'ASSIGNED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'REOPENED', 'CLOSED') NOT NULL DEFAULT 'NEW',
  close_kind                 ENUM('CONFIRMED', 'AUTO') NULL,
  close_reason               VARCHAR(200)    NULL COMMENT 'e.g. no answer in 4 working days',
  required_on                DATE            NULL COMMENT 'the date the requester needs it by',
  assignee_id                BIGINT UNSIGNED NULL,
  coordinator_id             BIGINT UNSIGNED NULL COMMENT 'the coordinator who acted last',
  task_id                    BIGINT UNSIGNED NULL COMMENT 'the primary linked task',
  due_at                     DATETIME        NULL COMMENT 'the target date the coordinator set',
  submitted_at               DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  first_response_at          DATETIME        NULL,
  assigned_at                DATETIME        NULL,
  work_started_at            DATETIME        NULL,
  resolved_at                DATETIME        NULL,
  confirmation_requested_at  DATETIME        NULL,
  confirm_due_on             DATE            NULL COMMENT 'India day the ticket auto-closes on',
  closed_at                  DATETIME        NULL,
  resolution_text            TEXT            NULL,
  reopen_count               SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  submission_key             VARCHAR(64)     NOT NULL,
  row_version                INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at                 DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                 DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tickets_no (ticket_no),
  UNIQUE KEY uq_tickets_submission (requester_id, submission_key),
  KEY idx_tickets_status (status, category_id),
  KEY idx_tickets_requester (requester_id, status),
  KEY idx_tickets_assignee (assignee_id, status),
  KEY idx_tickets_confirm (status, confirm_due_on),
  CONSTRAINT fk_tickets_category FOREIGN KEY (category_id) REFERENCES ticket_categories (id),
  CONSTRAINT fk_tickets_version FOREIGN KEY (type_version_id) REFERENCES module_type_versions (id),
  CONSTRAINT fk_tickets_requester FOREIGN KEY (requester_id) REFERENCES users (id),
  CONSTRAINT fk_tickets_department FOREIGN KEY (requester_department_id) REFERENCES departments (id),
  CONSTRAINT fk_tickets_assignee FOREIGN KEY (assignee_id) REFERENCES users (id),
  CONSTRAINT fk_tickets_coordinator FOREIGN KEY (coordinator_id) REFERENCES users (id),
  CONSTRAINT fk_tickets_task FOREIGN KEY (task_id) REFERENCES tasks (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE tasks
  ADD COLUMN ticket_id BIGINT UNSIGNED NULL COMMENT 'v1.55.0: the ticket this task carries out' AFTER related_request_id,
  ADD KEY idx_tasks_ticket (ticket_id),
  ADD CONSTRAINT fk_tasks_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id);

-- The ticket's timeline (append-only: the app only inserts).
CREATE TABLE ticket_events (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id    BIGINT UNSIGNED NOT NULL,
  actor_id     BIGINT UNSIGNED NULL COMMENT 'NULL = the system (e.g. auto-close)',
  action       VARCHAR(40)     NOT NULL,
  from_status  VARCHAR(30)     NULL,
  to_status    VARCHAR(30)     NULL,
  detail_json  JSON            NULL,
  internal     BOOLEAN         NOT NULL DEFAULT FALSE COMMENT 'hidden from the requester',
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ticket_events_ticket (ticket_id, id),
  CONSTRAINT fk_ticket_events_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id),
  CONSTRAINT fk_ticket_events_actor FOREIGN KEY (actor_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ticket_comments (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id   BIGINT UNSIGNED NOT NULL,
  author_id   BIGINT UNSIGNED NOT NULL,
  body        TEXT            NOT NULL,
  internal    BOOLEAN         NOT NULL DEFAULT FALSE COMMENT 'coordinators and the assignee only',
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at  DATETIME        NULL,
  PRIMARY KEY (id),
  KEY idx_ticket_comments_ticket (ticket_id, id),
  CONSTRAINT fk_ticket_comments_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id),
  CONSTRAINT fk_ticket_comments_author FOREIGN KEY (author_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Phase 4 (confirmation): the rating and the exactly-once reminder/closure claims.
CREATE TABLE ticket_feedback (
  ticket_id   BIGINT UNSIGNED NOT NULL,
  cycle       SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'reopen_count when given',
  rating      TINYINT UNSIGNED NULL COMMENT '1-5, optional',
  comment     VARCHAR(1000)   NULL,
  given_by    BIGINT UNSIGNED NOT NULL,
  given_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ticket_id, cycle),
  CONSTRAINT fk_ticket_feedback_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id),
  CONSTRAINT fk_ticket_feedback_by FOREIGN KEY (given_by) REFERENCES users (id),
  CONSTRAINT chk_ticket_feedback_rating CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ticket_confirm_steps (
  ticket_id  BIGINT UNSIGNED NOT NULL,
  cycle      SMALLINT UNSIGNED NOT NULL,
  stage      ENUM('REMIND_2', 'REMIND_3', 'CLOSE') NOT NULL,
  done_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ticket_id, cycle, stage),
  CONSTRAINT fk_ticket_confirm_steps_ticket FOREIGN KEY (ticket_id) REFERENCES tickets (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
