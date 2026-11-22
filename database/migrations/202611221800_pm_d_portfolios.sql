-- v1.69.0 (D-366 plan approved; D-382 build): Project Management phase D,
-- part 3: portfolios. A portfolio groups projects (and other portfolios, up
-- to 5 levels, never in a circle) so their status, task progress and dates
-- can be followed in one place: a List with roll-ups, Progress (status
-- updates and About), a Timeline by quarters and a Dashboard.
-- Feature switch "pm_portfolios" (default OFF). With it off no portfolio
-- screen shows and the server refuses every portfolio operation; the tables
-- below are simply not used.
--
-- Deny by default: seeing a portfolio never opens its projects. A row whose
-- project (or sub-portfolio) the person can't see shows as "Private project"
-- with no details; figures only count projects the person can see.
--
-- 1. portfolios: name, identity colour key (the project colour keys), owner,
--    privacy (PRIVATE = members only, DEPARTMENT = members and the chosen
--    department, ORGANISATION = everyone), default_access_role for people
--    who see it through its privacy, description, dates, the current status
--    (copied from its latest status update), the tab it opens on, archive,
--    delete (30 days in Deleted, then purged by the job runner).
-- 2. portfolio_members: people with a role (OWNER, EDITOR, COMMENTER, VIEWER).
-- 3. portfolio_items: what a portfolio holds: a project (project_id) or
--    another portfolio (child_portfolio_id); exactly one is set (checked by
--    the app). priority is the portfolio's own Priority column for the row.
-- 4. portfolio_fields / portfolio_field_values: the portfolio's own columns
--    (text, number, single-select, date, people) with a value per row.
-- 5. portfolio_status_updates: the portfolio's status updates.
-- 6. work_favourites.object_type gets PORTFOLIO (starred portfolios).
-- No triggers. Nothing existing is changed.
-- Run order: after 202611221700_pm_d_automations.sql.
--
-- Rollback (after rolling the code back to v1.68.x; portfolios are lost):
--   DELETE FROM work_favourites WHERE object_type = 'PORTFOLIO';
--   ALTER TABLE work_favourites MODIFY object_type ENUM('PROJECT', 'SEARCH') NOT NULL;
--   DROP TABLE portfolio_status_updates;
--   DROP TABLE portfolio_field_values;
--   DROP TABLE portfolio_fields;
--   DROP TABLE portfolio_items;
--   DROP TABLE portfolio_members;
--   DROP TABLE portfolios;
--   DELETE FROM system_settings WHERE setting_key = 'features.pm_portfolios';

