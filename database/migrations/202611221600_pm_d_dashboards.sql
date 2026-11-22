-- v1.67.0 (D-366 plan approved; D-375 build): Project Management phase D, part 1:
-- a Dashboard tab per project (number, bar, stacked bar, grouped bar, line,
-- burnup, burndown, donut, lollipop and text widgets) and a Workload tab
-- (person x day or week, task count or an effort field, against capacity).
-- Feature switch "pm_reporting" (default OFF). With it off no dashboard or
-- workload screen shows and the server refuses every dashboard, chart and
-- capacity operation; the tables below are simply not used.
--
-- 1. project_dashboard_widgets: one row per widget of a project's dashboard,
--    in order (position). kind CHART keeps its chart setup as JSON
--    (config_json: style, data source, X-axis, metrics, filters, data labels,
--    benchmark line; checked by server/work/reporting.ts before it is stored);
--    kind TEXT keeps its words in body. size HALF or FULL width. A new
--    dashboard gets the 8 default widgets the first time it is opened
--    (projects.dashboard_set says that has happened, so a dashboard whose
--    editors removed every widget stays empty). At most 20 widgets a project.
-- 2. project_capacity: how much work a person can take on per working day in
--    a project's Workload, per metric ('count' = tasks; 'f<field id>' = an
--    effort field: a number field's units or a timer field's hours).
--    user_id NULL is the project's default for everyone; a person's own row
--    overrides it. Weekly offs and holidays have no capacity.
-- 3. work_views.view_type gets DASHBOARD and WORKLOAD (tabs).
-- No triggers. Nothing existing is changed.
-- Run order: after 202611221500_pm_c_intake_forms.sql.
--
-- Rollback (after rolling the code back to v1.66.x; dashboards and capacities are lost):
--   DELETE FROM work_views WHERE view_type IN ('DASHBOARD', 'WORKLOAD');
--   ALTER TABLE work_views MODIFY view_type ENUM('LIST', 'BOARD', 'CALENDAR', 'TIMELINE', 'OVERVIEW', 'GANTT') NOT NULL DEFAULT 'LIST';
--   DROP TABLE project_capacity;
--   DROP TABLE project_dashboard_widgets;
--   ALTER TABLE projects DROP COLUMN dashboard_set;
--   DELETE FROM system_settings WHERE setting_key = 'features.pm_reporting';

ALTER TABLE projects
  ADD COLUMN dashboard_set BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'D-375: the default dashboard widgets were written';

CREATE TABLE project_dashboard_widgets (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id  BIGINT UNSIGNED NOT NULL,
  kind        ENUM('CHART', 'TEXT') NOT NULL,
  title       VARCHAR(80)     NOT NULL,
  config_json JSON            NULL COMMENT 'CHART: the chart setup (server/work/reporting.ts chartConfigSchema)',
  body        TEXT            NULL COMMENT 'TEXT: the words (plain text with links, at most 2000 characters)',
  size        ENUM('HALF', 'FULL') NOT NULL DEFAULT 'HALF',
  position    DOUBLE          NOT NULL DEFAULT 0,
  row_version INT UNSIGNED    NOT NULL DEFAULT 1,
  created_by  BIGINT UNSIGNED NULL COMMENT 'NULL: one of the default widgets',
  updated_by  BIGINT UNSIGNED NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NULL,
  CONSTRAINT fk_dashboard_widgets_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_dashboard_widgets_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_dashboard_widgets_updater FOREIGN KEY (updated_by) REFERENCES users(id),
  INDEX idx_dashboard_widgets_order (project_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE project_capacity (
  project_id BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NULL COMMENT 'NULL: the project default for everyone',
  metric     VARCHAR(24)     NOT NULL COMMENT 'count, or f<field id>',
  per_day    DECIMAL(10, 2)  NOT NULL,
  user_key   BIGINT UNSIGNED AS (COALESCE(user_id, 0)) STORED,
  updated_by BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_project_capacity_project FOREIGN KEY (project_id) REFERENCES projects(id),
  CONSTRAINT fk_project_capacity_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_project_capacity_updater FOREIGN KEY (updated_by) REFERENCES users(id),
  UNIQUE INDEX uq_project_capacity (project_id, metric, user_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE work_views
  MODIFY view_type ENUM('LIST', 'BOARD', 'CALENDAR', 'TIMELINE', 'OVERVIEW', 'GANTT', 'DASHBOARD', 'WORKLOAD') NOT NULL DEFAULT 'LIST';
