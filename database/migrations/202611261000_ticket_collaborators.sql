-- v1.92.0 (D-438, owner 26 Nov 2026, answering Q-036: "tickets get
-- collaborators, like requests"). People the ticket's raiser, its form's
-- coordinators, its assignee or IT added to follow one ticket: they see it,
-- comment (and add files with the Ticketing module) and are told how it goes.
-- They never assign, work on, confirm or reopen it.
-- The same shape as request_collaborators (v1.6.1): one row per ticket and
-- person; removing someone stamps removed_at / removed_by (the row stays, so
-- the history of who could see the ticket is kept; adding them again clears
-- the stamp). The primary key makes "one active pair" hold even under two
-- concurrent adds.
--
-- Additive only: a new table, no change to existing tables or data, no
-- trigger. Idempotent: the runner records it in schema_migrations, and
-- CREATE TABLE IF NOT EXISTS lets it run again on a database that already
-- has the table (e.g. restored from a newer backup).
--
-- Recovery (forward fix): the table is additive; the v1.91.x code never reads
-- it. To roll the code back, leave the table in place (harmless). Only if it
-- must go, after rolling the code back:
--   DROP TABLE ticket_collaborators;
--   DELETE FROM schema_migrations WHERE filename = '202611261000_ticket_collaborators.sql';

CREATE TABLE IF NOT EXISTS ticket_collaborators (
  ticket_id   BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  added_by    BIGINT UNSIGNED NOT NULL,
  added_at    DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_by  BIGINT UNSIGNED NULL,
  removed_at  DATETIME        NULL,
  PRIMARY KEY (ticket_id, user_id),
  INDEX idx_ticket_collaborators_user (user_id, removed_at),
  CONSTRAINT fk_ticket_collaborators_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id),
  CONSTRAINT fk_ticket_collaborators_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_ticket_collaborators_added FOREIGN KEY (added_by) REFERENCES users(id),
  CONSTRAINT fk_ticket_collaborators_removed FOREIGN KEY (removed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