CREATE TABLE portfolios (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name                VARCHAR(150)    NOT NULL,
  color               VARCHAR(20)     NOT NULL DEFAULT 'blue',
  owner_id            BIGINT UNSIGNED NOT NULL,
  privacy             ENUM('PRIVATE', 'DEPARTMENT', 'ORGANISATION') NOT NULL DEFAULT 'PRIVATE',
  department_id       BIGINT UNSIGNED NULL,
  default_access_role ENUM('EDITOR', 'COMMENTER', 'VIEWER') NOT NULL DEFAULT 'VIEWER',
  description         TEXT            NULL,
  start_on            DATE            NULL,
  due_on              DATE            NULL,
  current_status      ENUM('ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'ON_HOLD', 'COMPLETE', 'DROPPED') NULL,
  default_tab         ENUM('LIST', 'TIMELINE', 'PROGRESS', 'DASHBOARD') NOT NULL DEFAULT 'LIST',
  archived_at         DATETIME        NULL,
  row_version         INT UNSIGNED    NOT NULL DEFAULT 1,
  created_by          BIGINT UNSIGNED NOT NULL,
  deleted_at          DATETIME        NULL,
  deleted_by          BIGINT UNSIGNED NULL,
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_portfolios_owner FOREIGN KEY (owner_id) REFERENCES users(id),
  CONSTRAINT fk_portfolios_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_portfolios_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_portfolios_deleter FOREIGN KEY (deleted_by) REFERENCES users(id),
  INDEX idx_portfolios_privacy (privacy, department_id, archived_at, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE portfolio_members (
  portfolio_id BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  role         ENUM('OWNER', 'EDITOR', 'COMMENTER', 'VIEWER') NOT NULL,
  added_by     BIGINT UNSIGNED NOT NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (portfolio_id, user_id),
  CONSTRAINT fk_portfolio_members_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  CONSTRAINT fk_portfolio_members_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_portfolio_members_adder FOREIGN KEY (added_by) REFERENCES users(id),
  INDEX idx_portfolio_members_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE portfolio_items (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  portfolio_id       BIGINT UNSIGNED NOT NULL,
  project_id         BIGINT UNSIGNED NULL COMMENT 'the item is a project',
  child_portfolio_id BIGINT UNSIGNED NULL COMMENT 'the item is another portfolio (nesting)',
  priority           ENUM('LOW', 'MEDIUM', 'HIGH') NULL,
  position           DOUBLE          NOT NULL DEFAULT 0,
  added_by           BIGINT UNSIGNED NOT NULL,
  added_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_portfolio_items_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  CONSTRAINT fk_portfolio_items_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_portfolio_items_child FOREIGN KEY (child_portfolio_id) REFERENCES portfolios(id),
  CONSTRAINT fk_portfolio_items_adder FOREIGN KEY (added_by) REFERENCES users(id),
  UNIQUE INDEX uq_portfolio_items_project (portfolio_id, project_id),
  UNIQUE INDEX uq_portfolio_items_child (portfolio_id, child_portfolio_id),
  INDEX idx_portfolio_items_project (project_id),
  INDEX idx_portfolio_items_child (child_portfolio_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE portfolio_fields (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  portfolio_id BIGINT UNSIGNED NOT NULL,
  name         VARCHAR(80)     NOT NULL,
  kind         ENUM('TEXT', 'NUMBER', 'SELECT', 'DATE', 'PEOPLE') NOT NULL,
  options_json JSON            NULL COMMENT 'SELECT: the option names, in order',
  position     DOUBLE          NOT NULL DEFAULT 0,
  created_by   BIGINT UNSIGNED NOT NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_portfolio_fields_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  CONSTRAINT fk_portfolio_fields_creator FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_portfolio_fields_order (portfolio_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE portfolio_field_values (
  item_id    BIGINT UNSIGNED NOT NULL,
  field_id   BIGINT UNSIGNED NOT NULL,
  value      VARCHAR(500)    NOT NULL,
  updated_by BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (item_id, field_id),
  CONSTRAINT fk_portfolio_values_item FOREIGN KEY (item_id) REFERENCES portfolio_items(id),
  CONSTRAINT fk_portfolio_values_field FOREIGN KEY (field_id) REFERENCES portfolio_fields(id),
  CONSTRAINT fk_portfolio_values_updater FOREIGN KEY (updated_by) REFERENCES users(id),
  INDEX idx_portfolio_values_field (field_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE portfolio_status_updates (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  portfolio_id BIGINT UNSIGNED NOT NULL,
  status       ENUM('ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'ON_HOLD', 'COMPLETE', 'DROPPED') NOT NULL,
  title        VARCHAR(200)    NOT NULL,
  body         TEXT            NULL,
  author_id    BIGINT UNSIGNED NOT NULL,
  deleted_at   DATETIME        NULL,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_portfolio_status_portfolio FOREIGN KEY (portfolio_id) REFERENCES portfolios(id),
  CONSTRAINT fk_portfolio_status_author FOREIGN KEY (author_id) REFERENCES users(id),
  INDEX idx_portfolio_status_portfolio (portfolio_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE work_favourites
  MODIFY object_type ENUM('PROJECT', 'SEARCH', 'PORTFOLIO') NOT NULL;
